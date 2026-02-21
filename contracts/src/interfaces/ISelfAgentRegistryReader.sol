// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/// @title ISelfAgentRegistryReader
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
}
