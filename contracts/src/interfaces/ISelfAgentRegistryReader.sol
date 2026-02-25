// SPDX-License-Identifier: MIT

pragma solidity 0.8.28;

/// @title ISelfAgentRegistryReader
/// @author Self Protocol
/// @notice Minimal read-only interface for querying SelfAgentRegistry state.
/// @dev Used by provider contracts (reputation, validation) to avoid importing the full registry.
interface ISelfAgentRegistryReader {
    /// @notice Check if an agent has an active human proof
    /// @param agentId The agent to query
    /// @return True if the agent has a verified human proof
    function hasHumanProof(uint256 agentId) external view returns (bool);

    /// @notice Get the address of the proof provider that verified an agent
    /// @param agentId The agent to query
    /// @return The provider contract address (address(0) if none)
    function getProofProvider(uint256 agentId) external view returns (address);

    /// @notice Get the block number at which an agent was registered
    /// @param agentId The agent to query
    /// @return The registration block number (0 if not registered)
    function agentRegisteredAt(uint256 agentId) external view returns (uint256);

    /// @notice ERC-8004 Reputation Registry compatibility: check if spender is owner or operator
    /// @dev Reverts with ERC721NonexistentToken if agentId has not been minted.
    /// @param spender The address to check
    /// @param agentId The agent token ID
    /// @return True if spender is owner, ERC-721 approved, or isApprovedForAll operator
    function isAuthorizedOrOwner(address spender, uint256 agentId) external view returns (bool);

    /// @notice Check whether an agent's human proof is currently valid (not expired)
    /// @param agentId The agent to query
    /// @return True if the agent has a proof and it has not yet expired
    function isProofFresh(uint256 agentId) external view returns (bool);

    /// @notice Get the timestamp at which an agent's human proof expires
    /// @param agentId The agent to query
    /// @return The expiry timestamp (0 if no proof exists)
    function proofExpiresAt(uint256 agentId) external view returns (uint256);
}
