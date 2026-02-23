// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import { ERC721 } from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import { Ownable } from "@openzeppelin/contracts/access/Ownable.sol";
import { SelfVerificationRoot } from "@selfxyz/contracts/contracts/abstract/SelfVerificationRoot.sol";
import { ISelfVerificationRoot } from "@selfxyz/contracts/contracts/interfaces/ISelfVerificationRoot.sol";
import { IIdentityVerificationHubV2 } from "@selfxyz/contracts/contracts/interfaces/IIdentityVerificationHubV2.sol";
import { SelfUtils } from "@selfxyz/contracts/contracts/libraries/SelfUtils.sol";
import { SelfStructs } from "@selfxyz/contracts/contracts/libraries/SelfStructs.sol";
import { ECDSA } from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import { MessageHashUtils } from "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";
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
///      Action bytes (ASCII, from Self SDK UTF-8 strings):
///        'R' = register simple (mint NFT, agent key = wallet address)
///        'D' = deregister simple (revoke proof, burn NFT)
///        'K' = register advanced (agent signs challenge, ECDSA verified)
///        'X' = deregister advanced (by agent address)
///        'W' = register wallet-free (agent-owned NFT, optional guardian)
contract SelfAgentRegistry is ERC721, Ownable, SelfVerificationRoot, IERC8004ProofOfHuman {

    // ====================================================
    // Constants
    // ====================================================

    // Action bytes in userDefinedData (Self SDK sends UTF-8 strings)
    uint8 constant ACTION_REGISTER = 0x52;           // 'R' = simple register
    uint8 constant ACTION_DEREGISTER = 0x44;          // 'D' = simple deregister
    uint8 constant ACTION_REGISTER_ADVANCED = 0x4B;   // 'K' = advanced register
    uint8 constant ACTION_DEREGISTER_ADVANCED = 0x58;  // 'X' = advanced deregister
    uint8 constant ACTION_REGISTER_WALLETFREE = 0x57;  // 'W' = wallet-free register

    // ====================================================
    // Storage
    // ====================================================

    /// @notice Number of verification configs (age × OFAC combos)
    uint8 public constant NUM_CONFIGS = 6;

    /// @notice Verification config IDs registered with Hub V2 (indexed 0-5)
    bytes32[6] public configIds;

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

    /// @notice Reverse mapping: agentId to agent public key (for cleanup on revoke)
    mapping(uint256 => bytes32) public agentIdToPubkey;

    /// @notice Whitelisted proof providers
    mapping(address => bool) public approvedProviders;

    /// @notice The address of the SelfHumanProofProvider (this contract's companion)
    address public selfProofProvider;

    /// @notice Maps agentId to its guardian address (can force-revoke the agent)
    mapping(uint256 => address) public agentGuardian;

    /// @notice Maps agentId to delegated credential metadata (JSON string)
    mapping(uint256 => string) public agentMetadata;

    /// @notice Stores ZK-attested credential claims for each agent
    struct AgentCredentials {
        string issuingState;
        string[] name;
        string idNumber;
        string nationality;
        string dateOfBirth;
        string gender;
        string expiryDate;
        uint256 olderThan;
        bool[3] ofac;
    }

    /// @notice Maps agentId to ZK-attested credentials (populated at registration)
    mapping(uint256 => AgentCredentials) private _agentCredentials;

    /// @notice Maximum agents per human (0 = unlimited, default = 1)
    uint256 public maxAgentsPerHuman = 1;

    /// @notice The next agent ID to mint
    uint256 private _nextAgentId;

    // ====================================================
    // Errors
    // ====================================================

    error TransferNotAllowed();
    error AgentAlreadyRegistered(bytes32 agentPubKey);
    error AgentNotRegistered(bytes32 agentPubKey);
    error NotAgentOwner(uint256 expectedNullifier, uint256 actualNullifier);
    error InvalidAction(uint8 action);
    error InvalidUserData();
    error ProviderNotApproved(address provider);
    error ProviderAlreadyApproved(address provider);
    error AgentHasNoHumanProof(uint256 agentId);
    error InvalidAgentSignature();
    error NotGuardian(uint256 agentId);
    error NotNftOwner(uint256 agentId);
    error NoGuardianSet(uint256 agentId);
    error TooManyAgentsForHuman(uint256 nullifier, uint256 max);
    error InvalidConfigIndex(uint8 raw);
    error VerificationFailed();
    error ProviderDataTooShort();
    error NotSameHuman();

    // ====================================================
    // Events (V4 additions)
    // ====================================================

    /// @notice Emitted when a guardian is set for an agent
    event GuardianSet(uint256 indexed agentId, address indexed guardian);

    /// @notice Emitted when agent metadata is updated
    event AgentMetadataUpdated(uint256 indexed agentId);

    /// @notice Emitted when ZK-attested credentials are stored for an agent
    event AgentCredentialsStored(uint256 indexed agentId);

    /// @notice Emitted when the max agents per human is updated
    event MaxAgentsPerHumanUpdated(uint256 max);

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

        // Register 6 verification configs with Hub V2 (all combos of age × OFAC).
        // Each user selects their config at registration time via a digit in userDefinedData.
        configIds[0] = _registerConfig(hubV2, 0, false);   // Base (data disclosures only)
        configIds[1] = _registerConfig(hubV2, 18, false);  // Over 18
        configIds[2] = _registerConfig(hubV2, 21, false);  // Over 21
        configIds[3] = _registerConfig(hubV2, 0, true);    // OFAC only
        configIds[4] = _registerConfig(hubV2, 18, true);   // Over 18 + OFAC
        configIds[5] = _registerConfig(hubV2, 21, true);   // Over 21 + OFAC
    }

    function _registerConfig(
        address hubV2,
        uint256 olderThan,
        bool ofacEnabled
    ) private returns (bytes32) {
        SelfUtils.UnformattedVerificationConfigV2 memory rawCfg = SelfUtils.UnformattedVerificationConfigV2({
            olderThan: olderThan,
            forbiddenCountries: new string[](0),
            ofacEnabled: ofacEnabled
        });
        SelfStructs.VerificationConfigV2 memory config = SelfUtils.formatVerificationConfigV2(rawCfg);
        return IIdentityVerificationHubV2(hubV2).setVerificationConfigV2(config);
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

    /// @notice Set the maximum number of agents a single human can register (0 = unlimited)
    function setMaxAgentsPerHuman(uint256 max) external onlyOwner {
        maxAgentsPerHuman = max;
        emit MaxAgentsPerHumanUpdated(max);
    }

    // ====================================================
    // SelfVerificationRoot Overrides
    // ====================================================

    /// @notice Returns the verification config based on the config digit in userDefinedData
    /// @dev Format: | 1B action | 1B configIndex ('0'-'5' or 0x00-0x05) | payload... |
    ///      Defaults to config 0 if no config byte or unrecognized value.
    function getConfigId(
        bytes32,
        bytes32,
        bytes memory userDefinedData
    ) public view override returns (bytes32) {
        if (userDefinedData.length < 2) return configIds[0];

        uint8 raw = uint8(userDefinedData[1]);
        uint8 idx;

        if (raw >= 0x30 && raw <= 0x35) {
            idx = raw - 0x30; // ASCII '0'-'5'
        } else if (raw <= 0x05) {
            idx = raw; // Binary 0x00-0x05
        } else {
            revert InvalidConfigIndex(raw);
        }

        return configIds[idx];
    }

    /// @notice Processes the verified proof: mints NFT or burns NFT based on action byte
    /// @dev Called by SelfVerificationRoot after Hub V2 verification succeeds.
    ///      userData format: | 1B action | 1B configIndex | payload... |
    ///      Config index selects which of the 6 verification configs to use (see getConfigId).
    ///      Action bytes (ASCII):
    ///        'R' = simple register, 'D' = simple deregister
    ///        'K' = advanced register, 'X' = advanced deregister
    ///        'W' = wallet-free register
    /// @param output The verified disclosure output containing the nullifier
    /// @param userData The user-defined data containing the action byte/char
    function customVerificationHook(
        ISelfVerificationRoot.GenericDiscloseOutputV2 memory output,
        bytes memory userData
    ) internal override {
        if (userData.length == 0) revert InvalidUserData();

        uint256 nullifier = output.nullifier;
        address humanAddress = address(uint160(output.userIdentifier));
        uint8 actionByte = uint8(userData[0]);

        if (actionByte == ACTION_REGISTER) {
            // Simple mode: agent key = human wallet address
            bytes32 agentPubKey = bytes32(uint256(uint160(humanAddress)));
            _registerAgent(nullifier, agentPubKey, humanAddress, output);
        } else if (actionByte == ACTION_DEREGISTER) {
            // Simple deregister
            bytes32 agentPubKey = bytes32(uint256(uint160(humanAddress)));
            _deregisterAgent(nullifier, agentPubKey);
        } else if (actionByte == ACTION_REGISTER_ADVANCED) {
            // Advanced register: "K" + config(1) + address(40) + r(64) + s(64) + v(2) = 172 chars
            if (userData.length < 172) revert InvalidUserData();
            address agentAddr = _hexStringToAddress(userData, 2);
            bytes32 r = _hexStringToBytes32(userData, 42);
            bytes32 s = _hexStringToBytes32(userData, 106);
            uint8 v = _hexStringToUint8(userData, 170);
            bytes32 agentPubKey = _verifyAgentSignature(agentAddr, humanAddress, v, r, s);
            _registerAgent(nullifier, agentPubKey, humanAddress, output);
        } else if (actionByte == ACTION_DEREGISTER_ADVANCED) {
            // Advanced deregister: "X" + config(1) + address(40) = 42 chars
            if (userData.length < 42) revert InvalidUserData();
            address agentAddr = _hexStringToAddress(userData, 2);
            bytes32 agentPubKey = bytes32(uint256(uint160(agentAddr)));
            _deregisterAgent(nullifier, agentPubKey);
        } else if (actionByte == ACTION_REGISTER_WALLETFREE) {
            // Wallet-free: "W" + config(1) + agentAddr(40) + guardian(40) + r(64) + s(64) + v(2) = 212 chars
            if (userData.length < 212) revert InvalidUserData();
            address agentAddr = _hexStringToAddress(userData, 2);
            address guardian = _hexStringToAddress(userData, 42);
            bytes32 r = _hexStringToBytes32(userData, 82);
            bytes32 s = _hexStringToBytes32(userData, 146);
            uint8 v = _hexStringToUint8(userData, 210);
            bytes32 agentPubKey = _verifyAgentSignature(agentAddr, humanAddress, v, r, s);
            _registerAgentWalletFree(nullifier, agentPubKey, agentAddr, guardian, output);
        } else {
            revert InvalidAction(actionByte);
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
        if (!verified) revert VerificationFailed();

        // Extract agentPubKey from providerData (first 32 bytes)
        if (providerData.length < 32) revert ProviderDataTooShort();
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
        if (!verified) revert VerificationFailed();
        if (nullifier != agentNullifier[agentId]) revert NotSameHuman();

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
        if (!agentHasHumanProof[agentIdA] || !agentHasHumanProof[agentIdB]) return false;
        uint256 nullA = agentNullifier[agentIdA];
        return nullA != 0 && nullA == agentNullifier[agentIdB];
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

    /// @notice Get the delegated credential metadata for an agent
    /// @param agentId The agent to query
    /// @return The metadata JSON string (empty if none set)
    function getAgentMetadata(uint256 agentId) external view returns (string memory) {
        return agentMetadata[agentId];
    }

    /// @notice Get the ZK-attested credentials for an agent
    /// @param agentId The agent to query
    /// @return The agent's credentials (empty fields = not disclosed)
    function getAgentCredentials(uint256 agentId) external view returns (AgentCredentials memory) {
        return _agentCredentials[agentId];
    }

    // ====================================================
    // Guardian Functions
    // ====================================================

    /// @notice Guardian force-revokes a compromised agent
    /// @dev Only callable by the agent's designated guardian
    /// @param agentId The agent to revoke
    function guardianRevoke(uint256 agentId) external {
        address guardian = agentGuardian[agentId];
        if (guardian == address(0)) revert NoGuardianSet(agentId);
        if (msg.sender != guardian) revert NotGuardian(agentId);
        _revokeAgent(agentId);
    }

    /// @notice Agent (NFT owner) deregisters itself
    /// @dev Only callable by the current owner of the agent NFT
    /// @param agentId The agent to deregister
    function selfDeregister(uint256 agentId) external {
        if (msg.sender != ownerOf(agentId)) revert NotNftOwner(agentId);
        _revokeAgent(agentId);
    }

    // ====================================================
    // Metadata Functions
    // ====================================================

    /// @notice Update delegated credential metadata for an agent
    /// @dev Only callable by the current owner of the agent NFT
    /// @param agentId The agent to update
    /// @param metadata The new metadata JSON string
    function updateAgentMetadata(uint256 agentId, string calldata metadata) external {
        if (msg.sender != ownerOf(agentId)) revert NotNftOwner(agentId);
        agentMetadata[agentId] = metadata;
        emit AgentMetadataUpdated(agentId);
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
        if (maxAgentsPerHuman > 0 && activeAgentCount[nullifier] >= maxAgentsPerHuman) {
            revert TooManyAgentsForHuman(nullifier, maxAgentsPerHuman);
        }

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
        agentIdToPubkey[agentId] = agentPubKey;

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
    /// @param output The verified disclosure output (credentials stored on-chain)
    function _registerAgent(
        uint256 nullifier,
        bytes32 agentPubKey,
        address humanAddress,
        ISelfVerificationRoot.GenericDiscloseOutputV2 memory output
    ) internal {
        address provider = selfProofProvider;
        uint256 agentId = _mintAgent(nullifier, agentPubKey, provider, humanAddress);
        _storeCredentials(agentId, output);
    }

    /// @notice Register a wallet-free agent (agent-owned NFT with optional guardian)
    /// @param nullifier The human's scoped nullifier
    /// @param agentPubKey The agent's public key
    /// @param agentAddress The agent's address (NFT minted here, not to humanAddress)
    /// @param guardian The guardian address (can force-revoke; address(0) = no guardian)
    /// @param output The verified disclosure output (credentials stored on-chain)
    function _registerAgentWalletFree(
        uint256 nullifier,
        bytes32 agentPubKey,
        address agentAddress,
        address guardian,
        ISelfVerificationRoot.GenericDiscloseOutputV2 memory output
    ) internal {
        address provider = selfProofProvider;
        uint256 agentId = _mintAgent(nullifier, agentPubKey, provider, agentAddress);
        _storeCredentials(agentId, output);

        if (guardian != address(0)) {
            agentGuardian[agentId] = guardian;
            emit GuardianSet(agentId, guardian);
        }
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

        // Clear pubkey mappings so the same key can re-register
        bytes32 pubkey = agentIdToPubkey[agentId];
        if (pubkey != bytes32(0)) {
            delete pubkeyToAgentId[pubkey];
            delete agentIdToPubkey[agentId];
        }

        agentHasHumanProof[agentId] = false;
        if (activeAgentCount[nullifier] > 0) {
            activeAgentCount[nullifier]--;
        }

        // Clear guardian, metadata, and credentials
        delete agentGuardian[agentId];
        delete agentMetadata[agentId];
        delete _agentCredentials[agentId];

        // Burn the NFT
        _burn(agentId);

        emit HumanProofRevoked(agentId, nullifier);
    }

    /// @notice Store ZK-attested credential claims from the Hub V2 disclosure output
    /// @param agentId The agent to store credentials for
    /// @param output The verified disclosure output from Hub V2
    function _storeCredentials(
        uint256 agentId,
        ISelfVerificationRoot.GenericDiscloseOutputV2 memory output
    ) internal {
        AgentCredentials storage creds = _agentCredentials[agentId];
        creds.issuingState = output.issuingState;
        creds.name = output.name;
        creds.idNumber = output.idNumber;
        creds.nationality = output.nationality;
        creds.dateOfBirth = output.dateOfBirth;
        creds.gender = output.gender;
        creds.expiryDate = output.expiryDate;
        creds.olderThan = output.olderThan;
        creds.ofac = output.ofac;
        emit AgentCredentialsStored(agentId);
    }

    // ====================================================
    // Advanced Mode — Signature Verification
    // ====================================================

    /// @notice Verify an agent's ECDSA signature over a registration challenge
    /// @param agentAddress The agent's Ethereum address (recovered signer must match)
    /// @param humanAddress The human's address (included in signed message)
    /// @param v ECDSA recovery parameter
    /// @param r ECDSA signature component
    /// @param s ECDSA signature component
    /// @return agentPubKey The agent's public key (address-derived bytes32)
    function _verifyAgentSignature(
        address agentAddress,
        address humanAddress,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) internal view returns (bytes32 agentPubKey) {
        bytes32 messageHash = keccak256(abi.encodePacked(
            "self-agent-id:register:",
            humanAddress,
            block.chainid,
            address(this)
        ));
        bytes32 ethSignedHash = MessageHashUtils.toEthSignedMessageHash(messageHash);
        address recovered = ECDSA.recover(ethSignedHash, v, r, s);
        if (recovered != agentAddress) revert InvalidAgentSignature();
        return bytes32(uint256(uint160(agentAddress)));
    }

    // ====================================================
    // Advanced Mode — Hex String Parsing
    // ====================================================

    function _hexCharToNibble(uint8 c) internal pure returns (uint8) {
        if (c >= 0x30 && c <= 0x39) return c - 0x30; // '0'-'9'
        if (c >= 0x61 && c <= 0x66) return c - 0x61 + 10; // 'a'-'f'
        if (c >= 0x41 && c <= 0x46) return c - 0x41 + 10; // 'A'-'F'
        revert InvalidUserData();
    }

    function _hexStringToAddress(bytes memory data, uint256 offset) internal pure returns (address) {
        uint160 result;
        for (uint256 i = 0; i < 40; i++) {
            result = result * 16 + uint160(_hexCharToNibble(uint8(data[offset + i])));
        }
        return address(result);
    }

    function _hexStringToBytes32(bytes memory data, uint256 offset) internal pure returns (bytes32) {
        uint256 result;
        for (uint256 i = 0; i < 64; i++) {
            result = result * 16 + uint256(_hexCharToNibble(uint8(data[offset + i])));
        }
        return bytes32(result);
    }

    function _hexStringToUint8(bytes memory data, uint256 offset) internal pure returns (uint8) {
        return _hexCharToNibble(uint8(data[offset])) * 16 + _hexCharToNibble(uint8(data[offset + 1]));
    }

    // ====================================================
    // Soulbound — Block Transfers
    // ====================================================

    /// @notice Override ERC-721 _update to make tokens soulbound (non-transferable)
    /// @dev Allows mint (from = 0) and burn (to = 0) but blocks all transfers
    function _update(address to, uint256 tokenId, address auth) internal override returns (address) {
        address from = _ownerOf(tokenId);
        if (from != address(0) && to != address(0)) revert TransferNotAllowed();
        return super._update(to, tokenId, auth);
    }
}
