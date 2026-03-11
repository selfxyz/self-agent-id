// SPDX-License-Identifier: MIT

pragma solidity 0.8.28;

import { ERC721Upgradeable } from "@openzeppelin/contracts-upgradeable/token/ERC721/ERC721Upgradeable.sol";
import { SelfVerificationRootUpgradeable } from "@selfxyz/contracts/contracts/abstract/SelfVerificationRootUpgradeable.sol";
import { ISelfVerificationRoot } from "@selfxyz/contracts/contracts/interfaces/ISelfVerificationRoot.sol";
import { IIdentityVerificationHubV2 } from "@selfxyz/contracts/contracts/interfaces/IIdentityVerificationHubV2.sol";
import { SelfUtils } from "@selfxyz/contracts/contracts/libraries/SelfUtils.sol";
import { SelfStructs } from "@selfxyz/contracts/contracts/libraries/SelfStructs.sol";
import { ECDSA } from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import { EIP712Upgradeable } from "@openzeppelin/contracts-upgradeable/utils/cryptography/EIP712Upgradeable.sol";
import { MessageHashUtils } from "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";
import { IERC8004 } from "./interfaces/IERC8004.sol";
import { IERC8004ProofOfHuman } from "./interfaces/IERC8004ProofOfHuman.sol";
import { IERC165 } from "@openzeppelin/contracts/utils/introspection/IERC165.sol";
import { IHumanProofProvider } from "./interfaces/IHumanProofProvider.sol";
import { ImplRoot } from "./upgradeable/ImplRoot.sol";
import { AccessControlUpgradeable } from "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import { Ed25519Verifier } from "./lib/Ed25519Verifier.sol";

/**
 * @title SelfAgentRegistry
 * @author Self Protocol
 * @notice ERC-721 registry binding AI agent identities to Self-verified unique humans
 * @custom:version 1.0.0
 *
 * @notice CRITICAL STORAGE LAYOUT WARNING
 *
 * This contract uses the UUPS upgradeable pattern which makes storage layout EXTREMELY SENSITIVE.
 *
 * NEVER MODIFY OR REORDER existing storage variables
 * NEVER INSERT new variables between existing ones
 * NEVER CHANGE THE TYPE of existing variables
 *
 * New storage variables MUST be added at the END of the storage struct only.
 *
 * @dev Extends ERC-721 (agent NFTs) + SelfVerificationRootUpgradeable (Hub V2 ZK verification)
 *      + IERC8004ProofOfHuman (proof-of-human extension for ERC-8004).
 *
 *      Registration flow (MVP — agent key = human wallet address):
 *        1. dApp calls verifySelfProof(proofPayload, userContextData)
 *           where userContextData = | 32B destChainId | 32B userIdentifier | 1B action |
 *        2. Hub V2 verifies the ZK proof, strips configId + destChainId + userIdentifier
 *        3. Hub V2 calls back onVerificationSuccess -> customVerificationHook
 *        4. customVerificationHook derives agentKey from humanAddress, mints/burns NFT
 *
 *      Agent identity: agentKey = bytes32(uint256(uint160(humanAddress)))
 *
 *      Action bytes (ASCII, from Self SDK UTF-8 strings):
 *        'R' = register simple (mint NFT, agent key = wallet address)
 *        'D' = deregister simple (revoke proof, burn NFT)
 *        'K' = register advanced (agent signs challenge, ECDSA verified)
 *        'X' = deregister advanced (by agent address)
 *        'W' = register wallet-free (agent-owned NFT, optional guardian)
 */
contract SelfAgentRegistry is
    ImplRoot,
    ERC721Upgradeable,
    SelfVerificationRootUpgradeable,
    EIP712Upgradeable,
    IERC8004ProofOfHuman
{

    // ====================================================
    // Constants (compiled into bytecode, not storage)
    // ====================================================

    /// @notice EIP-712 typehash for the AgentWalletSet struct (includes nonce for replay protection)
    bytes32 public constant AGENT_WALLET_SET_TYPEHASH = keccak256(
        "AgentWalletSet(uint256 agentId,address newWallet,address owner,uint256 nonce,uint256 deadline)"
    );

    /// @dev Action byte for simple registration ('R' = 0x52)
    uint8 constant ACTION_REGISTER = 0x52;
    /// @dev Action byte for simple deregistration ('D' = 0x44)
    uint8 constant ACTION_DEREGISTER = 0x44;
    /// @dev Action byte for advanced registration with agent signature ('K' = 0x4B)
    uint8 constant ACTION_REGISTER_ADVANCED = 0x4B;
    /// @dev Action byte for advanced deregistration by agent address ('X' = 0x58)
    uint8 constant ACTION_DEREGISTER_ADVANCED = 0x58;
    /// @dev Action byte for wallet-free registration with guardian ('W' = 0x57)
    uint8 constant ACTION_REGISTER_WALLETFREE = 0x57;
    /// @dev Action byte for Ed25519 agent registration ('E' = 0x45)
    uint8 constant ACTION_REGISTER_ED25519 = 0x45;
    /// @dev Action byte for refreshing an existing human proof in-place ('F' = 0x46)
    uint8 constant ACTION_REFRESH = 0x46;
    /// @dev Action byte for read-only nullifier identification ('I' = 0x49)
    uint8 constant ACTION_IDENTIFY = 0x49;

    /// @notice Number of verification configs (age × OFAC combos)
    uint8 public constant NUM_CONFIGS = 6;

    bytes32 private constant _RESERVED_AGENT_WALLET_KEY_HASH = keccak256("agentWallet");

    // ====================================================
    // ERC-7201 Namespaced Storage
    // ====================================================

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

    /// @notice ERC-8004 required: key-value metadata entry for batch registration
    struct MetadataEntry {
        string metadataKey;
        bytes metadataValue;
    }

    /// @notice Central storage struct for all registry state (ERC-7201 namespaced)
    /// @custom:storage-location erc7201:self.storage.SelfAgentRegistry
    struct SelfAgentRegistryStorage {
        bytes32[6] configIds;
        mapping(uint256 => uint256) agentNullifier;
        mapping(uint256 => address) agentProofProvider;
        mapping(uint256 => bool) agentHasHumanProof;
        mapping(uint256 => uint256) agentRegisteredAt;
        mapping(uint256 => uint256) activeAgentCount;
        mapping(bytes32 => uint256) agentKeyToAgentId;
        mapping(uint256 => bytes32) agentIdToAgentKey;
        mapping(address => bool) approvedProviders;
        address selfProofProvider;
        mapping(uint256 => address) agentGuardian;
        mapping(uint256 => string) agentMetadata;
        mapping(address => uint256) agentNonces;
        mapping(uint256 => string) agentURIs;
        mapping(uint256 => mapping(string => bytes)) metadata;
        mapping(uint256 => AgentCredentials) agentCredentials;
        uint256 maxAgentsPerHuman;
        uint256 maxProofAge;
        bool requireHumanProof;
        address reputationRegistry;
        address validationRegistry;
        uint256 nextAgentId;
        mapping(uint256 => uint256) proofExpiresAt;
        mapping(uint256 => uint256) walletSetNonces;
        /// @dev Nonces for Ed25519 agent challenge signing, keyed by keccak256(ed25519Pubkey)
        mapping(bytes32 => uint256) ed25519Nonces;
        /// @dev Reverse mapping: nullifier -> list of agentIds registered by that human
        mapping(uint256 => uint256[]) agentsByNullifier;
        /// @dev Index of each agentId within its nullifier's agentsByNullifier array (for swap-and-pop removal)
        mapping(uint256 => uint256) agentIndexInNullifier;
        /// @dev Tracks the verification config ID used when each agent was registered
        mapping(uint256 => bytes32) agentConfigId;
    }

    /// @dev keccak256(abi.encode(uint256(keccak256("self.storage.SelfAgentRegistry")) - 1)) & ~bytes32(uint256(0xff))
    bytes32 private constant SELFAGENTREGISTRY_STORAGE_LOCATION =
        0x867b9f313fe85b5b69621ca346ab22f9689356653885ece64b114fbeeff43500;

    function _getSelfAgentRegistryStorage() private pure returns (SelfAgentRegistryStorage storage $) {
        assembly { $.slot := SELFAGENTREGISTRY_STORAGE_LOCATION }
    }

    // ====================================================
    // Errors
    // ====================================================

    /// @notice Thrown when attempting to transfer a soulbound agent NFT
    error TransferNotAllowed();
    /// @notice Thrown when register() is called but requireHumanProof is enabled
    error ProofRequired();
    /// @notice Thrown when registering an agent key that already has an active registration
    error AgentAlreadyRegistered(bytes32 agentKey);
    /// @notice Thrown when deregistering an agent key that has no active registration
    error AgentNotRegistered(bytes32 agentKey);
    /// @notice Thrown when the nullifier from the proof does not match the agent's nullifier
    error NotAgentOwner(uint256 expectedNullifier, uint256 actualNullifier);
    /// @notice Thrown when the action byte in userDefinedData is unrecognised
    error InvalidAction(uint8 action);
    /// @notice Thrown when userDefinedData is empty or too short for the specified action
    error InvalidUserData();
    /// @notice Thrown when a proof provider is not on the approved whitelist
    error ProviderNotApproved(address provider);
    /// @notice Thrown when adding a proof provider that is already approved
    error ProviderAlreadyApproved(address provider);
    /// @notice Thrown when revoking proof for an agent that has no active human proof
    error AgentHasNoHumanProof(uint256 agentId);
    /// @notice Thrown when the ECDSA signature in advanced registration does not match the agent address
    error InvalidAgentSignature();
    /// @notice Thrown when guardianRevoke is called by an address that is not the agent's guardian
    error NotGuardian(uint256 agentId);
    /// @notice Thrown when an owner-gated function is called by a non-owner
    error NotNftOwner(uint256 agentId);
    /// @notice Thrown when guardianRevoke is called but no guardian is set for the agent
    error NoGuardianSet(uint256 agentId);
    /// @notice Thrown when a human has reached the maximum number of registered agents
    error TooManyAgentsForHuman(uint256 nullifier, uint256 max);
    /// @notice Thrown when the config index digit in userDefinedData is out of range [0..5]
    error InvalidConfigIndex(uint8 raw);
    /// @notice Thrown when a proof provider's verifyHumanProof call returns false
    error VerificationFailed();
    /// @notice Thrown when providerData is shorter than 32 bytes (missing agentKey)
    error ProviderDataTooShort();
    /// @notice Thrown when revokeHumanProof is called with a nullifier that doesn't match the agent's
    error NotSameHuman();
    /// @notice Thrown when setMetadata is called with the reserved "agentWallet" key
    error ReservedMetadataKey();
    /// @notice Thrown when setAgentWallet is called after the EIP-712 deadline has passed
    error DeadlineExpired();
    /// @notice Thrown when the EIP-712 wallet signature does not recover to the newWallet address
    error InvalidWalletSignature();
    /// @notice Thrown when setMaxProofAge is called with a zero value
    error InvalidMaxProofAge();
    /// @notice Thrown when metadataKeys and metadataValues arrays have different lengths
    error ArrayLengthMismatch(uint256 keysLength, uint256 valuesLength);

    // ====================================================
    // Events
    // ====================================================

    /// @notice Emitted when the contract is initialized
    event SelfAgentRegistryInitialized(address indexed hubV2, address indexed initialOwner);

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
    // Constructor & Initializer
    // ====================================================

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    /// @notice Initialize the registry with Hub V2 and owner, registering 6 verification configs
    /// @param hubV2 Address of the deployed IdentityVerificationHubV2
    /// @param initialOwner Address that receives SECURITY_ROLE and OPERATIONS_ROLE
    function initialize(address hubV2, address initialOwner) external initializer {
        __ImplRoot_init(initialOwner);
        __ERC721_init("Self Agent ID", "SAID");
        __SelfVerificationRoot_init(hubV2, "self-agent-id");
        __EIP712_init("SelfAgentRegistry", "1");

        SelfAgentRegistryStorage storage $ = _getSelfAgentRegistryStorage();
        $.nextAgentId = 1;
        $.maxAgentsPerHuman = 1;
        $.maxProofAge = 365 days;
        $.requireHumanProof = true;

        // Register 6 verification configs with Hub V2
        $.configIds[0] = _registerConfig(hubV2, 0, false);
        $.configIds[1] = _registerConfig(hubV2, 18, false);
        $.configIds[2] = _registerConfig(hubV2, 21, false);
        $.configIds[3] = _registerConfig(hubV2, 0, true);
        $.configIds[4] = _registerConfig(hubV2, 18, true);
        $.configIds[5] = _registerConfig(hubV2, 21, true);

        emit SelfAgentRegistryInitialized(hubV2, initialOwner);
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
    // Explicit Getter Functions (replace auto-generated public getters)
    // ====================================================

    /// @notice Returns the Hub V2 verification config ID at the given index
    function configIds(uint256 index) external view returns (bytes32) { return _getSelfAgentRegistryStorage().configIds[index]; }
    /// @notice Returns the human nullifier associated with the given agent
    function agentNullifier(uint256 id) external view returns (uint256) { return _getSelfAgentRegistryStorage().agentNullifier[id]; }
    /// @notice Returns the proof provider address that verified the given agent
    function agentProofProvider(uint256 id) external view returns (address) { return _getSelfAgentRegistryStorage().agentProofProvider[id]; }
    /// @notice Returns whether the given agent has an active human proof
    function agentHasHumanProof(uint256 id) external view returns (bool) { return _getSelfAgentRegistryStorage().agentHasHumanProof[id]; }
    /// @notice Returns the block number at which the given agent was registered
    function agentRegisteredAt(uint256 id) external view returns (uint256) { return _getSelfAgentRegistryStorage().agentRegisteredAt[id]; }
    /// @notice Returns the number of active agents for the given nullifier
    function activeAgentCount(uint256 n) external view returns (uint256) { return _getSelfAgentRegistryStorage().activeAgentCount[n]; }
    /// @notice Returns the agent ID mapped to the given agent key (0 if unregistered)
    function agentKeyToAgentId(bytes32 k) external view returns (uint256) { return _getSelfAgentRegistryStorage().agentKeyToAgentId[k]; }
    /// @notice Returns the agent key mapped to the given agent ID
    function agentIdToAgentKey(uint256 id) external view returns (bytes32) { return _getSelfAgentRegistryStorage().agentIdToAgentKey[id]; }
    /// @notice Returns whether the given address is an approved proof provider
    function approvedProviders(address p) external view returns (bool) { return _getSelfAgentRegistryStorage().approvedProviders[p]; }
    /// @notice Returns the SelfHumanProofProvider companion address
    function selfProofProvider() external view returns (address) { return _getSelfAgentRegistryStorage().selfProofProvider; }
    /// @notice Returns the guardian address for the given agent (address(0) if unset)
    function agentGuardian(uint256 id) external view returns (address) { return _getSelfAgentRegistryStorage().agentGuardian[id]; }
    /// @notice Returns the delegated credential metadata JSON for the given agent
    function agentMetadata(uint256 id) external view returns (string memory) { return _getSelfAgentRegistryStorage().agentMetadata[id]; }
    /// @notice Returns the current nonce for the given agent address (replay protection)
    function agentNonces(address a) external view returns (uint256) { return _getSelfAgentRegistryStorage().agentNonces[a]; }
    /// @notice Get the Ed25519 registration nonce for a given public key
    function ed25519Nonce(bytes32 pubkey) external view returns (uint256) {
        return _getSelfAgentRegistryStorage().ed25519Nonces[pubkey];
    }
    /// @notice Returns the maximum number of agents a single human can register (0 = unlimited)
    function maxAgentsPerHuman() external view returns (uint256) { return _getSelfAgentRegistryStorage().maxAgentsPerHuman; }
    /// @notice Returns the maximum age (seconds) of a human proof before reauthentication is required
    function maxProofAge() external view returns (uint256) { return _getSelfAgentRegistryStorage().maxProofAge; }
    /// @notice Returns whether the base register() overloads require human proof
    function requireHumanProof() external view returns (bool) { return _getSelfAgentRegistryStorage().requireHumanProof; }
    /// @notice Returns the linked SelfReputationRegistry address
    function reputationRegistry() external view returns (address) { return _getSelfAgentRegistryStorage().reputationRegistry; }
    /// @notice Returns the linked SelfValidationRegistry address
    function validationRegistry() external view returns (address) { return _getSelfAgentRegistryStorage().validationRegistry; }
    /// @notice Returns the unix timestamp at which the agent's human proof expires
    function proofExpiresAt(uint256 id) external view returns (uint256) { return _getSelfAgentRegistryStorage().proofExpiresAt[id]; }
    /// @notice Returns the current wallet-set nonce for the given agent (replay protection for setAgentWallet)
    function walletSetNonces(uint256 id) external view returns (uint256) { return _getSelfAgentRegistryStorage().walletSetNonces[id]; }
    /// @notice Returns the verification config ID used when this agent was registered
    function agentConfigId(uint256 id) external view returns (bytes32) { return _getSelfAgentRegistryStorage().agentConfigId[id]; }

    // ====================================================
    // Admin Functions
    // ====================================================

    /// @notice Set whether the base register() overloads require human proof
    function setRequireHumanProof(bool required) external onlyRole(SECURITY_ROLE) {
        _getSelfAgentRegistryStorage().requireHumanProof = required;
    }

    /// @notice Set the SelfHumanProofProvider companion address
    function setSelfProofProvider(address provider) external onlyRole(SECURITY_ROLE) {
        SelfAgentRegistryStorage storage $ = _getSelfAgentRegistryStorage();
        address oldProvider = $.selfProofProvider;
        if (oldProvider != address(0) && $.approvedProviders[oldProvider]) {
            $.approvedProviders[oldProvider] = false;
            emit ProofProviderRemoved(oldProvider);
        }
        $.selfProofProvider = provider;
        if (!$.approvedProviders[provider]) {
            $.approvedProviders[provider] = true;
            emit ProofProviderAdded(provider, IHumanProofProvider(provider).providerName());
        }
    }

    /// @notice Add a proof provider to the whitelist
    function addProofProvider(address provider) external onlyRole(SECURITY_ROLE) {
        SelfAgentRegistryStorage storage $ = _getSelfAgentRegistryStorage();
        if ($.approvedProviders[provider]) revert ProviderAlreadyApproved(provider);
        $.approvedProviders[provider] = true;
        emit ProofProviderAdded(provider, IHumanProofProvider(provider).providerName());
    }

    /// @notice Remove a proof provider from the whitelist
    function removeProofProvider(address provider) external onlyRole(SECURITY_ROLE) {
        SelfAgentRegistryStorage storage $ = _getSelfAgentRegistryStorage();
        if (!$.approvedProviders[provider]) revert ProviderNotApproved(provider);
        $.approvedProviders[provider] = false;
        emit ProofProviderRemoved(provider);
    }

    /// @notice Set the maximum number of agents a single human can register (0 = unlimited)
    function setMaxAgentsPerHuman(uint256 max) external onlyRole(OPERATIONS_ROLE) {
        _getSelfAgentRegistryStorage().maxAgentsPerHuman = max;
        emit MaxAgentsPerHumanUpdated(max);
    }

    /// @notice Set the maximum age of a human proof before reauthentication is required
    function setMaxProofAge(uint256 newMaxProofAge) external onlyRole(OPERATIONS_ROLE) {
        if (newMaxProofAge == 0) revert InvalidMaxProofAge();
        _getSelfAgentRegistryStorage().maxProofAge = newMaxProofAge;
        emit MaxProofAgeUpdated(newMaxProofAge);
    }

    /// @notice Set the linked SelfReputationRegistry address (pass address(0) to disable)
    function setReputationRegistry(address registry_) external onlyRole(OPERATIONS_ROLE) {
        _getSelfAgentRegistryStorage().reputationRegistry = registry_;
        emit ReputationRegistryUpdated(registry_);
    }

    /// @notice Set the linked SelfValidationRegistry address (pass address(0) to unlink)
    function setValidationRegistry(address registry_) external onlyRole(OPERATIONS_ROLE) {
        _getSelfAgentRegistryStorage().validationRegistry = registry_;
        emit ValidationRegistryUpdated(registry_);
    }

    // ====================================================
    // ERC-8004 Reputation Registry Compatibility
    // ====================================================

    /// @notice Check if a spender is the owner or an approved operator for a given agent.
    function isAuthorizedOrOwner(address spender, uint256 agentId) external view returns (bool) {
        address tokenOwner = ownerOf(agentId);
        return spender == tokenOwner
            || isApprovedForAll(tokenOwner, spender)
            || getApproved(agentId) == spender;
    }

    // ====================================================
    // SelfVerificationRoot Overrides
    // ====================================================

    /// @notice Returns the verification config based on the config digit in userDefinedData
    function getConfigId(
        bytes32,
        bytes32,
        bytes memory userDefinedData
    ) public view override returns (bytes32) {
        SelfAgentRegistryStorage storage $ = _getSelfAgentRegistryStorage();
        if (userDefinedData.length < 2) return $.configIds[0];

        uint8 raw = uint8(userDefinedData[1]);
        uint8 idx;

        if (raw >= 0x30 && raw <= 0x35) {
            idx = raw - 0x30;
        } else if (raw <= 0x05) {
            idx = raw;
        } else {
            revert InvalidConfigIndex(raw);
        }

        return $.configIds[idx];
    }

    /// @notice Processes the verified proof: mints NFT or burns NFT based on action byte
    function customVerificationHook(
        ISelfVerificationRoot.GenericDiscloseOutputV2 memory output,
        bytes memory userData
    ) internal override {
        if (userData.length == 0) revert InvalidUserData();

        uint256 nullifier = output.nullifier;
        address humanAddress = address(uint160(output.userIdentifier));
        uint8 actionByte = uint8(userData[0]);
        bytes32 configId_ = _resolveConfigId(userData);

        if (actionByte == ACTION_REGISTER) {
            bytes32 agentKey = bytes32(uint256(uint160(humanAddress)));
            _registerAgent(nullifier, agentKey, humanAddress, output, configId_);
        } else if (actionByte == ACTION_DEREGISTER) {
            bytes32 agentKey = bytes32(uint256(uint160(humanAddress)));
            _deregisterAgent(nullifier, agentKey);
        } else if (actionByte == ACTION_REGISTER_ADVANCED) {
            if (userData.length < 172) revert InvalidUserData();
            address agentAddr = _hexStringToAddress(userData, 2);
            bytes32 r = _hexStringToBytes32(userData, 42);
            bytes32 s = _hexStringToBytes32(userData, 106);
            uint8 v = _hexStringToUint8(userData, 170);
            bytes32 agentKey = _verifyAgentSignature(agentAddr, humanAddress, v, r, s);
            _registerAgent(nullifier, agentKey, humanAddress, output, configId_);
        } else if (actionByte == ACTION_DEREGISTER_ADVANCED) {
            if (userData.length < 42) revert InvalidUserData();
            address agentAddr = _hexStringToAddress(userData, 2);
            bytes32 agentKey = bytes32(uint256(uint160(agentAddr)));
            _deregisterAgent(nullifier, agentKey);
        } else if (actionByte == ACTION_REGISTER_WALLETFREE) {
            _handleWalletFreeRegistration(nullifier, humanAddress, userData, output, configId_);
        } else if (actionByte == ACTION_REGISTER_ED25519) {
            _handleEd25519Registration(nullifier, humanAddress, userData, output, configId_);
        } else if (actionByte == ACTION_REFRESH) {
            if (userData.length < 34) revert InvalidUserData(); // 1 action + 1 config + 32 agentId
            uint256 agentId;
            assembly {
                // bytes memory layout: first 32 bytes = length, then data
                // skip 32 byte length prefix + 2 data bytes (action + config) = offset 34
                agentId := mload(add(userData, 34))
            }
            _refreshAgent(agentId, nullifier, configId_, output);
        } else if (actionByte == ACTION_IDENTIFY) {
            SelfAgentRegistryStorage storage $id = _getSelfAgentRegistryStorage();
            emit NullifierIdentified(nullifier, $id.agentsByNullifier[nullifier].length);
        } else {
            revert InvalidAction(actionByte);
        }
    }

    // ====================================================
    // IERC8004ProofOfHuman — Registration
    // ====================================================

    /// @notice Self SDK convenience overload: register with URI and struct-based metadata batch
    function register(
        string calldata agentURI,
        MetadataEntry[] calldata _metadataEntries
    ) external returns (uint256 agentId) {
        SelfAgentRegistryStorage storage $ = _getSelfAgentRegistryStorage();
        if ($.requireHumanProof) revert ProofRequired();
        agentId = _baseRegister(msg.sender, agentURI);
        for (uint256 i = 0; i < _metadataEntries.length; i++) {
            _setMetadataInternal(agentId, _metadataEntries[i].metadataKey, _metadataEntries[i].metadataValue);
        }
    }

    /// @inheritdoc IERC8004
    function register(
        string calldata agentURI,
        string[] calldata metadataKeys,
        bytes[] calldata metadataValues
    ) external override returns (uint256 agentId) {
        if (metadataKeys.length != metadataValues.length) revert ArrayLengthMismatch(metadataKeys.length, metadataValues.length);
        SelfAgentRegistryStorage storage $ = _getSelfAgentRegistryStorage();
        if ($.requireHumanProof) revert ProofRequired();
        agentId = _baseRegister(msg.sender, agentURI);
        for (uint256 i = 0; i < metadataKeys.length; i++) {
            _setMetadataInternal(agentId, metadataKeys[i], metadataValues[i]);
        }
    }

    /// @notice ERC-8004 required: register with URI (no metadata)
    function register(string calldata agentURI) external override returns (uint256 agentId) {
        SelfAgentRegistryStorage storage $ = _getSelfAgentRegistryStorage();
        if ($.requireHumanProof) revert ProofRequired();
        return _baseRegister(msg.sender, agentURI);
    }

    /// @notice ERC-8004 required: register with no URI
    function register() external override returns (uint256 agentId) {
        SelfAgentRegistryStorage storage $ = _getSelfAgentRegistryStorage();
        if ($.requireHumanProof) revert ProofRequired();
        return _baseRegister(msg.sender, "");
    }

    /// @inheritdoc IERC8004ProofOfHuman
    function registerWithHumanProof(
        string calldata agentURI,
        address proofProvider_,
        bytes calldata proof,
        bytes calldata providerData
    ) external override returns (uint256) {
        SelfAgentRegistryStorage storage $ = _getSelfAgentRegistryStorage();
        if (!$.approvedProviders[proofProvider_]) revert ProviderNotApproved(proofProvider_);
        if (providerData.length < 32) revert ProviderDataTooShort();

        (bool verified, uint256 nullifier) = IHumanProofProvider(proofProvider_).verifyHumanProof(proof, providerData);
        if (!verified) revert VerificationFailed();

        bytes32 agentKey;
        assembly {
            agentKey := calldataload(providerData.offset)
        }

        string memory uri = agentURI;
        uint256 agentId = _mintAgent(nullifier, agentKey, proofProvider_, msg.sender, uri, bytes32(0), bytes32(0));
        return agentId;
    }

    /// @inheritdoc IERC8004ProofOfHuman
    function revokeHumanProof(
        uint256 agentId,
        address proofProvider_,
        bytes calldata proof,
        bytes calldata providerData
    ) external override {
        SelfAgentRegistryStorage storage $ = _getSelfAgentRegistryStorage();
        if (!$.approvedProviders[proofProvider_]) revert ProviderNotApproved(proofProvider_);
        if (!$.agentHasHumanProof[agentId]) revert AgentHasNoHumanProof(agentId);

        (bool verified, uint256 nullifier) = IHumanProofProvider(proofProvider_).verifyHumanProof(proof, providerData);
        if (!verified) revert VerificationFailed();
        if (nullifier != $.agentNullifier[agentId]) revert NotSameHuman();

        _revokeAgent(agentId);
    }

    // ====================================================
    // IERC8004ProofOfHuman — View Functions
    // ====================================================

    /// @inheritdoc IERC8004ProofOfHuman
    function hasHumanProof(uint256 agentId) external view override returns (bool) {
        return _getSelfAgentRegistryStorage().agentHasHumanProof[agentId];
    }

    /// @inheritdoc IERC8004ProofOfHuman
    function isProofFresh(uint256 agentId) external view override returns (bool) {
        SelfAgentRegistryStorage storage $ = _getSelfAgentRegistryStorage();
        return $.agentHasHumanProof[agentId] && block.timestamp < $.proofExpiresAt[agentId];
    }

    /// @inheritdoc IERC8004ProofOfHuman
    function getHumanNullifier(uint256 agentId) external view override returns (uint256) {
        return _getSelfAgentRegistryStorage().agentNullifier[agentId];
    }

    /// @inheritdoc IERC8004ProofOfHuman
    function getProofProvider(uint256 agentId) external view override returns (address) {
        return _getSelfAgentRegistryStorage().agentProofProvider[agentId];
    }

    /// @inheritdoc IERC8004ProofOfHuman
    function getAgentCountForHuman(uint256 nullifier) external view override returns (uint256) {
        return _getSelfAgentRegistryStorage().activeAgentCount[nullifier];
    }

    /// @inheritdoc IERC8004ProofOfHuman
    function getAgentsForNullifier(uint256 nullifier) external view override returns (uint256[] memory) {
        return _getSelfAgentRegistryStorage().agentsByNullifier[nullifier];
    }

    /// @inheritdoc IERC8004ProofOfHuman
    function getAgentsForNullifier(uint256 nullifier, uint256 offset, uint256 limit) external view override returns (uint256[] memory) {
        SelfAgentRegistryStorage storage $ = _getSelfAgentRegistryStorage();
        uint256[] storage all = $.agentsByNullifier[nullifier];
        if (offset >= all.length) return new uint256[](0);
        uint256 end = offset + limit;
        if (end > all.length) end = all.length;
        uint256[] memory result = new uint256[](end - offset);
        for (uint256 i = offset; i < end; i++) {
            result[i - offset] = all[i];
        }
        return result;
    }

    /// @inheritdoc IERC8004ProofOfHuman
    function sameHuman(uint256 agentIdA, uint256 agentIdB) external view override returns (bool) {
        SelfAgentRegistryStorage storage $ = _getSelfAgentRegistryStorage();
        if (!$.agentHasHumanProof[agentIdA] || !$.agentHasHumanProof[agentIdB]) return false;
        uint256 nullA = $.agentNullifier[agentIdA];
        return nullA != 0 && nullA == $.agentNullifier[agentIdB];
    }

    /// @inheritdoc IERC8004ProofOfHuman
    function isApprovedProvider(address provider) external view override returns (bool) {
        return _getSelfAgentRegistryStorage().approvedProviders[provider];
    }

    // ====================================================
    // Agent-Specific View Functions
    // ====================================================

    /// @notice Check if an agent key is currently verified and active
    function isVerifiedAgent(bytes32 agentKey) external view returns (bool) {
        SelfAgentRegistryStorage storage $ = _getSelfAgentRegistryStorage();
        uint256 agentId = $.agentKeyToAgentId[agentKey];
        if (agentId == 0) return false;
        return $.agentHasHumanProof[agentId];
    }

    /// @notice Get the agent ID for a given agent key
    function getAgentId(bytes32 agentKey) external view returns (uint256) {
        return _getSelfAgentRegistryStorage().agentKeyToAgentId[agentKey];
    }

    /// @notice Get the delegated credential metadata for an agent
    function getAgentMetadata(uint256 agentId) external view returns (string memory) {
        return _getSelfAgentRegistryStorage().agentMetadata[agentId];
    }

    /// @notice Get the ZK-attested credentials for an agent
    function getAgentCredentials(uint256 agentId) external view returns (AgentCredentials memory) {
        return _getSelfAgentRegistryStorage().agentCredentials[agentId];
    }

    /// @notice ERC-721 tokenURI override
    function tokenURI(uint256 tokenId) public view override returns (string memory) {
        _requireOwned(tokenId);
        return _getSelfAgentRegistryStorage().agentURIs[tokenId];
    }

    // ====================================================
    // Guardian Functions
    // ====================================================

    /// @notice Guardian force-revokes a compromised agent
    function guardianRevoke(uint256 agentId) external {
        SelfAgentRegistryStorage storage $ = _getSelfAgentRegistryStorage();
        address guardian = $.agentGuardian[agentId];
        if (guardian == address(0)) revert NoGuardianSet(agentId);
        if (msg.sender != guardian) revert NotGuardian(agentId);
        _revokeAgent(agentId);
    }

    /// @notice Agent (NFT owner) deregisters itself
    function selfDeregister(uint256 agentId) external {
        if (msg.sender != ownerOf(agentId)) revert NotNftOwner(agentId);
        _revokeAgent(agentId);
    }

    // ====================================================
    // Metadata Functions
    // ====================================================

    /// @notice Update delegated credential metadata for an agent
    function updateAgentMetadata(uint256 agentId, string calldata _agentMetadata) external {
        if (msg.sender != ownerOf(agentId)) revert NotNftOwner(agentId);
        _getSelfAgentRegistryStorage().agentMetadata[agentId] = _agentMetadata;
        emit AgentMetadataUpdated(agentId);
    }

    /// @inheritdoc IERC8004
    function setAgentURI(uint256 agentId, string calldata newURI) external override {
        if (msg.sender != ownerOf(agentId)) revert NotNftOwner(agentId);
        _getSelfAgentRegistryStorage().agentURIs[agentId] = newURI;
        emit URIUpdated(agentId, newURI, msg.sender);
    }

    /// @inheritdoc IERC8004
    function getMetadata(uint256 agentId, string memory metadataKey) external view override returns (bytes memory) {
        return _getSelfAgentRegistryStorage().metadata[agentId][metadataKey];
    }

    /// @inheritdoc IERC8004
    function setMetadata(uint256 agentId, string calldata metadataKey, bytes calldata metadataValue) external override {
        if (msg.sender != ownerOf(agentId)) revert NotNftOwner(agentId);
        if (keccak256(bytes(metadataKey)) == _RESERVED_AGENT_WALLET_KEY_HASH) revert ReservedMetadataKey();
        _setMetadataInternal(agentId, metadataKey, metadataValue);
    }

    // ====================================================
    // Agent Wallet Functions (ERC-8004 + EIP-712)
    // ====================================================

    /// @notice Returns the EIP-712 domain separator for this contract
    function domainSeparator() external view returns (bytes32) {
        return _domainSeparatorV4();
    }

    /// @inheritdoc IERC8004
    function setAgentWallet(
        uint256 agentId,
        address newWallet,
        uint256 deadline,
        bytes calldata signature
    ) external override {
        SelfAgentRegistryStorage storage $ = _getSelfAgentRegistryStorage();
        if (msg.sender != ownerOf(agentId)) revert NotNftOwner(agentId);
        if (block.timestamp > deadline) revert DeadlineExpired();

        uint256 nonce = $.walletSetNonces[agentId]++;

        bytes32 structHash = keccak256(abi.encode(
            AGENT_WALLET_SET_TYPEHASH,
            agentId,
            newWallet,
            msg.sender,
            nonce,
            deadline
        ));
        address recovered = ECDSA.recover(_hashTypedDataV4(structHash), signature);
        if (recovered != newWallet) revert InvalidWalletSignature();

        _setMetadataInternal(agentId, "agentWallet", abi.encode(newWallet));
    }

    /// @inheritdoc IERC8004
    function getAgentWallet(uint256 agentId) external view override returns (address) {
        bytes memory raw = _getSelfAgentRegistryStorage().metadata[agentId]["agentWallet"];
        if (raw.length == 0) return address(0);
        return abi.decode(raw, (address));
    }

    /// @inheritdoc IERC8004
    function unsetAgentWallet(uint256 agentId) external override {
        if (msg.sender != ownerOf(agentId)) revert NotNftOwner(agentId);
        SelfAgentRegistryStorage storage $ = _getSelfAgentRegistryStorage();
        if ($.metadata[agentId]["agentWallet"].length == 0) return;
        delete $.metadata[agentId]["agentWallet"];
        emit MetadataSet(agentId, "agentWallet", "agentWallet", bytes(""));
    }

    // ====================================================
    // Internal Logic
    // ====================================================

    /// @dev Base registration without proof — only callable when requireHumanProof is false.
    function _baseRegister(address to, string memory agentURI) internal returns (uint256 agentId) {
        SelfAgentRegistryStorage storage $ = _getSelfAgentRegistryStorage();
        agentId = $.nextAgentId++;
        _mint(to, agentId);
        if (bytes(agentURI).length > 0) $.agentURIs[agentId] = agentURI;
        emit Registered(agentId, agentURI, to);
    }

    /// @dev Internal setter — no owner check.
    function _setMetadataInternal(uint256 agentId, string memory metadataKey, bytes memory metadataValue) internal {
        _getSelfAgentRegistryStorage().metadata[agentId][metadataKey] = metadataValue;
        emit MetadataSet(agentId, metadataKey, metadataKey, metadataValue);
    }

    /// @dev Resolve the verification configId from userData (mirrors getConfigId logic)
    function _resolveConfigId(bytes memory userData) internal view returns (bytes32) {
        SelfAgentRegistryStorage storage $ = _getSelfAgentRegistryStorage();
        if (userData.length < 2) return $.configIds[0];
        uint8 raw = uint8(userData[1]);
        uint8 idx;
        if (raw >= 0x30 && raw <= 0x35) {
            idx = raw - 0x30;
        } else if (raw <= 0x05) {
            idx = raw;
        } else {
            revert InvalidConfigIndex(raw);
        }
        return $.configIds[idx];
    }

    /// @notice Mint a new agent NFT and store proof data
    function _mintAgent(
        uint256 nullifier,
        bytes32 agentKey,
        address proofProvider_,
        address to,
        string memory agentURI,
        bytes32 attestationId,
        bytes32 configId_
    ) internal returns (uint256 agentId) {
        SelfAgentRegistryStorage storage $ = _getSelfAgentRegistryStorage();
        if ($.agentKeyToAgentId[agentKey] != 0) revert AgentAlreadyRegistered(agentKey);
        if ($.maxAgentsPerHuman > 0 && $.activeAgentCount[nullifier] >= $.maxAgentsPerHuman) {
            revert TooManyAgentsForHuman(nullifier, $.maxAgentsPerHuman);
        }

        agentId = $.nextAgentId++;

        _mint(to, agentId);

        $.agentNullifier[agentId] = nullifier;
        $.agentProofProvider[agentId] = proofProvider_;
        $.agentHasHumanProof[agentId] = true;
        $.agentRegisteredAt[agentId] = block.number;
        $.activeAgentCount[nullifier]++;
        $.agentIndexInNullifier[agentId] = $.agentsByNullifier[nullifier].length;
        $.agentsByNullifier[nullifier].push(agentId);
        $.agentKeyToAgentId[agentKey] = agentId;
        $.agentIdToAgentKey[agentId] = agentKey;
        $.agentConfigId[agentId] = configId_;

        if (bytes(agentURI).length > 0) {
            $.agentURIs[agentId] = agentURI;
        }

        $.proofExpiresAt[agentId] = block.timestamp + $.maxProofAge;

        if ($.reputationRegistry != address(0)) {
            ISelfReputationRegistryMinimal($.reputationRegistry).recordHumanProofFeedback(agentId, attestationId);
        }

        emit AgentRegisteredWithHumanProof(
            agentId,
            proofProvider_,
            nullifier,
            IHumanProofProvider(proofProvider_).verificationStrength()
        );
        emit Registered(agentId, agentURI, to);

        return agentId;
    }

    /// @notice Register an agent through the Hub V2 callback flow
    function _registerAgent(
        uint256 nullifier,
        bytes32 agentKey,
        address humanAddress,
        ISelfVerificationRoot.GenericDiscloseOutputV2 memory output,
        bytes32 configId_
    ) internal {
        SelfAgentRegistryStorage storage $ = _getSelfAgentRegistryStorage();
        address provider = $.selfProofProvider;
        uint256 agentId = _mintAgent(nullifier, agentKey, provider, humanAddress, "", output.attestationId, configId_);
        _storeCredentials(agentId, output);
    }

    /// @notice Register a wallet-free agent (agent-owned NFT with optional guardian)
    function _registerAgentWalletFree(
        uint256 nullifier,
        bytes32 agentKey,
        address agentAddress,
        address guardian,
        ISelfVerificationRoot.GenericDiscloseOutputV2 memory output,
        bytes32 configId_
    ) internal {
        SelfAgentRegistryStorage storage $ = _getSelfAgentRegistryStorage();
        address provider = $.selfProofProvider;
        uint256 agentId = _mintAgent(nullifier, agentKey, provider, agentAddress, "", output.attestationId, configId_);
        _storeCredentials(agentId, output);

        if (guardian != address(0)) {
            $.agentGuardian[agentId] = guardian;
            emit GuardianSet(agentId, guardian);
        }
    }

    /// @dev Parse wallet-free userData fields, verify signature, and register — extracted to avoid stack-too-deep
    function _handleWalletFreeRegistration(
        uint256 nullifier,
        address humanAddress,
        bytes memory userData,
        ISelfVerificationRoot.GenericDiscloseOutputV2 memory output,
        bytes32 configId_
    ) internal {
        if (userData.length < 212) revert InvalidUserData();
        address agentAddr = _hexStringToAddress(userData, 2);
        address guardian = _hexStringToAddress(userData, 42);
        bytes32 r = _hexStringToBytes32(userData, 82);
        bytes32 s = _hexStringToBytes32(userData, 146);
        uint8 v = _hexStringToUint8(userData, 210);
        bytes32 agentKey = _verifyAgentSignature(agentAddr, humanAddress, v, r, s);
        _registerAgentWalletFree(nullifier, agentKey, agentAddr, guardian, output, configId_);
    }

    /// @dev Parse Ed25519 userData fields, verify signature, and register — extracted to avoid stack-too-deep
    function _handleEd25519Registration(
        uint256 nullifier,
        address humanAddress,
        bytes memory userData,
        ISelfVerificationRoot.GenericDiscloseOutputV2 memory output,
        bytes32 configId_
    ) internal {
        if (userData.length < 554) revert InvalidUserData();
        bytes32 ed25519Pubkey = _hexStringToBytes32(userData, 2);
        bytes32 sigR = _hexStringToBytes32(userData, 66);
        bytes32 sigS = _hexStringToBytes32(userData, 130);
        uint256[5] memory extKpub;
        extKpub[0] = uint256(_hexStringToBytes32(userData, 194));
        extKpub[1] = uint256(_hexStringToBytes32(userData, 258));
        extKpub[2] = uint256(_hexStringToBytes32(userData, 322));
        extKpub[3] = uint256(_hexStringToBytes32(userData, 386));
        extKpub[4] = uint256(_hexStringToBytes32(userData, 450));
        address guardian = _hexStringToAddress(userData, 514);

        bytes32 agentKey = _verifyEd25519Signature(ed25519Pubkey, sigR, sigS, extKpub, humanAddress);
        address derivedAddr = Ed25519Verifier.deriveAddress(ed25519Pubkey);
        _registerAgentEd25519(nullifier, agentKey, derivedAddr, guardian, output, configId_);
    }

    /// @notice Register an Ed25519 agent (NFT minted to derived address, optional guardian)
    function _registerAgentEd25519(
        uint256 nullifier,
        bytes32 agentKey,
        address derivedAddr,
        address guardian,
        ISelfVerificationRoot.GenericDiscloseOutputV2 memory output,
        bytes32 configId_
    ) internal {
        SelfAgentRegistryStorage storage $ = _getSelfAgentRegistryStorage();
        address provider = $.selfProofProvider;
        uint256 agentId = _mintAgent(nullifier, agentKey, provider, derivedAddr, "", output.attestationId, configId_);
        _storeCredentials(agentId, output);

        if (guardian != address(0)) {
            $.agentGuardian[agentId] = guardian;
            emit GuardianSet(agentId, guardian);
        }
    }

    /// @notice Deregister an agent through the Hub V2 callback flow
    function _deregisterAgent(uint256 nullifier, bytes32 agentKey) internal {
        SelfAgentRegistryStorage storage $ = _getSelfAgentRegistryStorage();
        uint256 agentId = $.agentKeyToAgentId[agentKey];
        if (agentId == 0) revert AgentNotRegistered(agentKey);
        if ($.agentNullifier[agentId] != nullifier) {
            revert NotAgentOwner($.agentNullifier[agentId], nullifier);
        }

        _revokeAgent(agentId);
    }

    /// @notice Revoke an agent's human proof and burn the NFT
    function _revokeAgent(uint256 agentId) internal {
        SelfAgentRegistryStorage storage $ = _getSelfAgentRegistryStorage();
        uint256 nullifier = $.agentNullifier[agentId];

        bytes32 key = $.agentIdToAgentKey[agentId];
        if (key != bytes32(0)) {
            delete $.agentKeyToAgentId[key];
            delete $.agentIdToAgentKey[agentId];
        }

        $.agentHasHumanProof[agentId] = false;
        if ($.activeAgentCount[nullifier] > 0) {
            $.activeAgentCount[nullifier]--;
        }

        // Remove from nullifier reverse mapping (swap-and-pop)
        uint256[] storage nullifierAgents = $.agentsByNullifier[nullifier];
        uint256 idx = $.agentIndexInNullifier[agentId];
        uint256 lastIdx = nullifierAgents.length - 1;
        if (idx != lastIdx) {
            uint256 lastAgentId = nullifierAgents[lastIdx];
            nullifierAgents[idx] = lastAgentId;
            $.agentIndexInNullifier[lastAgentId] = idx;
        }
        nullifierAgents.pop();
        delete $.agentIndexInNullifier[agentId];

        delete $.agentNullifier[agentId];
        delete $.agentProofProvider[agentId];
        delete $.agentGuardian[agentId];
        delete $.agentMetadata[agentId];
        delete $.agentCredentials[agentId];
        delete $.agentURIs[agentId];
        delete $.proofExpiresAt[agentId];
        delete $.agentConfigId[agentId];

        _burn(agentId);

        emit HumanProofRevoked(agentId, nullifier);
    }

    /// @notice Store ZK-attested credential claims from the Hub V2 disclosure output
    function _storeCredentials(
        uint256 agentId,
        ISelfVerificationRoot.GenericDiscloseOutputV2 memory output
    ) internal {
        SelfAgentRegistryStorage storage $ = _getSelfAgentRegistryStorage();
        AgentCredentials storage creds = $.agentCredentials[agentId];
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

        uint256 docExpiry = _parseYYMMDDToTimestamp(output.expiryDate);
        uint256 ageExpiry = block.timestamp + $.maxProofAge;
        $.proofExpiresAt[agentId] = (docExpiry > 0 && docExpiry < ageExpiry) ? docExpiry : ageExpiry;
    }

    /// @notice Refreshes an existing agent's proof without burning/minting
    function _refreshAgent(
        uint256 agentId,
        uint256 nullifier,
        bytes32 configId_,
        ISelfVerificationRoot.GenericDiscloseOutputV2 memory output
    ) internal {
        SelfAgentRegistryStorage storage $ = _getSelfAgentRegistryStorage();

        // Precondition: agent must have active proof
        if (!$.agentHasHumanProof[agentId]) revert AgentHasNoHumanProof(agentId);

        // Precondition: same verification config (prevents proof strength downgrade)
        // Also catches external-provider agents (configId == 0) which cannot be refreshed via Hub
        bytes32 storedConfig = $.agentConfigId[agentId];
        if (storedConfig == bytes32(0)) revert RefreshNotSupported(agentId);
        if (storedConfig != configId_) {
            revert ConfigMismatch(storedConfig, configId_);
        }

        // Precondition: nullifier must match
        if ($.agentNullifier[agentId] != nullifier) {
            revert NotAgentOwner($.agentNullifier[agentId], nullifier);
        }

        // Overwrite credentials and update proofExpiresAt
        _storeCredentials(agentId, output);

        emit HumanProofRefreshed(agentId, nullifier, $.proofExpiresAt[agentId], configId_);
    }

    // ====================================================
    // Advanced Mode — Signature Verification
    // ====================================================

    /// @dev Verify an ECDSA signature from the agent address, increment nonce, and return the agent key
    function _verifyAgentSignature(
        address agentAddress,
        address humanAddress,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) internal returns (bytes32 agentKey) {
        SelfAgentRegistryStorage storage $ = _getSelfAgentRegistryStorage();
        uint256 nonce = $.agentNonces[agentAddress];
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
        $.agentNonces[agentAddress] = nonce + 1;
        return bytes32(uint256(uint160(agentAddress)));
    }

    /// @dev Verify an Ed25519 challenge signature from the agent, increment nonce, return agentKey
    function _verifyEd25519Signature(
        bytes32 ed25519Pubkey,
        bytes32 sigR,
        bytes32 sigS,
        uint256[5] memory extKpub,
        address humanAddress
    ) internal returns (bytes32 agentKey) {
        SelfAgentRegistryStorage storage $ = _getSelfAgentRegistryStorage();
        uint256 nonce = $.ed25519Nonces[ed25519Pubkey];

        // Reconstruct challenge message
        bytes32 messageHash = keccak256(abi.encodePacked(
            "self-agent-id:register-ed25519:",
            humanAddress,
            block.chainid,
            address(this),
            nonce
        ));

        // Verify Ed25519 signature over the challenge hash
        bool valid = Ed25519Verifier.verify(
            string(abi.encodePacked(messageHash)),
            uint256(sigR),
            uint256(sigS),
            extKpub
        );
        if (!valid) revert InvalidAgentSignature();

        $.ed25519Nonces[ed25519Pubkey] = nonce + 1;
        return ed25519Pubkey; // The raw Ed25519 pubkey IS the agentKey
    }

    // ====================================================
    // Advanced Mode — Hex String Parsing
    // ====================================================

    /// @dev Convert a single hex ASCII character to its 4-bit nibble value
    function _hexCharToNibble(uint8 c) internal pure returns (uint8) {
        if (c >= 0x30 && c <= 0x39) return c - 0x30;
        if (c >= 0x61 && c <= 0x66) return c - 0x61 + 10;
        if (c >= 0x41 && c <= 0x46) return c - 0x41 + 10;
        revert InvalidUserData();
    }

    /// @dev Parse 40 hex characters from data at offset into an address
    function _hexStringToAddress(bytes memory data, uint256 offset) internal pure returns (address) {
        uint160 result;
        for (uint256 i = 0; i < 40; i++) {
            result = result * 16 + uint160(_hexCharToNibble(uint8(data[offset + i])));
        }
        return address(result);
    }

    /// @dev Parse 64 hex characters from data at offset into a bytes32
    function _hexStringToBytes32(bytes memory data, uint256 offset) internal pure returns (bytes32) {
        uint256 result;
        for (uint256 i = 0; i < 64; i++) {
            result = result * 16 + uint256(_hexCharToNibble(uint8(data[offset + i])));
        }
        return bytes32(result);
    }

    /// @dev Parse 2 hex characters from data at offset into a uint8
    function _hexStringToUint8(bytes memory data, uint256 offset) internal pure returns (uint8) {
        return _hexCharToNibble(uint8(data[offset])) * 16 + _hexCharToNibble(uint8(data[offset + 1]));
    }

    // ====================================================
    // Date Parsing Utilities
    // ====================================================

    /// @dev Return cumulative day count for the start of month mm (1-based), accounting for leap years
    function _daysInMonths(uint256 year, uint256 mm) internal pure returns (uint256) {
        uint256[12] memory days_ = [uint256(0), 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334];
        if (mm == 0 || mm > 12) return 0;
        uint256 d = days_[mm - 1];
        if (mm > 2 && (year % 4 == 0 && (year % 100 != 0 || year % 400 == 0))) d += 1;
        return d;
    }

    /// @dev Parse a 6-character YYMMDD date string into a unix timestamp (returns 0 on invalid input)
    function _parseYYMMDDToTimestamp(string memory dateStr) internal pure returns (uint256) {
        bytes memory d = bytes(dateStr);
        if (d.length != 6) return 0;
        uint256 yy = (uint8(d[0]) - 48) * 10 + (uint8(d[1]) - 48);
        uint256 mm = (uint8(d[2]) - 48) * 10 + (uint8(d[3]) - 48);
        uint256 dd = (uint8(d[4]) - 48) * 10 + (uint8(d[5]) - 48);
        uint256 year = yy < 50 ? 2000 + yy : 1900 + yy;
        uint256 daysSinceEpoch = (year - 1970) * 365 + (year - 1969) / 4 + _daysInMonths(year, mm) + dd - 1;
        return daysSinceEpoch * 1 days;
    }

    // ====================================================
    // ERC-165 Interface Detection
    // ====================================================

    /// @notice Returns true if the contract implements the queried interface (ERC-165)
    function supportsInterface(bytes4 interfaceId)
        public view override(ERC721Upgradeable, AccessControlUpgradeable, IERC165)
        returns (bool)
    {
        return interfaceId == type(IERC8004).interfaceId
            || interfaceId == type(IERC8004ProofOfHuman).interfaceId
            || ERC721Upgradeable.supportsInterface(interfaceId)
            || AccessControlUpgradeable.supportsInterface(interfaceId);
    }

    // ====================================================
    // Soulbound — Block Transfers
    // ====================================================

    /// @dev Soulbound enforcement: reverts on transfer (mint and burn are allowed)
    function _update(address to, uint256 tokenId, address auth) internal override returns (address) {
        address from = _ownerOf(tokenId);
        if (from != address(0) && to != address(0)) revert TransferNotAllowed();
        return super._update(to, tokenId, auth);
    }
}

/// @dev Minimal interface used by SelfAgentRegistry to call recordHumanProofFeedback
interface ISelfReputationRegistryMinimal {
    /// @notice Record an automatic proof-of-human feedback entry for the given agent
    function recordHumanProofFeedback(uint256 agentId, bytes32 attestationId) external;
}
