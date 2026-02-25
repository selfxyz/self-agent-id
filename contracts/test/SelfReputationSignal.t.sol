// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import { Test } from "forge-std/Test.sol";
import { SelfReputationSignal } from "../src/SelfReputationSignal.sol";
import { IHumanProofProvider } from "../src/interfaces/IHumanProofProvider.sol";

/// @notice Minimal mock registry for testing
contract MockRegistry {
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

/// @notice Mock provider returning a configurable strength
contract MockProvider is IHumanProofProvider {
    uint8 private _strength;
    string private _name;

    constructor(uint8 strength_, string memory name_) {
        _strength = strength_;
        _name = name_;
    }

    function verifyHumanProof(bytes calldata, bytes calldata) external pure returns (bool, uint256) {
        return (true, 0);
    }

    function providerName() external view returns (string memory) {
        return _name;
    }

    function verificationStrength() external view returns (uint8) {
        return _strength;
    }
}

contract SelfReputationSignalTest is Test {
    SelfReputationSignal rep;
    MockRegistry registry;
    MockProvider selfProvider; // strength = 100
    MockProvider kycProvider; // strength = 80

    function setUp() public {
        registry = new MockRegistry();
        selfProvider = new MockProvider(100, "self");
        kycProvider = new MockProvider(80, "kyc-provider");
        rep = new SelfReputationSignal(address(registry));

        // Agent 1: verified by Self (strength 100)
        registry.setAgent(1, true, address(selfProvider), 100);
        // Agent 2: verified by KYC (strength 80)
        registry.setAgent(2, true, address(kycProvider), 200);
        // Agent 3: no proof
        registry.setAgent(3, false, address(0), 0);
    }

    function test_ScorePassportAgent() public view {
        assertEq(rep.getReputationScore(1), 100);
    }

    function test_ScoreKycAgent() public view {
        assertEq(rep.getReputationScore(2), 80);
    }

    function test_ScoreNoProof() public view {
        assertEq(rep.getReputationScore(3), 0);
    }

    function test_ScoreNonexistent() public view {
        assertEq(rep.getReputationScore(999), 0);
    }

    function test_GetReputation() public view {
        (uint8 score, string memory provName, bool hasProof, uint256 regBlock) = rep.getReputation(1);
        assertEq(score, 100);
        assertEq(provName, "self");
        assertTrue(hasProof);
        assertEq(regBlock, 100);
    }

    function test_GetReputationNoProof() public view {
        (uint8 score, string memory provName, bool hasProof, uint256 regBlock) = rep.getReputation(3);
        assertEq(score, 0);
        assertEq(bytes(provName).length, 0);
        assertFalse(hasProof);
        assertEq(regBlock, 0);
    }

    function test_BatchScores() public view {
        uint256[] memory ids = new uint256[](3);
        ids[0] = 1;
        ids[1] = 2;
        ids[2] = 3;
        uint8[] memory scores = rep.getReputationBatch(ids);
        assertEq(scores[0], 100);
        assertEq(scores[1], 80);
        assertEq(scores[2], 0);
    }

    function test_Metadata() public view {
        assertEq(rep.name(), "Self Protocol");
        assertEq(rep.version(), "1.0");
    }
}
