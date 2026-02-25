// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import { Test } from "forge-std/Test.sol";
import { SelfAgentRegistry } from "../src/SelfAgentRegistry.sol";
import { SelfHumanProofProvider } from "../src/SelfHumanProofProvider.sol";
import { SelfReputationRegistry } from "../src/SelfReputationRegistry.sol";
import { ISelfVerificationRoot } from "@selfxyz/contracts/contracts/interfaces/ISelfVerificationRoot.sol";
import { IIdentityVerificationHubV2 } from "@selfxyz/contracts/contracts/interfaces/IIdentityVerificationHubV2.sol";
import { ProxyRoot } from "../src/upgradeable/ProxyRoot.sol";

contract SelfReputationRegistryTest is Test {
    SelfAgentRegistry registry;
    SelfHumanProofProvider selfProvider;
    SelfReputationRegistry rep;

    address owner = makeAddr("owner");
    address hubMock = makeAddr("hub");
    address human1 = makeAddr("human1");

    bytes32 fakeConfigId = bytes32(uint256(0xc0de));

    uint256 nullifier1 = 111111;

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

        // Deploy rep registry via proxy — address(this) receives roles
        SelfReputationRegistry repImpl = new SelfReputationRegistry();
        rep = SelfReputationRegistry(address(new ProxyRoot(
            address(repImpl),
            abi.encodeCall(SelfReputationRegistry.initialize, (address(registry), address(this)))
        )));

        // Wire the rep registry into the agent registry
        vm.prank(owner);
        registry.setReputationRegistry(address(rep));

        // Configure default document weights (test contract has SECURITY_ROLE on rep)
        rep.setDocumentWeight(bytes32(uint256(1)), 100, "passport-nfc");    // E_PASSPORT
        rep.setDocumentWeight(bytes32(uint256(2)), 100, "id-card-nfc");     // EU_ID_CARD
        rep.setDocumentWeight(bytes32(uint256(3)), 80, "aadhaar");          // AADHAAR
        rep.setDocumentWeight(bytes32(uint256(4)), 50, "kyc-sumsub");       // KYC
    }

    // ====================================================
    // Helpers
    // ====================================================

    function _buildEncodedOutput(
        address humanAddr,
        uint256 nullifier
    ) internal pure returns (bytes memory) {
        string[] memory names = new string[](3);
        names[0] = "ALICE";
        names[1] = "";
        names[2] = "SMITH";

        ISelfVerificationRoot.GenericDiscloseOutputV2 memory output = ISelfVerificationRoot
            .GenericDiscloseOutputV2({
                attestationId: bytes32(uint256(1)),
                userIdentifier: uint256(uint160(humanAddr)),
                nullifier: nullifier,
                forbiddenCountriesListPacked: [uint256(0), uint256(0), uint256(0), uint256(0)],
                issuingState: "GBR",
                name: names,
                idNumber: "123456789",
                nationality: "GBR",
                dateOfBirth: "950101",
                gender: "F",
                expiryDate: "300101",
                olderThan: 0,
                ofac: [false, false, false]
            });

        return abi.encode(output);
    }

    function _buildEncodedOutputWithAttestation(
        address humanAddr,
        uint256 nullifier,
        bytes32 attestationId
    ) internal pure returns (bytes memory) {
        string[] memory names = new string[](3);
        names[0] = "ALICE";
        names[1] = "";
        names[2] = "SMITH";

        ISelfVerificationRoot.GenericDiscloseOutputV2 memory output = ISelfVerificationRoot
            .GenericDiscloseOutputV2({
                attestationId: attestationId,
                userIdentifier: uint256(uint160(humanAddr)),
                nullifier: nullifier,
                forbiddenCountriesListPacked: [uint256(0), uint256(0), uint256(0), uint256(0)],
                issuingState: "GBR",
                name: names,
                idNumber: "123456789",
                nationality: "GBR",
                dateOfBirth: "950101",
                gender: "F",
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

    // ====================================================
    // Tests
    // ====================================================

    function test_getIdentityRegistry() public view {
        assertEq(rep.getIdentityRegistry(), address(registry));
    }

    function test_giveFeedbackStoresFeedback() public {
        uint256 agentId = _mintTestAgent();
        address client = address(0xC1);

        vm.prank(client);
        rep.giveFeedback(agentId, 9977, 2, "proof-of-human", "", "", "", bytes32(0));

        (int128 val, uint8 dec, string memory t1, , bool revoked, , , ) =
            rep.readFeedback(agentId, client, 1);
        assertEq(val, 9977);
        assertEq(dec, 2);
        assertEq(t1, "proof-of-human");
        assertFalse(revoked);
    }

    function test_giveFeedbackRevertsOnSelfFeedback() public {
        uint256 agentId = _mintTestAgent();
        address owner_ = registry.ownerOf(agentId);

        vm.prank(owner_);
        vm.expectRevert();
        rep.giveFeedback(agentId, 100, 0, "", "", "", "", bytes32(0));
    }

    function test_revokeFeedback() public {
        uint256 agentId = _mintTestAgent();
        address client = address(0xC1);
        vm.prank(client);
        rep.giveFeedback(agentId, 80, 0, "", "", "", "", bytes32(0));

        vm.prank(client);
        rep.revokeFeedback(agentId, 1);

        (, , , , bool revoked, , , ) = rep.readFeedback(agentId, client, 1);
        assertTrue(revoked);
    }

    function test_appendResponseByOwner() public {
        uint256 agentId = _mintTestAgent();
        address client = address(0xC1);
        vm.prank(client);
        rep.giveFeedback(agentId, 80, 0, "", "", "", "", bytes32(0));

        address owner_ = registry.ownerOf(agentId);
        vm.prank(owner_);
        rep.appendResponse(agentId, client, 1, "ipfs://response", bytes32(0));

        address[] memory empty = new address[](0);
        assertEq(rep.getResponseCount(agentId, client, 1, empty), 1);
    }

    function test_appendResponseRevertsOnInvalidIndex() public {
        uint256 agentId = _mintTestAgent();
        address owner_ = registry.ownerOf(agentId);
        vm.prank(owner_);
        vm.expectRevert();
        rep.appendResponse(agentId, address(0xC1), 99, "", bytes32(0));
    }

    function test_getSummaryFiltersToClientAddresses() public {
        uint256 agentId = _mintTestAgent();
        address clientA = address(0xA);
        address clientB = address(0xB);

        vm.prank(clientA);
        rep.giveFeedback(agentId, 100, 0, "", "", "", "", bytes32(0));
        vm.prank(clientB);
        rep.giveFeedback(agentId, 50, 0, "", "", "", "", bytes32(0));

        address[] memory filter = new address[](1);
        filter[0] = clientA;
        (uint64 count, int256 val, ) = rep.getSummary(agentId, filter, "", "");
        assertEq(count, 1);
        assertEq(val, 100);
    }

    function test_getSummaryRevertsWithEmptyClientAddresses() public {
        uint256 agentId = _mintTestAgent();
        address[] memory empty = new address[](0);
        vm.expectRevert();
        rep.getSummary(agentId, empty, "", "");
    }

    function test_getSummaryDoesNotOverflowWithMaxValues() public {
        uint256 agentId = _mintTestAgent();
        address clientA = address(0xA);
        address clientB = address(0xB);

        // Submit max-value feedback from two clients (would overflow int128)
        int128 maxVal = 1e38;
        vm.prank(clientA);
        rep.giveFeedback(agentId, maxVal, 0, "", "", "", "", bytes32(0));
        vm.prank(clientB);
        rep.giveFeedback(agentId, maxVal, 0, "", "", "", "", bytes32(0));

        // This should not overflow now that we use int256 internally
        address[] memory clients = new address[](2);
        clients[0] = clientA;
        clients[1] = clientB;
        (uint64 count, int256 val, ) = rep.getSummary(agentId, clients, "", "");
        assertEq(count, 2);
        assertEq(val, int256(maxVal) + int256(maxVal));
    }

    function test_autoFeedbackSubmittedOnRegistration() public {
        // Registry already has rep set in setUp — mint and check
        uint256 agentId = _mintTestAgent();

        // Self (identity registry) should have auto-submitted proof-of-human feedback
        address[] memory clients = new address[](1);
        clients[0] = address(registry);
        (uint64 count, int256 val, ) = rep.getSummary(agentId, clients, "", "");
        assertEq(count, 1);
        assertGt(val, 0);
    }

    function test_setDocumentWeightStoresWeightAndTag() public {
        bytes32 ePassport = bytes32(uint256(1));
        rep.setDocumentWeight(ePassport, 100, "passport-nfc");
        (int128 weight, string memory tag) = rep.getDocumentWeight(ePassport);
        assertEq(weight, 100);
        assertEq(tag, "passport-nfc");
    }

    function test_setDocumentWeightRevertsWithoutSecurityRole() public {
        bytes32 ePassport = bytes32(uint256(1));
        vm.prank(address(0xBEEF));
        vm.expectRevert();
        rep.setDocumentWeight(ePassport, 100, "passport-nfc");
    }

    function test_setDocumentWeightRevertsOnZeroWeight() public {
        bytes32 ePassport = bytes32(uint256(1));
        vm.expectRevert("weight must be positive");
        rep.setDocumentWeight(ePassport, 0, "passport-nfc");
    }

    function test_setDocumentWeightEmitsEvent() public {
        bytes32 ePassport = bytes32(uint256(1));
        vm.expectEmit(true, false, false, true);
        emit SelfReputationRegistry.DocumentWeightUpdated(ePassport, 100, "passport-nfc");
        rep.setDocumentWeight(ePassport, 100, "passport-nfc");
    }

    function test_autoFeedbackUsesPassportWeight() public {
        uint256 agentId = _mintTestAgent(); // uses attestationId = bytes32(1) = E_PASSPORT

        (int128 val, , string memory t1, string memory t2, , , , ) =
            rep.readFeedback(agentId, address(registry), 1);
        assertEq(val, 100);
        assertEq(t1, "proof-of-human");
        assertEq(t2, "passport-nfc");
    }

    function test_autoFeedbackUsesIdCardWeight() public {
        bytes memory encodedOutput = _buildEncodedOutputWithAttestation(human1, nullifier1, bytes32(uint256(2)));
        bytes memory userData = abi.encodePacked(uint8(0x52), uint8(0));
        vm.prank(hubMock);
        registry.onVerificationSuccess(encodedOutput, userData);

        bytes32 agentKey = bytes32(uint256(uint160(human1)));
        uint256 agentId = registry.agentKeyToAgentId(agentKey);

        (int128 val, , , string memory t2, , , , ) =
            rep.readFeedback(agentId, address(registry), 1);
        assertEq(val, 100);
        assertEq(t2, "id-card-nfc");
    }

    function test_autoFeedbackUsesAadhaarWeight() public {
        bytes memory encodedOutput = _buildEncodedOutputWithAttestation(human1, nullifier1, bytes32(uint256(3)));
        bytes memory userData = abi.encodePacked(uint8(0x52), uint8(0));
        vm.prank(hubMock);
        registry.onVerificationSuccess(encodedOutput, userData);

        bytes32 agentKey = bytes32(uint256(uint160(human1)));
        uint256 agentId = registry.agentKeyToAgentId(agentKey);

        (int128 val, , , string memory t2, , , , ) =
            rep.readFeedback(agentId, address(registry), 1);
        assertEq(val, 80);
        assertEq(t2, "aadhaar");
    }

    function test_autoFeedbackUsesKycWeight() public {
        bytes memory encodedOutput = _buildEncodedOutputWithAttestation(human1, nullifier1, bytes32(uint256(4)));
        bytes memory userData = abi.encodePacked(uint8(0x52), uint8(0));
        vm.prank(hubMock);
        registry.onVerificationSuccess(encodedOutput, userData);

        bytes32 agentKey = bytes32(uint256(uint160(human1)));
        uint256 agentId = registry.agentKeyToAgentId(agentKey);

        (int128 val, , , string memory t2, , , , ) =
            rep.readFeedback(agentId, address(registry), 1);
        assertEq(val, 50);
        assertEq(t2, "kyc-sumsub");
    }
}
