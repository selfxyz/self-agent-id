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
import { EIP712 } from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import { MessageHashUtils } from "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";
import { IERC8004ProofOfHuman } from "./interfaces/IERC8004ProofOfHuman.sol";
import { IERC165 } from "@openzeppelin/contracts/utils/introspection/IERC165.sol";
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
///        4. customVerificationHook derives agentKey from humanAddress, mints/burns NFT
///
///      Agent identity: agentKey = bytes32(uint256(uint160(humanAddress)))
///
///      Action bytes (ASCII, from Self SDK UTF-8 strings):
///        'R' = register simple (mint NFT, agent key = wallet address)
///        'D' = deregister simple (revoke proof, burn NFT)
///        'K' = register advanced (agent signs challenge, ECDSA verified)
///        'X' = deregister advanced (by agent address)
///        'W' = register wallet-free (agent-owned NFT, optional guardian)
contract SelfAgentRegistry is ERC721, Ownable, SelfVerificationRoot, EIP712, IERC8004ProofOfHuman {

    // ====================================================
    // Constants
    // ====================================================

    /// @notice EIP-712 typehash for the AgentWalletSet struct
    bytes32 public constant AGENT_WALLET_SET_TYPEHASH = keccak256(
        "AgentWalletSet(uint256 agentId,address newWallet,address owner,uint256 deadline)"
    );

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

    /// @notice Maps agent key to agentId (0 = not registered)
    mapping(bytes32 => uint256) public agentKeyToAgentId;

    /// @notice Reverse mapping: agentId to agent key (for cleanup on revoke)
    mapping(uint256 => bytes32) public agentIdToAgentKey;

    /// @notice Whitelisted proof providers
    mapping(address => bool) public approvedProviders;

    /// @notice The address of the SelfHumanProofProvider (this contract's companion)
    address public selfProofProvider;

    /// @notice Maps agentId to its guardian address (can force-revoke the agent)
    mapping(uint256 => address) public agentGuardian;

    /// @notice Maps agentId to delegated credential metadata (JSON string)
    mapping(uint256 => string) public agentMetadata;

    /// @notice Nonce per agent address to prevent signature replay attacks
    mapping(address => uint256) public agentNonces;

    /// @notice Maps agentId to the agent URI (ERC-8004 registration file location)
    mapping(uint256 => string) private _agentURIs;

    /// @notice ERC-8004 required: key-value metadata store per agent
    mapping(uint256 => mapping(string => bytes)) private _metadata;

    bytes32 private constant _RESERVED_AGENT_WALLET_KEY_HASH = keccak256("agentWallet");

    /// @notice ERC-8004 required: key-value metadata entry for batch registration
    struct MetadataEntry {
        string metadataKey;
        bytes metadataValue;
    }

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

    /// @notice Maximum agents per human (0 = unlimited, 1 = default — one agent per human)
    /// @dev Default of 1 enforces sybil resistance at the contract level.
    ///      Services that need multiple agents per human can call setMaxAgentsPerHuman().
    uint256 public maxAgentsPerHuman = 1;

    /// @notice Maximum age of a human proof before reauthentication is required (default: 1 year)
    uint256 public maxProofAge = 365 days;

    /// @notice Maps agentId to proof expiry timestamp (unix seconds)
    mapping(uint256 => uint256) public proofExpiresAt;

    /// @notice When true, the base register() overloads revert — all registration requires human proof.
    /// @dev Set to false only for non-sybil-resistant deployments that want ERC-8004 base compat without ZK.
    bool public requireHumanProof = true;

    /// @notice Optional address of the linked SelfReputationRegistry for auto proof-of-human feedback.
    /// @dev Set via setReputationRegistry(). When non-zero, _mintAgent() calls recordHumanProofFeedback().
    address public reputationRegistry;

    /// @notice Optional address of the linked SelfValidationRegistry for on-chain discoverability.
    /// @dev Set via setValidationRegistry(). Does not affect mint logic; used by off-chain tooling and
    ///      8004scan to discover the paired validation registry without external configuration.
    address public validationRegistry;

    /// @notice The next agent ID to mint
    uint256 private _nextAgentId;

    // ====================================================
    // Errors
    // ====================================================

    error TransferNotAllowed();
    error ProofRequired();
    error AgentAlreadyRegistered(bytes32 agentKey);
    error AgentNotRegistered(bytes32 agentKey);
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
    error ReservedMetadataKey();
    error DeadlineExpired();
    error InvalidWalletSignature();
    error InvalidMaxProofAge();
    error ArrayLengthMismatch(uint256 keysLength, uint256 valuesLength);

    // ====================================================
    // Events
    // ====================================================

    /// @notice Emitted when a guardian is set for an agent
    event GuardianSet(uint256 indexed agentId, address indexed guardian);

    /// @notice Emitted when agent metadata is updated
    event AgentMetadataUpdated(uint256 indexed agentId);

    /// @notice Emitted when ZK-attested credentials are stored for an agent
    event AgentCredentialsStored(uint256 indexed agentId);

    /// @notice Emitted when the linked SelfReputationRegistry address is updated
    event ReputationRegistryUpdated(address indexed newRegistry);

    /// @notice Emitted when the linked SelfValidationRegistry address is updated
    event ValidationRegistryUpdated(address indexed newRegistry);

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
        EIP712("SelfAgentRegistry", "1")
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

    /// @notice Set whether the base register() overloads require human proof
    /// @param required True to enforce ZK proof for all registration (default), false for permissive mode
    function setRequireHumanProof(bool required) external onlyOwner {
        requireHumanProof = required;
    }

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

    /// @notice Set the maximum age of a human proof before reauthentication is required
    /// @param newMaxProofAge The new maximum proof age in seconds (must be > 0)
    function setMaxProofAge(uint256 newMaxProofAge) external onlyOwner {
        if (newMaxProofAge == 0) revert InvalidMaxProofAge();
        maxProofAge = newMaxProofAge;
        emit MaxProofAgeUpdated(newMaxProofAge);
    }

    /// @notice Set the linked SelfReputationRegistry address (pass address(0) to disable)
    /// @dev When set, each new agent registration triggers a proof-of-human feedback entry.
    function setReputationRegistry(address registry_) external onlyOwner {
        reputationRegistry = registry_;
        emit ReputationRegistryUpdated(registry_);
    }

    /// @notice Set the linked SelfValidationRegistry address (pass address(0) to unlink)
    /// @dev This is a discovery pointer only — it does not alter mint or revocation logic.
    ///      Off-chain tooling and 8004scan read this to find the paired validation registry.
    function setValidationRegistry(address registry_) external onlyOwner {
        validationRegistry = registry_;
        emit ValidationRegistryUpdated(registry_);
    }

    // ====================================================
    // ERC-8004 Reputation Registry Compatibility
    // ====================================================

    /// @notice Check if a spender is the owner or an approved operator for a given agent.
    /// @dev Used by SelfReputationRegistry to gate self-feedback and appendResponse.
    ///      Reverts with ERC721NonexistentToken if agentId has not been minted.
    /// @param spender The address to check
    /// @param agentId The agent token ID
    /// @return True if spender is owner, ERC-721 approved, or isApprovedForAll operator
    function isAuthorizedOrOwner(address spender, uint256 agentId) external view returns (bool) {
        address tokenOwner = ownerOf(agentId); // reverts if not minted
        return spender == tokenOwner
            || isApprovedForAll(tokenOwner, spender)
            || getApproved(agentId) == spender;
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
            bytes32 agentKey = bytes32(uint256(uint160(humanAddress)));
            _registerAgent(nullifier, agentKey, humanAddress, output);
        } else if (actionByte == ACTION_DEREGISTER) {
            // Simple deregister
            bytes32 agentKey = bytes32(uint256(uint160(humanAddress)));
            _deregisterAgent(nullifier, agentKey);
        } else if (actionByte == ACTION_REGISTER_ADVANCED) {
            // Advanced register: "K" + config(1) + address(40) + r(64) + s(64) + v(2) = 172 chars
            if (userData.length < 172) revert InvalidUserData();
            address agentAddr = _hexStringToAddress(userData, 2);
            bytes32 r = _hexStringToBytes32(userData, 42);
            bytes32 s = _hexStringToBytes32(userData, 106);
            uint8 v = _hexStringToUint8(userData, 170);
            bytes32 agentKey = _verifyAgentSignature(agentAddr, humanAddress, v, r, s);
            _registerAgent(nullifier, agentKey, humanAddress, output);
        } else if (actionByte == ACTION_DEREGISTER_ADVANCED) {
            // Advanced deregister: "X" + config(1) + address(40) = 42 chars
            if (userData.length < 42) revert InvalidUserData();
            address agentAddr = _hexStringToAddress(userData, 2);
            bytes32 agentKey = bytes32(uint256(uint160(agentAddr)));
            _deregisterAgent(nullifier, agentKey);
        } else if (actionByte == ACTION_REGISTER_WALLETFREE) {
            // Wallet-free: "W" + config(1) + agentAddr(40) + guardian(40) + r(64) + s(64) + v(2) = 212 chars
            if (userData.length < 212) revert InvalidUserData();
            address agentAddr = _hexStringToAddress(userData, 2);
            address guardian = _hexStringToAddress(userData, 42);
            bytes32 r = _hexStringToBytes32(userData, 82);
            bytes32 s = _hexStringToBytes32(userData, 146);
            uint8 v = _hexStringToUint8(userData, 210);
            bytes32 agentKey = _verifyAgentSignature(agentAddr, humanAddress, v, r, s);
            _registerAgentWalletFree(nullifier, agentKey, agentAddr, guardian, output);
        } else {
            revert InvalidAction(actionByte);
        }
    }

    // ====================================================
    // IERC8004ProofOfHuman — Registration
    // ====================================================

    /// @notice Self SDK convenience overload: register with URI and struct-based metadata batch
    /// @dev NOT part of IERC8004ProofOfHuman — this is a Self SDK extension for ergonomic batch
    ///      registration. When requireHumanProof is true (default), reverts with ProofRequired().
    ///      When false, mints without proof via _baseRegister() and applies metadata.
    function register(
        string calldata agentURI,
        MetadataEntry[] calldata metadata
    ) external returns (uint256 agentId) {
        if (requireHumanProof) revert ProofRequired();
        agentId = _baseRegister(msg.sender, agentURI);
        for (uint256 i = 0; i < metadata.length; i++) {
            _setMetadataInternal(agentId, metadata[i].metadataKey, metadata[i].metadataValue);
        }
    }

    /// @inheritdoc IERC8004ProofOfHuman
    /// @dev EIP-facing variant using parallel arrays (satisfies IERC8004ProofOfHuman interface).
    ///      When requireHumanProof is true (default), reverts with ProofRequired().
    function register(
        string calldata agentURI,
        string[] calldata metadataKeys,
        bytes[] calldata metadataValues
    ) external override returns (uint256 agentId) {
        if (metadataKeys.length != metadataValues.length) revert ArrayLengthMismatch(metadataKeys.length, metadataValues.length);
        if (requireHumanProof) revert ProofRequired();
        agentId = _baseRegister(msg.sender, agentURI);
        for (uint256 i = 0; i < metadataKeys.length; i++) {
            _setMetadataInternal(agentId, metadataKeys[i], metadataValues[i]);
        }
    }

    /// @notice ERC-8004 required: register with URI (no metadata)
    /// @dev When requireHumanProof is true (default), reverts with ProofRequired().
    function register(string calldata agentURI) external override returns (uint256 agentId) {
        if (requireHumanProof) revert ProofRequired();
        return _baseRegister(msg.sender, agentURI);
    }

    /// @notice ERC-8004 required: register with no URI (set later via setAgentURI)
    /// @dev When requireHumanProof is true (default), reverts with ProofRequired().
    function register() external override returns (uint256 agentId) {
        if (requireHumanProof) revert ProofRequired();
        return _baseRegister(msg.sender, "");
    }

    /// @inheritdoc IERC8004ProofOfHuman
    /// @dev For Self Protocol, this function cannot be used directly because Hub V2 uses
    ///      an async callback pattern. Callers should use verifySelfProof() instead.
    ///      This function is provided to satisfy the IERC8004ProofOfHuman interface and
    ///      will revert for the Self provider. Other providers that support synchronous
    ///      verification can work through this path.
    function registerWithHumanProof(
        string calldata agentURI,
        address proofProvider,
        bytes calldata proof,
        bytes calldata providerData
    ) external override returns (uint256) {
        if (!approvedProviders[proofProvider]) revert ProviderNotApproved(proofProvider);

        // Attempt synchronous verification through the provider
        (bool verified, uint256 nullifier) = IHumanProofProvider(proofProvider).verifyHumanProof(proof, providerData);
        if (!verified) revert VerificationFailed();

        // Extract agentKey from providerData (first 32 bytes)
        if (providerData.length < 32) revert ProviderDataTooShort();
        bytes32 agentKey;
        assembly {
            agentKey := calldataload(providerData.offset)
        }

        // Copy agentURI to memory to avoid stack-too-deep with many calldata params
        string memory uri = agentURI;
        uint256 agentId = _mintAgent(nullifier, agentKey, proofProvider, msg.sender, uri);
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
    /// @dev Returns true if a ZK proof was ever submitted AND the agent still exists.
    ///      Does NOT check expiry — callers can use this to distinguish "never had proof"
    ///      from "had proof but it expired". Use isProofFresh() to check freshness.
    function hasHumanProof(uint256 agentId) external view override returns (bool) {
        return agentHasHumanProof[agentId];
    }

    /// @inheritdoc IERC8004ProofOfHuman
    function isProofFresh(uint256 agentId) external view override returns (bool) {
        return agentHasHumanProof[agentId] && block.timestamp < proofExpiresAt[agentId];
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

    /// @notice Check if an agent key is currently verified and active
    /// @param agentKey The agent's key (address-derived bytes32 identifier)
    /// @return True if the agent is registered and has an active human proof
    function isVerifiedAgent(bytes32 agentKey) external view returns (bool) {
        uint256 agentId = agentKeyToAgentId[agentKey];
        if (agentId == 0) return false;
        return agentHasHumanProof[agentId];
    }

    /// @notice Get the agent ID for a given agent key
    /// @param agentKey The agent's key (address-derived bytes32 identifier)
    /// @return The agent ID (0 if not registered)
    function getAgentId(bytes32 agentKey) external view returns (uint256) {
        return agentKeyToAgentId[agentKey];
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

    /// @notice ERC-721 tokenURI override — returns the agent's ERC-8004 registration file URI
    /// @param tokenId The agent ID to query
    /// @return The agent URI string (empty if none was provided at registration)
    function tokenURI(uint256 tokenId) public view override returns (string memory) {
        _requireOwned(tokenId);
        return _agentURIs[tokenId];
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

    /// @inheritdoc IERC8004ProofOfHuman
    function setAgentURI(uint256 agentId, string calldata newURI) external override {
        if (msg.sender != ownerOf(agentId)) revert NotNftOwner(agentId);
        _agentURIs[agentId] = newURI;
        emit URIUpdated(agentId, newURI, msg.sender);
    }

    /// @inheritdoc IERC8004ProofOfHuman
    function getMetadata(uint256 agentId, string memory metadataKey) external view override returns (bytes memory) {
        return _metadata[agentId][metadataKey];
    }

    /// @inheritdoc IERC8004ProofOfHuman
    function setMetadata(uint256 agentId, string calldata metadataKey, bytes calldata metadataValue) external override {
        if (msg.sender != ownerOf(agentId)) revert NotNftOwner(agentId);
        if (keccak256(bytes(metadataKey)) == _RESERVED_AGENT_WALLET_KEY_HASH) revert ReservedMetadataKey();
        _setMetadataInternal(agentId, metadataKey, metadataValue);
    }

    // ====================================================
    // Agent Wallet Functions (ERC-8004 + EIP-712)
    // ====================================================

    /// @notice Returns the EIP-712 domain separator for this contract
    /// @dev Exposed so tests and off-chain signers can compute digests without EIP-5267
    function domainSeparator() external view returns (bytes32) {
        return _domainSeparatorV4();
    }

    /// @inheritdoc IERC8004ProofOfHuman
    function setAgentWallet(
        uint256 agentId,
        address newWallet,
        uint256 deadline,
        bytes calldata signature
    ) external override {
        if (msg.sender != ownerOf(agentId)) revert NotNftOwner(agentId);
        if (block.timestamp > deadline) revert DeadlineExpired();

        bytes32 structHash = keccak256(abi.encode(
            AGENT_WALLET_SET_TYPEHASH,
            agentId,
            newWallet,
            msg.sender, // owner
            deadline
        ));
        address recovered = ECDSA.recover(_hashTypedDataV4(structHash), signature);
        if (recovered != newWallet) revert InvalidWalletSignature();

        // Store via internal path — bypasses the agentWallet reserved key guard in setMetadata()
        _setMetadataInternal(agentId, "agentWallet", abi.encode(newWallet));
    }

    /// @inheritdoc IERC8004ProofOfHuman
    function getAgentWallet(uint256 agentId) external view override returns (address) {
        bytes memory raw = _metadata[agentId]["agentWallet"];
        if (raw.length == 0) return address(0);
        return abi.decode(raw, (address));
    }

    /// @inheritdoc IERC8004ProofOfHuman
    function unsetAgentWallet(uint256 agentId) external override {
        if (msg.sender != ownerOf(agentId)) revert NotNftOwner(agentId);
        if (_metadata[agentId]["agentWallet"].length == 0) return;
        delete _metadata[agentId]["agentWallet"];
        emit MetadataSet(agentId, "agentWallet", "agentWallet", bytes(""));
    }

    // ====================================================
    // Internal Logic
    // ====================================================

    /// @dev Base registration without proof — only callable when requireHumanProof is false.
    ///      Mints NFT, stores URI, emits Registered. Does NOT set hasHumanProof.
    function _baseRegister(address to, string memory agentURI) internal returns (uint256 agentId) {
        agentId = _nextAgentId++;
        _mint(to, agentId);
        if (bytes(agentURI).length > 0) _agentURIs[agentId] = agentURI;
        emit Registered(agentId, agentURI, to);
    }

    /// @dev Internal setter — no owner check (used by register() overloads and setAgentWallet).
    ///      Emits MetadataSet. Does NOT block the agentWallet reserved key.
    function _setMetadataInternal(uint256 agentId, string memory metadataKey, bytes memory metadataValue) internal {
        _metadata[agentId][metadataKey] = metadataValue;
        emit MetadataSet(agentId, metadataKey, metadataKey, metadataValue);
    }

    /// @notice Mint a new agent NFT and store proof data
    /// @param nullifier The human's scoped nullifier
    /// @param agentKey The agent's key (address-derived bytes32 identifier)
    /// @param proofProvider The address of the proof provider
    /// @param to The address to mint the NFT to (the human's address)
    /// @param agentURI The agent URI (ERC-8004 registration file location; empty string if none)
    /// @return agentId The newly minted agent ID
    function _mintAgent(
        uint256 nullifier,
        bytes32 agentKey,
        address proofProvider,
        address to,
        string memory agentURI
    ) internal returns (uint256 agentId) {
        if (agentKeyToAgentId[agentKey] != 0) revert AgentAlreadyRegistered(agentKey);
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
        agentKeyToAgentId[agentKey] = agentId;
        agentIdToAgentKey[agentId] = agentKey;

        // Store agent URI if provided
        if (bytes(agentURI).length > 0) {
            _agentURIs[agentId] = agentURI;
        }

        // Default proof expiry to now + maxProofAge; _storeCredentials() may tighten this
        // to the document's own expiry date when called afterward (Hub V2 flow).
        proofExpiresAt[agentId] = block.timestamp + maxProofAge;

        // Auto-submit proof-of-human feedback if reputation registry is linked
        if (reputationRegistry != address(0)) {
            ISelfReputationRegistryMinimal(reputationRegistry).recordHumanProofFeedback(agentId);
        }

        emit AgentRegisteredWithHumanProof(
            agentId,
            proofProvider,
            nullifier,
            IHumanProofProvider(proofProvider).verificationStrength()
        );
        emit Registered(agentId, agentURI, to);

        return agentId;
    }

    /// @notice Register an agent through the Hub V2 callback flow
    /// @param nullifier The human's scoped nullifier
    /// @param agentKey The agent's key (address-derived bytes32 identifier)
    /// @param humanAddress The human's address (derived from userIdentifier)
    /// @param output The verified disclosure output (credentials stored on-chain)
    /// @dev The `Registered` event is emitted with a blank agentURI because the Hub V2 flow
    ///      does not pass a URI. The NFT owner MUST call setAgentURI() after registration.
    function _registerAgent(
        uint256 nullifier,
        bytes32 agentKey,
        address humanAddress,
        ISelfVerificationRoot.GenericDiscloseOutputV2 memory output
    ) internal {
        address provider = selfProofProvider;
        uint256 agentId = _mintAgent(nullifier, agentKey, provider, humanAddress, "");
        _storeCredentials(agentId, output);
    }

    /// @notice Register a wallet-free agent (agent-owned NFT with optional guardian)
    /// @param nullifier The human's scoped nullifier
    /// @param agentKey The agent's key (address-derived bytes32 identifier)
    /// @param agentAddress The agent's address (NFT minted here, not to humanAddress)
    /// @param guardian The guardian address (can force-revoke; address(0) = no guardian)
    /// @param output The verified disclosure output (credentials stored on-chain)
    /// @dev The `Registered` event is emitted with a blank agentURI because the Hub V2 flow
    ///      does not pass a URI. The NFT owner MUST call setAgentURI() after registration.
    function _registerAgentWalletFree(
        uint256 nullifier,
        bytes32 agentKey,
        address agentAddress,
        address guardian,
        ISelfVerificationRoot.GenericDiscloseOutputV2 memory output
    ) internal {
        address provider = selfProofProvider;
        uint256 agentId = _mintAgent(nullifier, agentKey, provider, agentAddress, "");
        _storeCredentials(agentId, output);

        if (guardian != address(0)) {
            agentGuardian[agentId] = guardian;
            emit GuardianSet(agentId, guardian);
        }
    }

    /// @notice Deregister an agent through the Hub V2 callback flow
    /// @param nullifier The caller's nullifier (must match the agent's owner)
    /// @param agentKey The agent's key (address-derived bytes32 identifier)
    function _deregisterAgent(uint256 nullifier, bytes32 agentKey) internal {
        uint256 agentId = agentKeyToAgentId[agentKey];
        if (agentId == 0) revert AgentNotRegistered(agentKey);
        if (agentNullifier[agentId] != nullifier) {
            revert NotAgentOwner(agentNullifier[agentId], nullifier);
        }

        _revokeAgent(agentId);
    }

    /// @notice Revoke an agent's human proof and burn the NFT
    /// @param agentId The agent ID to revoke
    function _revokeAgent(uint256 agentId) internal {
        uint256 nullifier = agentNullifier[agentId];

        // Clear agent key mappings so the same key can re-register
        bytes32 key = agentIdToAgentKey[agentId];
        if (key != bytes32(0)) {
            delete agentKeyToAgentId[key];
            delete agentIdToAgentKey[agentId];
        }

        agentHasHumanProof[agentId] = false;
        if (activeAgentCount[nullifier] > 0) {
            activeAgentCount[nullifier]--;
        }

        // Clear guardian, metadata, credentials, URI, and proof expiry
        delete agentGuardian[agentId];
        delete agentMetadata[agentId];
        delete _agentCredentials[agentId];
        delete _agentURIs[agentId];
        delete proofExpiresAt[agentId];
        // Note: individual _metadata keys cannot be bulk-deleted from a nested mapping in Solidity.
        // The NFT is burned — tokenId will never be reused (monotonic _nextAgentId) so stale entries
        // are harmless. For agentWallet specifically, Task 5 handles clearing it on unset.

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

        // Set proof expiry: min(document expiry, now + maxProofAge)
        uint256 docExpiry = _parseYYMMDDToTimestamp(output.expiryDate);
        uint256 ageExpiry = block.timestamp + maxProofAge;
        proofExpiresAt[agentId] = (docExpiry > 0 && docExpiry < ageExpiry) ? docExpiry : ageExpiry;
    }

    // ====================================================
    // Advanced Mode — Signature Verification
    // ====================================================

    /// @notice Verify an agent's ECDSA signature over a registration challenge
    /// @dev Includes a per-agent nonce to prevent replay attacks. The nonce is
    ///      incremented after each successful verification, invalidating old signatures.
    ///      Callers (dApp/SDK) must read agentNonces[agentAddress] before signing.
    /// @param agentAddress The agent's Ethereum address (recovered signer must match)
    /// @param humanAddress The human's address (included in signed message)
    /// @param v ECDSA recovery parameter
    /// @param r ECDSA signature component
    /// @param s ECDSA signature component
    /// @return agentKey The agent's key (address-derived bytes32) (address-derived bytes32)
    function _verifyAgentSignature(
        address agentAddress,
        address humanAddress,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) internal returns (bytes32 agentKey) {
        uint256 nonce = agentNonces[agentAddress];
        bytes32 messageHash = keccak256(abi.encodePacked(
            "self-agent-id:register:",
            humanAddress,
            block.chainid,
            address(this),
            nonce
        ));
        bytes32 ethSignedHash = MessageHashUtils.toEthSignedMessageHash(messageHash);
        address recovered = ECDSA.recover(ethSignedHash, v, r, s);
        if (recovered != agentAddress) revert InvalidAgentSignature();
        agentNonces[agentAddress] = nonce + 1;
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
    // Date Parsing Utilities
    // ====================================================

    /// @dev Returns cumulative days elapsed from 1 Jan of the given year through the end of month (mm-1).
    ///      mm=1 → 0 (no full months elapsed), mm=2 → 31 (January), etc.
    ///      Adds a leap day when mm > 2 and year is a leap year.
    function _daysInMonths(uint256 year, uint256 mm) internal pure returns (uint256) {
        // Cumulative days before each month (1-indexed; index 0 unused)
        uint256[12] memory days_ = [uint256(0), 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334];
        if (mm == 0 || mm > 12) return 0;
        uint256 d = days_[mm - 1];
        // Add leap day if we've passed Feb 28 in a leap year
        // Note: simplified approximation — does not subtract century years (1900, 2100) that are not
        // divisible by 400. For ICAO passport dates in range 2000-2049 (00-49 mapping), this is
        // accurate since 2000 is correctly a leap year (div by 400) and 2100 is outside range.
        if (mm > 2 && (year % 4 == 0 && (year % 100 != 0 || year % 400 == 0))) d += 1;
        return d;
    }

    /// @dev Parse a "YYMMDD" 6-character passport date string to a unix timestamp (seconds).
    ///      Returns 0 for any string that is not exactly 6 ASCII digits.
    ///      Year mapping follows ICAO Doc 9303 (passport) convention:
    ///        YY 00-49 → 2000-2049,  YY 50-99 → 1950-1999.
    function _parseYYMMDDToTimestamp(string memory dateStr) internal pure returns (uint256) {
        bytes memory d = bytes(dateStr);
        if (d.length != 6) return 0;
        uint256 yy = (uint8(d[0]) - 48) * 10 + (uint8(d[1]) - 48);
        uint256 mm = (uint8(d[2]) - 48) * 10 + (uint8(d[3]) - 48);
        uint256 dd = (uint8(d[4]) - 48) * 10 + (uint8(d[5]) - 48);
        // Map 2-digit year to full year
        uint256 year = yy < 50 ? 2000 + yy : 1900 + yy;
        // Count full years from 1970, plus accumulated leap days, plus days within the year
        uint256 daysSinceEpoch = (year - 1970) * 365 + (year - 1969) / 4 + _daysInMonths(year, mm) + dd - 1;
        return daysSinceEpoch * 1 days;
    }

    // ====================================================
    // ERC-165 Interface Detection
    // ====================================================

    /// @notice Declare support for ERC-165, ERC-721, and the IERC8004ProofOfHuman extension
    /// @dev OZ ERC721 already handles ERC-165 (0x01ffc9a7) and ERC-721 (0x80ac58cd).
    ///      We extend it here to additionally advertise the proof-of-human interface.
    function supportsInterface(bytes4 interfaceId) public view override(ERC721, IERC165) returns (bool) {
        return
            interfaceId == type(IERC8004ProofOfHuman).interfaceId ||
            super.supportsInterface(interfaceId);
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

/// @dev Minimal interface used by SelfAgentRegistry to call recordHumanProofFeedback
///      on the linked SelfReputationRegistry without importing the full contract.
interface ISelfReputationRegistryMinimal {
    function recordHumanProofFeedback(uint256 agentId) external;
}
