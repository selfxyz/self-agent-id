// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import { IERC165 } from "@openzeppelin/contracts/utils/introspection/IERC165.sol";

/// @title IERC8004ProofOfHuman
/// @author Self Protocol
/// @notice Optional extension for ERC-8004 Identity Registries that bind agent
///         identities to verified unique humans via privacy-preserving proofs.
/// @dev Implementations MUST also implement ERC-8004 and ERC-165.
///      The human is identified by a nullifier — a scoped, opaque identifier that
///      is unique per (human, service) pair. The nullifier is derived by the proof
///      provider; raw biometric data is never stored on-chain.
///
///      Verification strength (0-100 scale):
///        100 = Government-issued ID with NFC chip + biometric verification
///         60 = Government-issued ID without chip
///         40 = Video liveness check
///          0 = No verification
interface IERC8004ProofOfHuman is IERC165 {

    // ---- Events ----

    /// @notice Emitted when an agent is registered (ERC-8004 required)
    event Registered(uint256 indexed agentId, string agentURI, address indexed owner);

    /// @notice Emitted when an agent URI is updated
    event URIUpdated(uint256 indexed agentId, string newURI, address indexed updatedBy);

    /// @notice Emitted when an agent's human proof is registered
    event AgentRegisteredWithHumanProof(
        uint256 indexed agentId,
        address indexed proofProvider,
        uint256 nullifier,
        uint8 verificationStrength
    );

    /// @notice Emitted when an agent's human proof is revoked
    event HumanProofRevoked(uint256 indexed agentId, uint256 nullifier);

    /// @notice Emitted when a proof provider is added to the approved list
    event ProofProviderAdded(address indexed provider, string name);

    /// @notice Emitted when a proof provider is removed from the approved list
    event ProofProviderRemoved(address indexed provider);

    /// @notice Emitted when on-chain metadata is set for an agent
    /// @dev `indexedMetadataKey` is keccak256(metadataKey) stored as a topic (for log filtering).
    ///      `metadataKey` contains the original string (for log reading).
    ///      Off-chain subscribers MUST read `metadataKey` to recover the original key string.
    event MetadataSet(
        uint256 indexed agentId,
        string indexed indexedMetadataKey,
        string metadataKey,
        bytes metadataValue
    );

    /// @notice Emitted when the maximum proof age is updated
    event MaxProofAgeUpdated(uint256 newMaxProofAge);

    /// @notice Emitted when the per-human agent cap is updated
    event MaxAgentsPerHumanUpdated(uint256 newMax);

    // ---- ERC-8004 Base Registration (required for interface compliance) ----

    /// @notice Register an agent with no URI or metadata (base ERC-8004 minimum)
    /// @dev Implementations with requireHumanProof=true MUST revert with ProofRequired()
    function register() external returns (uint256 agentId);

    /// @notice Register an agent with a URI
    function register(string calldata agentURI) external returns (uint256 agentId);

    /// @notice Register an agent with a URI and initial metadata
    /// @dev MUST revert if metadataKeys.length != metadataValues.length
    function register(
        string calldata agentURI,
        string[] calldata metadataKeys,
        bytes[] calldata metadataValues
    ) external returns (uint256 agentId);

    // ---- Proof-of-Human Registration ----

    /// @notice Register an agent with a human proof from an approved provider
    /// @param agentURI The ERC-8004 registration file URI
    /// @param proofProvider Address of the approved IHumanProofProvider
    /// @param proof The proof payload for the provider to verify
    /// @param providerData Additional data required by the provider
    /// @return agentId The newly registered agent ID
    function registerWithHumanProof(
        string calldata agentURI,
        address proofProvider,
        bytes calldata proof,
        bytes calldata providerData
    ) external returns (uint256 agentId);

    /// @notice Revoke an agent's human proof (requires re-proving same human)
    function revokeHumanProof(
        uint256 agentId,
        address proofProvider,
        bytes calldata proof,
        bytes calldata providerData
    ) external;

    // ---- Agent URI ----

    /// @notice Update the agentURI for an agent
    function setAgentURI(uint256 agentId, string calldata newURI) external;

    // ---- Metadata ----

    /// @notice Get a metadata value for an agent
    function getMetadata(uint256 agentId, string memory key) external view returns (bytes memory);

    /// @notice Set a metadata value for an agent (caller must own the NFT)
    function setMetadata(uint256 agentId, string calldata key, bytes calldata value) external;

    // ---- Agent Wallet ----

    /// @notice Set a payment wallet address for an agent (requires EIP-712 signature from newWallet)
    function setAgentWallet(
        uint256 agentId,
        address newWallet,
        uint256 deadline,
        bytes calldata signature
    ) external;

    /// @notice Get the payment wallet address for an agent (returns address(0) if unset)
    function getAgentWallet(uint256 agentId) external view returns (address);

    /// @notice Clear the payment wallet address for an agent
    function unsetAgentWallet(uint256 agentId) external;

    // ---- Proof View Functions ----

    /// @notice Returns true if the agent has ever had a human proof registered (ignores expiry)
    function hasHumanProof(uint256 agentId) external view returns (bool);

    /// @notice Returns the unix timestamp after which reauthentication is required (0 = no expiry)
    function proofExpiresAt(uint256 agentId) external view returns (uint256);

    /// @notice Returns true if the proof is active and within its validity window
    function isProofFresh(uint256 agentId) external view returns (bool);

    /// @notice Returns the nullifier for the human who owns this agent
    function getHumanNullifier(uint256 agentId) external view returns (uint256);

    /// @notice Returns the proof provider address used to verify this agent
    function getProofProvider(uint256 agentId) external view returns (address);

    /// @notice Returns the number of active agents registered by the same human
    function getAgentCountForHuman(uint256 nullifier) external view returns (uint256);

    /// @notice Returns true if two agents belong to the same human (same nullifier)
    function sameHuman(uint256 agentIdA, uint256 agentIdB) external view returns (bool);

    /// @notice Returns true if the given address is an approved proof provider
    function isApprovedProvider(address provider) external view returns (bool);
}
