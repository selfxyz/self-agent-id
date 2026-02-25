// SPDX-License-Identifier: MIT

pragma solidity 0.8.28;

import { Test } from "forge-std/Test.sol";
import { SelfValidationProvider } from "../src/SelfValidationProvider.sol";

/// @notice Minimal mock registry for validation testing
contract MockRegistryValidation {
    mapping(uint256 => bool) public _hasProof;
    mapping(uint256 => address) public _provider;
    mapping(uint256 => uint256) public _registeredAt;

    function setAgent(uint256 agentId, bool hasProof, address provider, uint256 registeredAt) external {
        _hasProof[agentId] = hasProof;
        _provider[agentId] = provider;
        _registeredAt[agentId] = registeredAt;
    }

    function hasHumanProof(uint256 agentId) external view returns (bool) {
        return _hasProof[agentId];
    }

    function getProofProvider(uint256 agentId) external view returns (address) {
        return _provider[agentId];
    }

    function agentRegisteredAt(uint256 agentId) external view returns (uint256) {
        return _registeredAt[agentId];
    }
}

contract SelfValidationProviderTest is Test {
    SelfValidationProvider val;
    MockRegistryValidation registry;
    address fakeProvider = makeAddr("provider");

    function setUp() public {
        registry = new MockRegistryValidation();
        val = new SelfValidationProvider(address(registry));

        // Agent 1: verified, registered at block 10
        registry.setAgent(1, true, fakeProvider, 10);
        // Agent 2: no proof
        registry.setAgent(2, false, address(0), 0);
        // Agent 3: verified but very old (registered at block 1)
        registry.setAgent(3, true, fakeProvider, 1);
    }

    function test_ValidateAgent_Valid() public {
        // Roll to a recent block
        vm.roll(100);
        (bool valid, bool fresh, uint256 registeredAt, uint256 blockAge, address provider) = val.validateAgent(1);
        assertTrue(valid);
        assertTrue(fresh);
        assertEq(registeredAt, 10);
        assertEq(blockAge, 90);
        assertEq(provider, fakeProvider);
    }

    function test_ValidateAgent_NoProof() public {
        vm.roll(100);
        (bool valid, bool fresh,,,) = val.validateAgent(2);
        assertFalse(valid);
        assertFalse(fresh);
    }

    function test_ValidateAgent_Nonexistent() public {
        vm.roll(100);
        (bool valid, bool fresh,,,) = val.validateAgent(999);
        assertFalse(valid);
        assertFalse(fresh);
    }

    function test_IsValidAgent() public {
        vm.roll(100);
        assertTrue(val.isValidAgent(1));
        assertFalse(val.isValidAgent(2));
        assertFalse(val.isValidAgent(999));
    }

    function test_FreshnessExpired() public {
        // Set a tiny freshness threshold
        val.setFreshnessThreshold(50);
        vm.roll(100);
        // Agent 1 registered at block 10, age = 90 > threshold 50
        assertFalse(val.isValidAgent(1));
        // Agent 3 registered at block 1, age = 99 > threshold 50
        assertFalse(val.isValidAgent(3));
    }

    function test_FreshnessFresh() public {
        val.setFreshnessThreshold(100);
        vm.roll(100);
        // Agent 1 registered at block 10, age = 90 <= 100
        assertTrue(val.isValidAgent(1));
    }

    function test_SetFreshnessThreshold_OnlyOwner() public {
        address nonOwner = makeAddr("nonOwner");
        vm.prank(nonOwner);
        vm.expectRevert();
        val.setFreshnessThreshold(1);
    }

    function test_BatchValidation() public {
        vm.roll(100);
        uint256[] memory ids = new uint256[](3);
        ids[0] = 1;
        ids[1] = 2;
        ids[2] = 3;
        bool[] memory results = val.validateBatch(ids);
        assertTrue(results[0]);
        assertFalse(results[1]);
        assertTrue(results[2]);
    }

    function test_Metadata() public view {
        assertEq(val.name(), "Self Protocol");
        assertEq(val.version(), "1.0");
    }
}
