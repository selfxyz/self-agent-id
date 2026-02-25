// SPDX-License-Identifier: MIT

pragma solidity 0.8.28;

/// @title LocalRegistryHarness
/// @author Self Protocol
/// @notice Local integration harness for CLI tests.
/// @dev Exposes only the read surface the CLIs need plus a test-only setter.
contract LocalRegistryHarness {
    /// @dev Tracks whether each agent key is verified
    mapping(bytes32 => bool) private _verified;
    /// @dev Maps agent keys to their agent IDs
    mapping(bytes32 => uint256) private _agentIdByKey;

    /// @notice Set an agent's verification state and ID (test-only)
    function setAgent(bytes32 agentKey, uint256 agentId, bool isVerified) external {
        _verified[agentKey] = isVerified;
        _agentIdByKey[agentKey] = agentId;
    }

    /// @notice Check if an agent key is currently verified
    function isVerifiedAgent(bytes32 agentKey) external view returns (bool) {
        return _verified[agentKey];
    }

    /// @notice Get the agent ID for a given agent key
    function getAgentId(bytes32 agentKey) external view returns (uint256) {
        return _agentIdByKey[agentKey];
    }
}
