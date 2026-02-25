// SPDX-License-Identifier: MIT

pragma solidity 0.8.28;

import { SelfAgentRegistry } from "./SelfAgentRegistry.sol";

/// @title AgentGate
/// @author Self Protocol
/// @notice Demo contract that gates access behind Self Agent ID verification
/// @dev Queries the SelfAgentRegistry on-chain to check agent status and credentials
contract AgentGate {
    /// @notice The SelfAgentRegistry used for verification lookups
    SelfAgentRegistry public immutable registry;

    /// @notice Thrown when the agent key is not registered or has no active human proof
    error NotVerifiedAgent();
    /// @notice Thrown when the agent's verified age is below the minimum requirement
    error AgeRequirementNotMet(uint256 actual, uint256 required);
    /// @notice Thrown when msg.sender does not match the address derived from the agent key
    error NotAgentCaller();

    /// @notice Emitted when an agent passes the age-gated access check
    event AccessGranted(bytes32 indexed agentKey, uint256 agentId, uint256 olderThan);

    /// @param _registry Address of the deployed SelfAgentRegistry
    constructor(address _registry) {
        registry = SelfAgentRegistry(_registry);
    }

    /// @notice Check if an agent passes the age-gated access check
    /// @param agentKey The agent's public key (bytes32)
    /// @return agentId The agent's token ID
    /// @return olderThan The agent's verified minimum age
    /// @return nationality The agent's verified nationality
    function checkAccess(bytes32 agentKey)
        external
        view
        returns (uint256 agentId, uint256 olderThan, string memory nationality)
    {
        if (!registry.isVerifiedAgent(agentKey)) revert NotVerifiedAgent();

        agentId = registry.getAgentId(agentKey);

        SelfAgentRegistry.AgentCredentials memory creds = registry.getAgentCredentials(agentId);

        if (creds.olderThan < 18) revert AgeRequirementNotMet(creds.olderThan, 18);

        olderThan = creds.olderThan;
        nationality = creds.nationality;
    }

    /// @notice Execute an age-gated action (emits event as proof)
    /// @param agentKey The agent's public key (bytes32)
    function gatedAction(bytes32 agentKey) external {
        if (msg.sender != address(uint160(uint256(agentKey)))) revert NotAgentCaller();
        if (!registry.isVerifiedAgent(agentKey)) revert NotVerifiedAgent();

        uint256 agentId = registry.getAgentId(agentKey);
        SelfAgentRegistry.AgentCredentials memory creds = registry.getAgentCredentials(agentId);

        if (creds.olderThan < 18) revert AgeRequirementNotMet(creds.olderThan, 18);

        emit AccessGranted(agentKey, agentId, creds.olderThan);
    }
}
