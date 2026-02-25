// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import { Test } from "forge-std/Test.sol";
import { SelfAgentRegistry } from "../src/SelfAgentRegistry.sol";
import { SelfHumanProofProvider } from "../src/SelfHumanProofProvider.sol";
import { SelfValidationRegistry } from "../src/SelfValidationRegistry.sol";
import { ISelfVerificationRoot } from "@selfxyz/contracts/contracts/interfaces/ISelfVerificationRoot.sol";
import { IIdentityVerificationHubV2 } from "@selfxyz/contracts/contracts/interfaces/IIdentityVerificationHubV2.sol";
import { ProxyRoot } from "../src/upgradeable/ProxyRoot.sol";

contract SelfValidationRegistryTest is Test {
    SelfAgentRegistry registry;
    SelfHumanProofProvider selfProvider;
    SelfValidationRegistry val;

    address owner = makeAddr("owner");
    address hubMock = makeAddr("hub");
    address human1 = makeAddr("human1");

    address constant VALIDATOR = address(0x1234567890123456789012345678901234567890);

    bytes32 fakeConfigId = bytes32(uint256(0xc0de));

    uint256 nullifier1 = 222222;

    // ====================================================
    // Setup
    // ====================================================

    function setUp() public {
        // Mock the hub's setVerificationConfigV2 to return a fake configId
        vm.mockCall(
            hubMock,
            abi.encodeWithSelector(IIdentityVerificationHubV2.setVerificationConfigV2.selector),
            abi.encode(fakeConfigId)
        );

        // Deploy registry via proxy
        SelfAgentRegistry impl = new SelfAgentRegistry();
        registry = SelfAgentRegistry(address(new ProxyRoot(
            address(impl),
            abi.encodeCall(SelfAgentRegistry.initialize, (hubMock, owner))
        )));
        selfProvider = new SelfHumanProofProvider(hubMock, registry.scope());

        vm.startPrank(owner);
        registry.setSelfProofProvider(address(selfProvider));
        vm.stopPrank();

        // Deploy val registry via proxy — address(this) receives roles
        SelfValidationRegistry valImpl = new SelfValidationRegistry();
        val = SelfValidationRegistry(address(new ProxyRoot(
            address(valImpl),
            abi.encodeCall(SelfValidationRegistry.initialize, (address(registry), address(this)))
        )));
    }

    // ====================================================
    // Helpers
    // ====================================================

    function _buildEncodedOutput(
        address humanAddr,
        uint256 nullifier
    ) internal pure returns (bytes memory) {
        string[] memory names = new string[](3);
        names[0] = "BOB";
        names[1] = "";
        names[2] = "JONES";

        ISelfVerificationRoot.GenericDiscloseOutputV2 memory output = ISelfVerificationRoot
            .GenericDiscloseOutputV2({
                attestationId: bytes32(uint256(1)),
                userIdentifier: uint256(uint160(humanAddr)),
                nullifier: nullifier,
                forbiddenCountriesListPacked: [uint256(0), uint256(0), uint256(0), uint256(0)],
                issuingState: "GBR",
                name: names,
                idNumber: "987654321",
                nationality: "GBR",
                dateOfBirth: "900101",
                gender: "M",
                expiryDate: "300101",
                olderThan: 0,
                ofac: [false, false, false]
            });

        return abi.encode(output);
    }

    function _mintTestAgent() internal returns (uint256 agentId) {
        bytes memory encodedOutput = _buildEncodedOutput(human1, nullifier1);
        bytes memory userData = abi.encodePacked(uint8(0x52), uint8(0)); // 'R' + config 0
        vm.prank(hubMock);
        registry.onVerificationSuccess(encodedOutput, userData);

        bytes32 agentKey = bytes32(uint256(uint160(human1)));
        agentId = registry.agentKeyToAgentId(agentKey);
        require(agentId != 0, "agent not minted");
    }

    function _submitRequest() internal returns (bytes32 requestHash) {
        uint256 agentId = _mintTestAgent();
        requestHash = keccak256("test-request");
        vm.prank(registry.ownerOf(agentId));
        val.validationRequest(VALIDATOR, agentId, "ipfs://QmRequest", requestHash);
    }

    // ====================================================
    // Tests
    // ====================================================

    function test_getIdentityRegistry() public view {
        assertEq(val.getIdentityRegistry(), address(registry));
    }

    function test_validationRequestEmitsEvent() public {
        uint256 agentId = _mintTestAgent();
        bytes32 requestHash = keccak256("test-request");

        vm.expectEmit(true, true, true, true);
        emit SelfValidationRegistry.ValidationRequest(VALIDATOR, agentId, "ipfs://QmRequest", requestHash);

        vm.prank(registry.ownerOf(agentId));
        val.validationRequest(VALIDATOR, agentId, "ipfs://QmRequest", requestHash);
    }

    function test_validationResponseStoresResult() public {
        bytes32 requestHash = _submitRequest();

        vm.prank(VALIDATOR);
        val.validationResponse(requestHash, 87, "ipfs://QmResponse", bytes32(0), "soft-finality");

        (address v, uint256 agentId_, uint8 response, , string memory tag, , ) = val.getValidationStatus(requestHash);
        assertEq(v, VALIDATOR);
        assertEq(response, 87);
        assertEq(tag, "soft-finality");
        // suppress unused var warning
        agentId_;
    }

    function test_validationResponseCanBeCalledMultipleTimes() public {
        bytes32 requestHash = _submitRequest();
        vm.startPrank(VALIDATOR);
        val.validationResponse(requestHash, 50, "", bytes32(0), "soft-finality");
        val.validationResponse(requestHash, 100, "", bytes32(0), "hard-finality");
        vm.stopPrank();

        (, , uint8 response, , string memory tag, , ) = val.getValidationStatus(requestHash);
        assertEq(response, 100);
        assertEq(tag, "hard-finality");
    }

    function test_selfValidatorSubmitsFreshnessResponse() public {
        uint256 agentId = _mintTestAgent();
        val.submitFreshnessValidation(agentId);

        bytes32 requestHash = keccak256(abi.encodePacked("freshness", agentId, block.timestamp / 1 days));
        (, , uint8 response, , string memory tag, , ) = val.getValidationStatus(requestHash);
        assertEq(response, 100); // proof is fresh (just registered)
        assertEq(tag, "freshness");
    }

    function test_selfValidatorSubmitsZeroWhenExpired() public {
        uint256 agentId = _mintTestAgent();
        vm.warp(block.timestamp + 366 days);
        val.submitFreshnessValidation(agentId);

        bytes32 requestHash = keccak256(abi.encodePacked("freshness", agentId, block.timestamp / 1 days));
        (, , uint8 response, , , , ) = val.getValidationStatus(requestHash);
        assertEq(response, 0);
    }

    function test_validationRequestRevertsIfNotAuthorized() public {
        uint256 agentId = _mintTestAgent();
        vm.prank(address(0xBAD));
        vm.expectRevert();
        val.validationRequest(VALIDATOR, agentId, "", bytes32(0));
    }

    function test_validationResponseRevertsIfNotValidator() public {
        bytes32 requestHash = _submitRequest();
        vm.prank(address(0xBAD));
        vm.expectRevert();
        val.validationResponse(requestHash, 100, "", bytes32(0), "");
    }

    function test_validationRequestRevertsOnDuplicateHash() public {
        uint256 agentId = _mintTestAgent();
        bytes32 requestHash = keccak256("dup-request");
        address owner_ = registry.ownerOf(agentId);

        vm.prank(owner_);
        val.validationRequest(VALIDATOR, agentId, "", requestHash);

        vm.prank(owner_);
        vm.expectRevert(bytes("request exists"));
        val.validationRequest(VALIDATOR, agentId, "", requestHash);
    }

    function test_freshnessValidationDoesNotPopulateValidatorRequests() public {
        uint256 agentId = _mintTestAgent();
        val.submitFreshnessValidation(agentId);

        // submitFreshnessValidation must NOT push to _validatorRequests[address(val)]
        bytes32[] memory reqs = val.getValidatorRequests(address(val));
        assertEq(reqs.length, 0, "freshness must not appear in validatorRequests");
    }

    function test_getFreshnessHistoryReturnsDayBucketHash() public {
        uint256 agentId = _mintTestAgent();
        val.submitFreshnessValidation(agentId);

        bytes32[] memory history = val.getFreshnessHistory(agentId);
        assertEq(history.length, 1);

        bytes32 expectedHash = keccak256(abi.encodePacked("freshness", agentId, block.timestamp / 1 days));
        assertEq(history[0], expectedHash);
    }

    function test_getFreshnessHistoryDeduplicatesSameDay() public {
        uint256 agentId = _mintTestAgent();
        val.submitFreshnessValidation(agentId);
        val.submitFreshnessValidation(agentId); // same UTC day — should not push again

        bytes32[] memory history = val.getFreshnessHistory(agentId);
        assertEq(history.length, 1, "same-day calls must not duplicate the history entry");
    }

    function test_getFreshnessHistoryGrowsAcrossDays() public {
        uint256 agentId = _mintTestAgent();
        val.submitFreshnessValidation(agentId);

        vm.warp(block.timestamp + 1 days);
        val.submitFreshnessValidation(agentId);

        bytes32[] memory history = val.getFreshnessHistory(agentId);
        assertEq(history.length, 2, "each new UTC day should append a new entry");
    }

    function test_getLatestFreshnessFreshAgent() public {
        uint256 agentId = _mintTestAgent();
        val.submitFreshnessValidation(agentId);

        (bool fresh, uint256 lastUpdated) = val.getLatestFreshness(agentId);
        assertTrue(fresh, "agent should be fresh right after registration");
        assertGt(lastUpdated, 0, "lastUpdated must be non-zero");
    }

    function test_getLatestFreshnessExpiredAgent() public {
        uint256 agentId = _mintTestAgent();
        vm.warp(block.timestamp + 366 days);
        val.submitFreshnessValidation(agentId);

        (bool fresh, uint256 lastUpdated) = val.getLatestFreshness(agentId);
        assertFalse(fresh, "agent should be expired after 366 days");
        assertGt(lastUpdated, 0, "lastUpdated must be non-zero");
    }

    function test_getLatestFreshnessNoRecord() public view {
        // agentId that never had submitFreshnessValidation called
        (bool fresh, uint256 lastUpdated) = val.getLatestFreshness(99999);
        assertFalse(fresh, "unknown agent should return false");
        assertEq(lastUpdated, 0, "unknown agent should return lastUpdated=0");
    }

    function test_getLatestFreshnessFallsBackToYesterday() public {
        uint256 agentId = _mintTestAgent();
        val.submitFreshnessValidation(agentId); // day 0

        // Advance to day 1 without calling submitFreshnessValidation again
        vm.warp(block.timestamp + 1 days);

        (bool fresh, uint256 lastUpdated) = val.getLatestFreshness(agentId);
        // Should fall back to yesterday's entry (still fresh since < 365 days total)
        assertTrue(fresh, "should fall back to yesterday's fresh result");
        assertGt(lastUpdated, 0, "lastUpdated from yesterday must be non-zero");
    }

    function test_getSummaryAveragesMultipleValidators() public {
        uint256 agentId = _mintTestAgent();
        address owner_ = registry.ownerOf(agentId);

        bytes32 hash1 = keccak256("req1");
        bytes32 hash2 = keccak256("req2");

        address valA = address(0xA1);
        address valB = address(0xA2);

        vm.prank(owner_);
        val.validationRequest(valA, agentId, "", hash1);
        vm.prank(owner_);
        val.validationRequest(valB, agentId, "", hash2);

        vm.prank(valA);
        val.validationResponse(hash1, 80, "", bytes32(0), "");
        vm.prank(valB);
        val.validationResponse(hash2, 60, "", bytes32(0), "");

        address[] memory validators = new address[](2);
        validators[0] = valA;
        validators[1] = valB;
        (uint64 count, uint8 avg) = val.getSummary(agentId, validators, "");
        assertEq(count, 2);
        assertEq(avg, 70); // (80+60)/2
    }
}
