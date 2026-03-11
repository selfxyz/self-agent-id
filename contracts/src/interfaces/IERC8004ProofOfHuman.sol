// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import { IERC8004 } from "./IERC8004.sol";

/// @title IERC8004ProofOfHuman
/// @author Self Protocol
/// @notice Optional extension for ERC-8004 Identity Registries that bind agent
///         identities to verified unique humans via privacy-preserving proofs.
/// @dev Implementations MUST also implement IERC8004 (and therefore ERC-165).
///      The human is identified by a nullifier — a scoped, opaque identifier that
///      is unique per (human, service) pair. The nullifier is derived by the proof
///      provider; raw biometric data is never stored on-chain.
///
///      Verification strength (0-100 scale):
///        100 = Government-issued ID with NFC chip + biometric verification
///         60 = Government-issued ID without chip
///         40 = Video liveness check
///          0 = No verification
interface IERC8004ProofOfHuman is IERC8004 {

    // ---- Events ----

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

    /// @notice Emitted when the maximum proof age is updated
    event MaxProofAgeUpdated(uint256 newMaxProofAge);

    /// @notice Emitted when the per-human agent cap is updated
    event MaxAgentsPerHumanUpdated(uint256 newMax);

    /// @notice Emitted when an agent's human proof is refreshed in-place
    event HumanProofRefreshed(uint256 indexed agentId, uint256 nullifier, uint256 newExpiresAt, bytes32 configId);

    /// @notice Emitted when a human identifies themselves via passport scan (read-only, no state changes)
    event NullifierIdentified(uint256 indexed nullifier, uint256 agentCount);

    // ---- Errors ----

    error ConfigMismatch(bytes32 expected, bytes32 actual);
    error RefreshNotSupported(uint256 agentId);

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

    /// @notice Returns all agent IDs registered by the human identified by nullifier
    function getAgentsForNullifier(uint256 nullifier) external view returns (uint256[] memory);

    /// @notice Returns a paginated slice of agent IDs for a nullifier
    function getAgentsForNullifier(uint256 nullifier, uint256 offset, uint256 limit) external view returns (uint256[] memory);

    /// @notice Returns true if two agents belong to the same human (same nullifier)
    function sameHuman(uint256 agentIdA, uint256 agentIdB) external view returns (bool);

    /// @notice Returns true if the given address is an approved proof provider
    function isApprovedProvider(address provider) external view returns (bool);
}
