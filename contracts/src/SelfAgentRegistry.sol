// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import { ERC721 } from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import { Ownable } from "@openzeppelin/contracts/access/Ownable.sol";
import { SelfVerificationRoot } from "@selfxyz/contracts/contracts/abstract/SelfVerificationRoot.sol";
import { ISelfVerificationRoot } from "@selfxyz/contracts/contracts/interfaces/ISelfVerificationRoot.sol";
import { IIdentityVerificationHubV2 } from "@selfxyz/contracts/contracts/interfaces/IIdentityVerificationHubV2.sol";
import { SelfUtils } from "@selfxyz/contracts/contracts/libraries/SelfUtils.sol";
import { SelfStructs } from "@selfxyz/contracts/contracts/libraries/SelfStructs.sol";
import { IERC8004ProofOfHuman } from "./interfaces/IERC8004ProofOfHuman.sol";
import { IHumanProofProvider } from "./interfaces/IHumanProofProvider.sol";

/// @title SelfAgentRegistry
/// @notice ERC-721 registry binding AI agent identities to Self-verified unique humans
/// @dev Extends ERC-721 (agent NFTs) + SelfVerificationRoot (Hub V2 ZK verification)
///      + IERC8004ProofOfHuman (proof-of-human extension for ERC-8004).
///
///      Registration flow (MVP — agent key = human wallet address):
///        1. dApp calls verifySelfProof(proofPayload, userContextData)
///           where userContextData = | 32B destChainId | 32B userIdentifier | 1B action |
///        2. Hub V2 verifies the ZK proof, strips configId + destChainId + userIdentifier
///        3. Hub V2 calls back onVerificationSuccess -> customVerificationHook
///        4. customVerificationHook derives agentPubKey from humanAddress, mints/burns NFT
///
///      Agent identity: agentPubKey = bytes32(uint256(uint160(humanAddress)))
///
///      Action bytes:
///        0x01 / "R" = register (mint NFT)
///        0x02 / "D" = deregister (revoke proof, burn NFT)
contract SelfAgentRegistry is ERC721, Ownable, SelfVerificationRoot, IERC8004ProofOfHuman {

    // ====================================================
    // Constants
    // ====================================================

    uint8 constant ACTION_REGISTER = 0x01;
    uint8 constant ACTION_DEREGISTER = 0x02;

    // ASCII action prefixes used in userDefinedData (string-based encoding)
    uint8 constant ASCII_R = 0x52; // 'R' = register
    uint8 constant ASCII_D = 0x44; // 'D' = deregister

    // ====================================================
    // Storage
    // ====================================================

    /// @notice The verification config ID registered with Hub V2
    bytes32 public verificationConfigId;

    /// @notice Maps agentId to the human's scoped nullifier
    mapping(uint256 => uint256) public agentNullifier;

    /// @notice Maps agentId to the proof provider address that verified the agent
    mapping(uint256 => address) public agentProofProvider;

    /// @notice Maps agentId to whether the agent has an active human proof
    mapping(uint256 => bool) public agentHasHumanProof;

    /// @notice Maps agentId to the block number at which it was registered
    mapping(uint256 => uint256) public agentRegisteredAt;

    /// @notice Maps nullifier to count of active agents for that human
    mapping(uint256 => uint256) public activeAgentCount;

    /// @notice Maps agent public key hash to agentId (0 = not registered)
    mapping(bytes32 => uint256) public pubkeyToAgentId;

    /// @notice Whitelisted proof providers
    mapping(address => bool) public approvedProviders;

    /// @notice The address of the SelfHumanProofProvider (this contract's companion)
    address public selfProofProvider;

    /// @notice The next agent ID to mint
    uint256 private _nextAgentId;

    // ====================================================
    // Errors
    // ====================================================

    error AgentAlreadyRegistered(bytes32 agentPubKey);
    error AgentNotRegistered(bytes32 agentPubKey);
    error NotAgentOwner(uint256 expectedNullifier, uint256 actualNullifier);
    error InvalidAction(uint8 action);
    error InvalidUserData();
    error ProviderNotApproved(address provider);
    error ProviderAlreadyApproved(address provider);
    error AgentHasNoHumanProof(uint256 agentId);

    // ====================================================
    // Constructor
    // ====================================================

    /// @param hubV2 Address of the deployed IdentityVerificationHubV2
    /// @param initialOwner Address of the contract owner (can manage provider whitelist)
    constructor(
        address hubV2,
        address initialOwner
    )
        ERC721("Self Agent ID", "SAID")
        Ownable(initialOwner)
        SelfVerificationRoot(hubV2, "self-agent-id")
    {
        // Start agent IDs at 1 (0 is reserved as "no agent")
        _nextAgentId = 1;

        // Register minimal verification config with Hub V2:
        // no age check, no country restrictions, no OFAC
        SelfUtils.UnformattedVerificationConfigV2 memory rawCfg = SelfUtils.UnformattedVerificationConfigV2({
            olderThan: 0,
            forbiddenCountries: new string[](0),
            ofacEnabled: false
        });

        SelfStructs.VerificationConfigV2 memory config = SelfUtils.formatVerificationConfigV2(rawCfg);
        verificationConfigId = IIdentityVerificationHubV2(hubV2).setVerificationConfigV2(config);
    }

    // ====================================================
    // Admin Functions
    // ====================================================

    /// @notice Set the SelfHumanProofProvider companion address
    /// @dev Also approves it as a provider. Can only be called once effectively (or to update).
    /// @param provider The SelfHumanProofProvider contract address
    function setSelfProofProvider(address provider) external onlyOwner {
        if (selfProofProvider != address(0) && approvedProviders[selfProofProvider]) {
            approvedProviders[selfProofProvider] = false;
        }
        selfProofProvider = provider;
        if (!approvedProviders[provider]) {
            approvedProviders[provider] = true;
            emit ProofProviderAdded(provider, IHumanProofProvider(provider).providerName());
        }
    }

    /// @notice Add a proof provider to the whitelist
    /// @param provider The IHumanProofProvider contract address
    function addProofProvider(address provider) external onlyOwner {
        if (approvedProviders[provider]) revert ProviderAlreadyApproved(provider);
        approvedProviders[provider] = true;
        emit ProofProviderAdded(provider, IHumanProofProvider(provider).providerName());
    }

    /// @notice Remove a proof provider from the whitelist
    /// @param provider The provider address to remove
    function removeProofProvider(address provider) external onlyOwner {
        if (!approvedProviders[provider]) revert ProviderNotApproved(provider);
        approvedProviders[provider] = false;
        emit ProofProviderRemoved(provider);
    }

    // ====================================================
    // SelfVerificationRoot Overrides
    // ====================================================

    /// @notice Returns the single verification config ID for all proofs
    function getConfigId(
        bytes32,
        bytes32,
        bytes memory
    ) public view override returns (bytes32) {
        return verificationConfigId;
    }

    /// @notice Processes the verified proof: mints NFT or burns NFT based on action byte
    /// @dev Called by SelfVerificationRoot after Hub V2 verification succeeds.
    ///      MVP: agentPubKey is derived from the human's wallet address (userIdentifier).
    ///      userData only needs a single action byte:
    ///        Binary:  0x01 (register) or 0x02 (deregister)
    ///        String:  "R" (register) or "D" (deregister)
    /// @param output The verified disclosure output containing the nullifier
    /// @param userData The user-defined data containing the action byte/char
    function customVerificationHook(
        ISelfVerificationRoot.GenericDiscloseOutputV2 memory output,
        bytes memory userData
    ) internal override {
        if (userData.length == 0) revert InvalidUserData();

        uint8 actionByte = uint8(userData[0]);
        uint8 action;

        if (actionByte == ACTION_REGISTER || actionByte == ACTION_DEREGISTER) {
            action = actionByte;
        } else if (actionByte == ASCII_R || actionByte == ASCII_D) {
            action = actionByte == ASCII_R ? ACTION_REGISTER : ACTION_DEREGISTER;
        } else {
            revert InvalidAction(actionByte);
        }

        uint256 nullifier = output.nullifier;
        address humanAddress = address(uint160(output.userIdentifier));
        bytes32 agentPubKey = bytes32(uint256(uint160(humanAddress)));

        if (action == ACTION_REGISTER) {
            _registerAgent(nullifier, agentPubKey, humanAddress);
        } else {
            _deregisterAgent(nullifier, agentPubKey);
        }
    }

    // ====================================================
    // IERC8004ProofOfHuman — Registration
    // ====================================================

    /// @inheritdoc IERC8004ProofOfHuman
    /// @dev For Self Protocol, this function cannot be used directly because Hub V2 uses
    ///      an async callback pattern. Callers should use verifySelfProof() instead.
    ///      This function is provided to satisfy the IERC8004ProofOfHuman interface and
    ///      will revert for the Self provider. Other providers that support synchronous
    ///      verification can work through this path.
    function registerWithHumanProof(
        string calldata,
        address proofProvider,
        bytes calldata proof,
        bytes calldata providerData
    ) external override returns (uint256) {
        if (!approvedProviders[proofProvider]) revert ProviderNotApproved(proofProvider);

        // Attempt synchronous verification through the provider
        (bool verified, uint256 nullifier) = IHumanProofProvider(proofProvider).verifyHumanProof(proof, providerData);
        require(verified, "Human proof verification failed");

        // Extract agentPubKey from providerData (first 32 bytes)
        require(providerData.length >= 32, "Provider data must contain agent public key");
        bytes32 agentPubKey;
        assembly {
            agentPubKey := calldataload(providerData.offset)
        }

        uint256 agentId = _mintAgent(nullifier, agentPubKey, proofProvider, msg.sender);
        return agentId;
    }

    /// @inheritdoc IERC8004ProofOfHuman
    function revokeHumanProof(
        uint256 agentId,
        address proofProvider,
        bytes calldata proof,
        bytes calldata providerData
    ) external override {
        if (!approvedProviders[proofProvider]) revert ProviderNotApproved(proofProvider);
        if (!agentHasHumanProof[agentId]) revert AgentHasNoHumanProof(agentId);

        // Verify the caller is the same human (same nullifier)
        (bool verified, uint256 nullifier) = IHumanProofProvider(proofProvider).verifyHumanProof(proof, providerData);
        require(verified, "Human proof verification failed");
        require(nullifier == agentNullifier[agentId], "Not the same human");

        _revokeAgent(agentId);
    }

    // ====================================================
    // IERC8004ProofOfHuman — View Functions
    // ====================================================

    /// @inheritdoc IERC8004ProofOfHuman
    function hasHumanProof(uint256 agentId) external view override returns (bool) {
        return agentHasHumanProof[agentId];
    }

    /// @inheritdoc IERC8004ProofOfHuman
    function getHumanNullifier(uint256 agentId) external view override returns (uint256) {
        return agentNullifier[agentId];
    }

    /// @inheritdoc IERC8004ProofOfHuman
    function getProofProvider(uint256 agentId) external view override returns (address) {
        return agentProofProvider[agentId];
    }

    /// @inheritdoc IERC8004ProofOfHuman
    function getAgentCountForHuman(uint256 nullifier) external view override returns (uint256) {
        return activeAgentCount[nullifier];
    }

    /// @inheritdoc IERC8004ProofOfHuman
    function sameHuman(uint256 agentIdA, uint256 agentIdB) external view override returns (bool) {
        uint256 nullA = agentNullifier[agentIdA];
        uint256 nullB = agentNullifier[agentIdB];
        return nullA != 0 && nullA == nullB;
    }

    /// @inheritdoc IERC8004ProofOfHuman
    function isApprovedProvider(address provider) external view override returns (bool) {
        return approvedProviders[provider];
    }

    // ====================================================
    // Agent-Specific View Functions
    // ====================================================

    /// @notice Check if an agent public key is currently verified and active
    /// @param agentPubKey The agent's public key
    /// @return True if the agent is registered and has an active human proof
    function isVerifiedAgent(bytes32 agentPubKey) external view returns (bool) {
        uint256 agentId = pubkeyToAgentId[agentPubKey];
        if (agentId == 0) return false;
        return agentHasHumanProof[agentId];
    }

    /// @notice Get the agent ID for a given public key
    /// @param agentPubKey The agent's public key
    /// @return The agent ID (0 if not registered)
    function getAgentId(bytes32 agentPubKey) external view returns (uint256) {
        return pubkeyToAgentId[agentPubKey];
    }

    // ====================================================
    // Internal Logic
    // ====================================================

    /// @notice Mint a new agent NFT and store proof data
    /// @param nullifier The human's scoped nullifier
    /// @param agentPubKey The agent's public key
    /// @param proofProvider The address of the proof provider
    /// @param to The address to mint the NFT to (the human's address)
    /// @return agentId The newly minted agent ID
    function _mintAgent(
        uint256 nullifier,
        bytes32 agentPubKey,
        address proofProvider,
        address to
    ) internal returns (uint256 agentId) {
        if (pubkeyToAgentId[agentPubKey] != 0) revert AgentAlreadyRegistered(agentPubKey);

        agentId = _nextAgentId++;

        // Mint ERC-721 to the human's address (derived from userIdentifier)
        _mint(to, agentId);

        // Store proof-of-human data
        agentNullifier[agentId] = nullifier;
        agentProofProvider[agentId] = proofProvider;
        agentHasHumanProof[agentId] = true;
        agentRegisteredAt[agentId] = block.number;
        activeAgentCount[nullifier]++;
        pubkeyToAgentId[agentPubKey] = agentId;

        emit AgentRegisteredWithHumanProof(
            agentId,
            proofProvider,
            nullifier,
            IHumanProofProvider(proofProvider).verificationStrength()
        );

        return agentId;
    }

    /// @notice Register an agent through the Hub V2 callback flow
    /// @param nullifier The human's scoped nullifier
    /// @param agentPubKey The agent's public key
    /// @param humanAddress The human's address (derived from userIdentifier)
    function _registerAgent(uint256 nullifier, bytes32 agentPubKey, address humanAddress) internal {
        // For Hub V2 callback flow, use the selfProofProvider as the provider address
        address provider = selfProofProvider;
        _mintAgent(nullifier, agentPubKey, provider, humanAddress);
    }

    /// @notice Deregister an agent through the Hub V2 callback flow
    /// @param nullifier The caller's nullifier (must match the agent's owner)
    /// @param agentPubKey The agent's public key
    function _deregisterAgent(uint256 nullifier, bytes32 agentPubKey) internal {
        uint256 agentId = pubkeyToAgentId[agentPubKey];
        if (agentId == 0) revert AgentNotRegistered(agentPubKey);
        if (agentNullifier[agentId] != nullifier) {
            revert NotAgentOwner(agentNullifier[agentId], nullifier);
        }

        _revokeAgent(agentId);
    }

    /// @notice Revoke an agent's human proof and burn the NFT
    /// @param agentId The agent ID to revoke
    function _revokeAgent(uint256 agentId) internal {
        uint256 nullifier = agentNullifier[agentId];

        agentHasHumanProof[agentId] = false;
        activeAgentCount[nullifier]--;

        // Burn the NFT
        _burn(agentId);

        emit HumanProofRevoked(agentId, nullifier);
    }
}
