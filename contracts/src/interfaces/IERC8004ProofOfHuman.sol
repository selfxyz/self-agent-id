// SPDX-License-Identifier: MIT

pragma solidity 0.8.28;

/// @title IERC8004ProofOfHuman
/// @notice Extension to ERC-8004 Identity Registry adding proof-of-human verification
/// @dev Adds the ability to register agents with verifiable proof that they are
///      backed by a unique human. The proof is verified on-chain by a whitelisted
///      IHumanProofProvider (e.g. Self Protocol, Worldcoin).
///
///      This makes proof-of-human a first-class, trustless property of agent identity,
///      rather than relying on a validator's attestation in the Validation Registry.
interface IERC8004ProofOfHuman {
    /// @notice Emitted when an agent is registered with proof-of-human
    event AgentRegisteredWithHumanProof(
        uint256 indexed agentId,
        address indexed proofProvider,
        uint256 nullifier,
        uint8 verificationStrength
    );

    /// @notice Emitted when an agent's human proof is revoked
    event HumanProofRevoked(uint256 indexed agentId, uint256 nullifier);

    /// @notice Emitted when a new proof provider is added to the whitelist
    event ProofProviderAdded(address indexed provider, string name);

    /// @notice Emitted when a proof provider is removed from the whitelist
    event ProofProviderRemoved(address indexed provider);

    /// @notice Register an agent with verifiable proof-of-human
    /// @param agentURI Standard ERC-8004 agent metadata URI
    /// @param proofProvider Address of the IHumanProofProvider contract
    /// @param proof The proof data (passed to provider's verifyHumanProof)
    /// @param providerData Provider-specific context data
    /// @return agentId The ERC-8004 agent token ID
    function registerWithHumanProof(
        string calldata agentURI,
        address proofProvider,
        bytes calldata proof,
        bytes calldata providerData
    ) external returns (uint256 agentId);

    /// @notice Revoke an agent's human proof (deregistration)
    /// @dev Only callable by the human who registered the agent (same nullifier)
    /// @param agentId The agent to deregister
    /// @param proofProvider Address of the IHumanProofProvider contract
    /// @param proof Proof that the caller is the same human (produces same nullifier)
    /// @param providerData Provider-specific context data
    function revokeHumanProof(
        uint256 agentId,
        address proofProvider,
        bytes calldata proof,
        bytes calldata providerData
    ) external;

    /// @notice Check if an agent has verified proof-of-human
    /// @param agentId The agent to check
    /// @return True if the agent has an active proof-of-human
    function hasHumanProof(uint256 agentId) external view returns (bool);

    /// @notice Get the nullifier (sybil-resistant human identifier) for an agent
    /// @param agentId The agent to query
    /// @return The nullifier (0 if no human proof)
    function getHumanNullifier(uint256 agentId) external view returns (uint256);

    /// @notice Get the proof provider that verified an agent
    /// @param agentId The agent to query
    /// @return The provider address (address(0) if no human proof)
    function getProofProvider(uint256 agentId) external view returns (address);

    /// @notice Get the number of active agents for a human (by nullifier)
    /// @param nullifier The human's nullifier
    /// @return The count of active agents
    function getAgentCountForHuman(uint256 nullifier) external view returns (uint256);

    /// @notice Check if two agents are backed by the same human
    /// @param agentIdA First agent
    /// @param agentIdB Second agent
    /// @return True if both agents share the same non-zero nullifier
    function sameHuman(uint256 agentIdA, uint256 agentIdB) external view returns (bool);

    /// @notice Check if a proof provider is whitelisted
    /// @param provider The provider address to check
    /// @return True if the provider is whitelisted
    function isApprovedProvider(address provider) external view returns (bool);
}
