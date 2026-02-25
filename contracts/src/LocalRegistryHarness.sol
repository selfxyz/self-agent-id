// SPDX-License-Identifier: MIT

pragma solidity 0.8.28;

/// @notice Local integration harness for CLI tests.
/// @dev Exposes only the read surface the CLIs need plus a test-only setter.
contract LocalRegistryHarness {
    mapping(bytes32 => bool) private _verified;
    mapping(bytes32 => uint256) private _agentIdByKey;

    function setAgent(bytes32 agentKey, uint256 agentId, bool isVerified) external {
        _verified[agentKey] = isVerified;
        _agentIdByKey[agentKey] = agentId;
    }

    function isVerifiedAgent(bytes32 agentKey) external view returns (bool) {
        return _verified[agentKey];
    }

    function getAgentId(bytes32 agentKey) external view returns (uint256) {
        return _agentIdByKey[agentKey];
    }
}
