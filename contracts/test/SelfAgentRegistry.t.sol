// SPDX-License-Identifier: MIT

pragma solidity 0.8.28;

import { Test } from "forge-std/Test.sol";
import { SelfAgentRegistry } from "../src/SelfAgentRegistry.sol";
import { SelfHumanProofProvider } from "../src/SelfHumanProofProvider.sol";
import { MockHumanProofProvider } from "./mocks/MockHumanProofProvider.sol";
import { ISelfVerificationRoot } from "@selfxyz/contracts/contracts/interfaces/ISelfVerificationRoot.sol";
import { IIdentityVerificationHubV2 } from "@selfxyz/contracts/contracts/interfaces/IIdentityVerificationHubV2.sol";
import { IERC8004 } from "../src/interfaces/IERC8004.sol";
import { IERC8004ProofOfHuman } from "../src/interfaces/IERC8004ProofOfHuman.sol";
import { MessageHashUtils } from "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";
import { ProxyRoot } from "../src/upgradeable/ProxyRoot.sol";
import { IAccessControl } from "@openzeppelin/contracts/access/IAccessControl.sol";

contract SelfAgentRegistryTest is Test {
    SelfAgentRegistry registry;
    SelfHumanProofProvider selfProvider;
    MockHumanProofProvider mockProvider;

    address owner = makeAddr("owner");
    address hubMock = makeAddr("hub");
    address human1 = makeAddr("human1");
    address human2 = makeAddr("human2");
    address human1alt = makeAddr("human1alt"); // second wallet, same passport as human1

    bytes32 fakeConfigId = bytes32(uint256(0xc0de));

    // Agent keys are now derived from human addresses
    bytes32 agentKey1 = bytes32(uint256(uint160(human1)));
    bytes32 agentKey2 = bytes32(uint256(uint160(human2)));
    bytes32 agentKey1alt = bytes32(uint256(uint160(human1alt)));

    uint256 nullifier1 = 111111;
    uint256 nullifier2 = 222222;

    // Advanced mode: agents with real keypairs
    uint256 advAgentPrivKey1 = 0xA11CE1;
    address advAgentAddr1 = vm.addr(advAgentPrivKey1);
    bytes32 advAgentKey1 = bytes32(uint256(uint160(advAgentAddr1)));

    uint256 advAgentPrivKey2 = 0xB0B1;
    address advAgentAddr2 = vm.addr(advAgentPrivKey2);
    bytes32 advAgentKey2 = bytes32(uint256(uint160(advAgentAddr2)));

    // ====================================================
    // Setup — adapted from boilerplate/self-lottery pattern:
    //   mock hub.setVerificationConfigV2() → return fakeConfigId
    // ====================================================

    function setUp() public {
        // Mock the hub's setVerificationConfigV2 to return a fake configId
        // This is called in the SelfAgentRegistry.initialize()
        vm.mockCall(
            hubMock,
            abi.encodeWithSelector(IIdentityVerificationHubV2.setVerificationConfigV2.selector),
            abi.encode(fakeConfigId)
        );

        // Deploy implementation + proxy
        SelfAgentRegistry impl = new SelfAgentRegistry();
        registry = SelfAgentRegistry(address(new ProxyRoot(
            address(impl),
            abi.encodeCall(SelfAgentRegistry.initialize, (hubMock, owner))
        )));

        selfProvider = new SelfHumanProofProvider(hubMock, registry.scope());
        mockProvider = new MockHumanProofProvider();

        // Owner sets up providers
        vm.startPrank(owner);
        registry.setSelfProofProvider(address(selfProvider));
        registry.addProofProvider(address(mockProvider));
        vm.stopPrank();
    }

    // ====================================================
    // Helpers — build mock Hub V2 callback data
    //   Pattern: vm.prank(hubMock) → registry.onVerificationSuccess(encodedOutput, userData)
    //   Adapted from TestSelfVerificationRoot in Self SDK
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
                attestationId: bytes32(uint256(1)), // E_PASSPORT
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

    function _buildUserData(uint8 action) internal pure returns (bytes memory) {
        return abi.encodePacked(action, uint8(0)); // action + config 0
    }

    function _buildUserData(uint8 action, uint8 configIdx) internal pure returns (bytes memory) {
        return abi.encodePacked(action, configIdx);
    }

    function _registerViaHub(address humanAddr, uint256 nullifier) internal {
        bytes memory encodedOutput = _buildEncodedOutput(humanAddr, nullifier);
        bytes memory userData = _buildUserData(0x52); // 'R'
        vm.prank(hubMock);
        registry.onVerificationSuccess(encodedOutput, userData);
    }

    function _deregisterViaHub(address humanAddr, uint256 nullifier) internal {
        bytes memory encodedOutput = _buildEncodedOutput(humanAddr, nullifier);
        bytes memory userData = _buildUserData(0x44); // 'D'
        vm.prank(hubMock);
        registry.onVerificationSuccess(encodedOutput, userData);
    }

    function _agentKeyFor(address humanAddr) internal pure returns (bytes32) {
        return bytes32(uint256(uint160(humanAddr)));
    }

    // ====================================================
    // Constructor
    // ====================================================

    function test_Initialize() public view {
        assertEq(registry.name(), "Self Agent ID");
        assertEq(registry.symbol(), "SAID");
        assertTrue(registry.hasRole(registry.SECURITY_ROLE(), owner));
        assertTrue(registry.hasRole(registry.OPERATIONS_ROLE(), owner));
        assertEq(registry.configIds(0), fakeConfigId);
    }

    function test_GetConfigId_ReturnsStoredId() public view {
        // Short data defaults to config 0
        bytes32 result = registry.getConfigId(bytes32(0), bytes32(0), "");
        assertEq(result, fakeConfigId);
    }

    // ====================================================
    // Hub V2 Callback — Registration
    // ====================================================

    function test_RegisterAgent_ViaHub() public {
        _registerViaHub(human1, nullifier1);

        uint256 agentId = registry.getAgentId(agentKey1);
        assertEq(agentId, 1, "First agent should have ID 1");
        assertTrue(registry.hasHumanProof(agentId));
        assertEq(registry.getHumanNullifier(agentId), nullifier1);
        assertEq(registry.getProofProvider(agentId), address(selfProvider));
        assertEq(registry.getAgentCountForHuman(nullifier1), 1);
        assertEq(registry.agentRegisteredAt(agentId), block.number);
        assertTrue(registry.isVerifiedAgent(agentKey1));
    }

    function test_RegisterAgent_MintToHumanAddress() public {
        _registerViaHub(human1, nullifier1);

        uint256 agentId = registry.getAgentId(agentKey1);
        assertEq(registry.ownerOf(agentId), human1, "NFT should be minted to the human's address");
    }

    function test_RegisterAgent_EmitsEvent() public {
        bytes memory encodedOutput = _buildEncodedOutput(human1, nullifier1);
        bytes memory userData = _buildUserData(0x52);

        vm.expectEmit(true, true, false, true);
        emit IERC8004ProofOfHuman.AgentRegisteredWithHumanProof(
            1, // agentId
            address(selfProvider),
            nullifier1,
            100 // Self Protocol verification strength
        );

        vm.prank(hubMock);
        registry.onVerificationSuccess(encodedOutput, userData);
    }

    function test_RegisterMultipleAgents_SameHuman() public {
        // Raise cap to allow multiple agents per human
        vm.prank(owner);
        registry.setMaxAgentsPerHuman(0);

        // Same nullifier (same passport), different wallet addresses
        _registerViaHub(human1, nullifier1);
        _registerViaHub(human1alt, nullifier1);

        assertEq(registry.getAgentCountForHuman(nullifier1), 2);
        assertTrue(registry.sameHuman(
            registry.getAgentId(agentKey1),
            registry.getAgentId(agentKey1alt)
        ));
    }

    function test_RegisterAgents_DifferentHumans() public {
        _registerViaHub(human1, nullifier1);
        _registerViaHub(human2, nullifier2);

        assertEq(registry.getAgentCountForHuman(nullifier1), 1);
        assertEq(registry.getAgentCountForHuman(nullifier2), 1);
        assertFalse(registry.sameHuman(
            registry.getAgentId(agentKey1),
            registry.getAgentId(agentKey2)
        ));
    }

    function test_RegisterAgent_IncrementalIds() public {
        _registerViaHub(human1, nullifier1);
        _registerViaHub(human2, nullifier2);

        assertEq(registry.getAgentId(agentKey1), 1);
        assertEq(registry.getAgentId(agentKey2), 2);
    }

    function test_RevertWhen_DuplicateAgentKey() public {
        _registerViaHub(human1, nullifier1);

        bytes memory encodedOutput = _buildEncodedOutput(human1, nullifier1);
        bytes memory userData = _buildUserData(0x52);

        vm.prank(hubMock);
        vm.expectRevert(abi.encodeWithSelector(SelfAgentRegistry.AgentAlreadyRegistered.selector, agentKey1));
        registry.onVerificationSuccess(encodedOutput, userData);
    }

    function test_RevertWhen_EmptyUserData() public {
        bytes memory encodedOutput = _buildEncodedOutput(human1, nullifier1);
        bytes memory emptyData = "";

        vm.prank(hubMock);
        vm.expectRevert(SelfAgentRegistry.InvalidUserData.selector);
        registry.onVerificationSuccess(encodedOutput, emptyData);
    }

    function test_RevertWhen_InvalidAction() public {
        bytes memory encodedOutput = _buildEncodedOutput(human1, nullifier1);
        bytes memory userData = _buildUserData(0xFF);

        vm.prank(hubMock);
        vm.expectRevert(abi.encodeWithSelector(SelfAgentRegistry.InvalidAction.selector, uint8(0xFF)));
        registry.onVerificationSuccess(encodedOutput, userData);
    }

    function test_RevertWhen_CallerNotHub() public {
        bytes memory encodedOutput = _buildEncodedOutput(human1, nullifier1);
        bytes memory userData = _buildUserData(0x52);

        vm.prank(human1); // not the hub
        vm.expectRevert(); // UnauthorizedCaller from SelfVerificationRoot
        registry.onVerificationSuccess(encodedOutput, userData);
    }

    // ====================================================
    // Hub V2 Callback — Deregistration
    // ====================================================

    function test_DeregisterAgent_ViaHub() public {
        _registerViaHub(human1, nullifier1);

        uint256 agentId = registry.getAgentId(agentKey1);
        assertEq(registry.ownerOf(agentId), human1);

        _deregisterViaHub(human1, nullifier1);

        assertFalse(registry.hasHumanProof(agentId));
        assertEq(registry.getAgentCountForHuman(nullifier1), 0);
        assertFalse(registry.isVerifiedAgent(agentKey1));

        // NFT burned — ownerOf should revert
        vm.expectRevert();
        registry.ownerOf(agentId);
    }

    function test_DeregisterAgent_EmitsEvent() public {
        _registerViaHub(human1, nullifier1);

        bytes memory encodedOutput = _buildEncodedOutput(human1, nullifier1);
        bytes memory userData = _buildUserData(0x44);

        vm.expectEmit(true, false, false, true);
        emit IERC8004ProofOfHuman.HumanProofRevoked(1, nullifier1);

        vm.prank(hubMock);
        registry.onVerificationSuccess(encodedOutput, userData);
    }

    function test_DeregisterAgent_DecrementsCount() public {
        vm.prank(owner);
        registry.setMaxAgentsPerHuman(0);

        _registerViaHub(human1, nullifier1);
        _registerViaHub(human1alt, nullifier1);
        assertEq(registry.getAgentCountForHuman(nullifier1), 2);

        _deregisterViaHub(human1, nullifier1);
        assertEq(registry.getAgentCountForHuman(nullifier1), 1);

        // human1alt's agent still active
        assertTrue(registry.isVerifiedAgent(agentKey1alt));
    }

    function test_RevertWhen_DeregisterUnregisteredAgent() public {
        bytes memory encodedOutput = _buildEncodedOutput(human1, nullifier1);
        bytes memory userData = _buildUserData(0x44);

        vm.prank(hubMock);
        vm.expectRevert(abi.encodeWithSelector(SelfAgentRegistry.AgentNotRegistered.selector, agentKey1));
        registry.onVerificationSuccess(encodedOutput, userData);
    }

    function test_RevertWhen_DeregisterByWrongHuman() public {
        _registerViaHub(human1, nullifier1);

        // human2 (different nullifier) tries to deregister — but since agent key
        // is derived from address, human2's deregister targets their OWN key
        // (which doesn't exist). This should revert as AgentNotRegistered.
        bytes memory encodedOutput = _buildEncodedOutput(human2, nullifier2);
        bytes memory userData = _buildUserData(0x44);

        vm.prank(hubMock);
        vm.expectRevert(
            abi.encodeWithSelector(SelfAgentRegistry.AgentNotRegistered.selector, agentKey2)
        );
        registry.onVerificationSuccess(encodedOutput, userData);
    }

    function test_RevertWhen_DeregisterByWrongNullifier() public {
        // Register human1 with nullifier1
        _registerViaHub(human1, nullifier1);

        // Same address (human1) but different nullifier tries to deregister
        // This simulates a different passport owner using the same wallet
        bytes memory encodedOutput = _buildEncodedOutput(human1, nullifier2);
        bytes memory userData = _buildUserData(0x44);

        vm.prank(hubMock);
        vm.expectRevert(
            abi.encodeWithSelector(SelfAgentRegistry.NotAgentOwner.selector, nullifier1, nullifier2)
        );
        registry.onVerificationSuccess(encodedOutput, userData);
    }

    // ====================================================
    // String-Encoded userDefinedData (Self SDK sends UTF-8 strings)
    // Format: "R" (register) or "D" (deregister) — just action char
    // ====================================================

    function _registerViaHubString(address humanAddr, uint256 nullifier) internal {
        bytes memory encodedOutput = _buildEncodedOutput(humanAddr, nullifier);
        bytes memory userData = abi.encodePacked("R0");
        vm.prank(hubMock);
        registry.onVerificationSuccess(encodedOutput, userData);
    }

    function _deregisterViaHubString(address humanAddr, uint256 nullifier) internal {
        bytes memory encodedOutput = _buildEncodedOutput(humanAddr, nullifier);
        bytes memory userData = abi.encodePacked("D0");
        vm.prank(hubMock);
        registry.onVerificationSuccess(encodedOutput, userData);
    }

    function test_RegisterAgent_StringEncoding() public {
        _registerViaHubString(human1, nullifier1);

        uint256 agentId = registry.getAgentId(agentKey1);
        assertEq(agentId, 1);
        assertTrue(registry.isVerifiedAgent(agentKey1));
        assertEq(registry.ownerOf(agentId), human1);
    }

    function test_DeregisterAgent_StringEncoding() public {
        _registerViaHubString(human1, nullifier1);
        assertTrue(registry.isVerifiedAgent(agentKey1));

        _deregisterViaHubString(human1, nullifier1);
        assertFalse(registry.isVerifiedAgent(agentKey1));
    }

    function test_ReRegisterAfterDeregister() public {
        // Register, then deregister
        _registerViaHub(human1, nullifier1);
        uint256 firstAgentId = registry.getAgentId(agentKey1);
        assertTrue(registry.isVerifiedAgent(agentKey1));

        _deregisterViaHub(human1, nullifier1);
        assertFalse(registry.isVerifiedAgent(agentKey1));
        assertEq(registry.getAgentId(agentKey1), 0); // mapping cleared

        // Re-register with the same key — should succeed with a new agent ID
        _registerViaHub(human1, nullifier1);
        uint256 secondAgentId = registry.getAgentId(agentKey1);
        assertTrue(registry.isVerifiedAgent(agentKey1));
        assertGt(secondAgentId, firstAgentId); // new ID is higher
        assertEq(registry.ownerOf(secondAgentId), human1);
        assertEq(registry.getAgentCountForHuman(nullifier1), 1);
    }

    function test_ReRegisterAfterRevokeHumanProof() public {
        // Register via sync path, then revoke
        bytes32 syncKey = bytes32(uint256(0xbeef));
        bytes memory providerData = abi.encodePacked(syncKey);

        mockProvider.setShouldVerify(true);
        mockProvider.setNextNullifier(nullifier1);
        vm.prank(human1);
        uint256 firstId = registry.registerWithHumanProof("", address(mockProvider), "", providerData);
        assertTrue(registry.isVerifiedAgent(syncKey));

        vm.prank(human1);
        registry.revokeHumanProof(firstId, address(mockProvider), "", "");
        assertFalse(registry.isVerifiedAgent(syncKey));
        assertEq(registry.getAgentId(syncKey), 0); // mapping cleared

        // Re-register — should succeed
        vm.prank(human1);
        uint256 secondId = registry.registerWithHumanProof("", address(mockProvider), "", providerData);
        assertTrue(registry.isVerifiedAgent(syncKey));
        assertGt(secondId, firstId);
    }

    function test_StringAndBinaryEncoding_SameResult() public {
        // Register with string encoding
        _registerViaHubString(human1, nullifier1);
        uint256 agentId1 = registry.getAgentId(agentKey1);

        // Register with binary encoding
        _registerViaHub(human2, nullifier2);
        uint256 agentId2 = registry.getAgentId(agentKey2);

        // Both should work and produce valid registrations
        assertTrue(registry.isVerifiedAgent(agentKey1));
        assertTrue(registry.isVerifiedAgent(agentKey2));
        assertEq(agentId1, 1);
        assertEq(agentId2, 2);
    }

    // ====================================================
    // Synchronous Path — registerWithHumanProof
    // ====================================================

    function test_RegisterWithHumanProof_Sync() public {
        mockProvider.setNextNullifier(nullifier1);

        bytes memory proof = "mock-proof";
        bytes memory providerData = abi.encodePacked(agentKey1);

        vm.prank(human1);
        uint256 agentId = registry.registerWithHumanProof("", address(mockProvider), proof, providerData);

        assertEq(agentId, 1);
        assertTrue(registry.hasHumanProof(agentId));
        assertEq(registry.getHumanNullifier(agentId), nullifier1);
        assertEq(registry.getProofProvider(agentId), address(mockProvider));
        assertEq(registry.ownerOf(agentId), human1, "NFT minted to msg.sender in sync path");
    }

    function test_RevertWhen_SyncRegister_ProviderNotApproved() public {
        address fakeProvider = makeAddr("fake-provider");

        vm.prank(human1);
        vm.expectRevert(abi.encodeWithSelector(SelfAgentRegistry.ProviderNotApproved.selector, fakeProvider));
        registry.registerWithHumanProof("", fakeProvider, "", "");
    }

    function test_RevertWhen_SyncRegister_VerificationFails() public {
        mockProvider.setShouldVerify(false);

        bytes memory providerData = abi.encodePacked(agentKey1);

        vm.prank(human1);
        vm.expectRevert(SelfAgentRegistry.VerificationFailed.selector);
        registry.registerWithHumanProof("", address(mockProvider), "", providerData);
    }

    function test_RevertWhen_SyncRegister_ProviderDataTooShort() public {
        mockProvider.setNextNullifier(nullifier1);

        vm.prank(human1);
        vm.expectRevert(SelfAgentRegistry.ProviderDataTooShort.selector);
        registry.registerWithHumanProof("", address(mockProvider), "", "");
    }

    function test_RevertWhen_SyncRegister_SelfProvider() public {
        // Self provider always reverts on verifyHumanProof
        bytes memory providerData = abi.encodePacked(agentKey1);

        vm.prank(human1);
        vm.expectRevert(SelfHumanProofProvider.DirectVerificationNotSupported.selector);
        registry.registerWithHumanProof("", address(selfProvider), "", providerData);
    }

    // ====================================================
    // Synchronous Path — revokeHumanProof
    // ====================================================

    function test_RevokeHumanProof_Sync() public {
        // Register first
        mockProvider.setNextNullifier(nullifier1);
        bytes memory providerData = abi.encodePacked(agentKey1);
        vm.prank(human1);
        uint256 agentId = registry.registerWithHumanProof("", address(mockProvider), "", providerData);

        // Revoke
        vm.prank(human1);
        registry.revokeHumanProof(agentId, address(mockProvider), "", "");

        assertFalse(registry.hasHumanProof(agentId));
    }

    function test_RevertWhen_RevokeByDifferentHuman() public {
        // Register with nullifier1
        mockProvider.setNextNullifier(nullifier1);
        bytes memory providerData = abi.encodePacked(agentKey1);
        vm.prank(human1);
        uint256 agentId = registry.registerWithHumanProof("", address(mockProvider), "", providerData);

        // human2 tries to revoke (different nullifier)
        mockProvider.setNextNullifier(nullifier2);
        vm.prank(human2);
        vm.expectRevert(SelfAgentRegistry.NotSameHuman.selector);
        registry.revokeHumanProof(agentId, address(mockProvider), "", "");
    }

    function test_RevertWhen_RevokeNoHumanProof() public {
        // Agent ID 99 doesn't exist / has no proof
        vm.prank(human1);
        vm.expectRevert(abi.encodeWithSelector(SelfAgentRegistry.AgentHasNoHumanProof.selector, 99));
        registry.revokeHumanProof(99, address(mockProvider), "", "");
    }

    // ====================================================
    // View Functions
    // ====================================================

    function test_IsVerifiedAgent_Unregistered() public view {
        assertFalse(registry.isVerifiedAgent(agentKey1));
    }

    function test_GetAgentId_Unregistered() public view {
        assertEq(registry.getAgentId(agentKey1), 0);
    }

    function test_SameHuman_ZeroNullifier() public view {
        // Unregistered agents should return false (nullifier = 0)
        assertFalse(registry.sameHuman(1, 2));
    }

    // ====================================================
    // Admin — Provider Management
    // ====================================================

    function test_AddProofProvider() public {
        address newProvider = address(new MockHumanProofProvider());

        vm.prank(owner);
        registry.addProofProvider(newProvider);

        assertTrue(registry.isApprovedProvider(newProvider));
    }

    function test_RevertWhen_AddProvider_NotSecurityRole() public {
        bytes32 secRole = registry.SECURITY_ROLE();
        vm.prank(human1);
        vm.expectRevert(abi.encodeWithSelector(
            IAccessControl.AccessControlUnauthorizedAccount.selector,
            human1,
            secRole
        ));
        registry.addProofProvider(makeAddr("provider"));
    }

    function test_RevertWhen_AddProvider_AlreadyApproved() public {
        vm.prank(owner);
        vm.expectRevert(
            abi.encodeWithSelector(SelfAgentRegistry.ProviderAlreadyApproved.selector, address(mockProvider))
        );
        registry.addProofProvider(address(mockProvider));
    }

    function test_RemoveProofProvider() public {
        vm.prank(owner);
        registry.removeProofProvider(address(mockProvider));

        assertFalse(registry.isApprovedProvider(address(mockProvider)));
    }

    function test_RevertWhen_RemoveProvider_NotApproved() public {
        address fakeProvider = makeAddr("fake");

        vm.prank(owner);
        vm.expectRevert(abi.encodeWithSelector(SelfAgentRegistry.ProviderNotApproved.selector, fakeProvider));
        registry.removeProofProvider(fakeProvider);
    }

    function test_SetSelfProofProvider_SwapsOldProvider() public {
        SelfHumanProofProvider newSelfProvider = new SelfHumanProofProvider(hubMock, registry.scope());

        vm.prank(owner);
        registry.setSelfProofProvider(address(newSelfProvider));

        assertEq(registry.selfProofProvider(), address(newSelfProvider));
        assertTrue(registry.isApprovedProvider(address(newSelfProvider)));
        // Old provider should be removed from whitelist
        assertFalse(registry.isApprovedProvider(address(selfProvider)));
    }

    // ====================================================
    // Nullifier Reverse Mapping
    // ====================================================

    function test_GetAgentsForNullifier_Empty() public view {
        uint256[] memory agents = registry.getAgentsForNullifier(999);
        assertEq(agents.length, 0);
    }

    function test_GetAgentsForNullifier_SingleAgent() public {
        _registerViaHub(human1, nullifier1);
        uint256[] memory agents = registry.getAgentsForNullifier(nullifier1);
        assertEq(agents.length, 1);
        assertEq(agents[0], 1);
    }

    function test_GetAgentsForNullifier_MultipleAgents() public {
        vm.prank(owner);
        registry.setMaxAgentsPerHuman(5);
        _registerViaHub(human1, nullifier1);
        _registerViaHub(human1alt, nullifier1);
        uint256[] memory agents = registry.getAgentsForNullifier(nullifier1);
        assertEq(agents.length, 2);
        assertEq(agents[0], 1);
        assertEq(agents[1], 2);
    }

    function test_GetAgentsForNullifier_DifferentHumans() public {
        _registerViaHub(human1, nullifier1);
        _registerViaHub(human2, nullifier2);
        uint256[] memory agents1 = registry.getAgentsForNullifier(nullifier1);
        uint256[] memory agents2 = registry.getAgentsForNullifier(nullifier2);
        assertEq(agents1.length, 1);
        assertEq(agents2.length, 1);
        assertEq(agents1[0], 1);
        assertEq(agents2[0], 2);
    }

    function test_GetAgentsForNullifier_AfterDeregister() public {
        vm.prank(owner);
        registry.setMaxAgentsPerHuman(5);
        _registerViaHub(human1, nullifier1);
        _registerViaHub(human1alt, nullifier1);
        _deregisterViaHub(human1, nullifier1);
        uint256[] memory agents = registry.getAgentsForNullifier(nullifier1);
        assertEq(agents.length, 1);
        assertEq(agents[0], 2);
    }

    function test_GetAgentsForNullifier_AfterDeregisterAll() public {
        _registerViaHub(human1, nullifier1);
        _deregisterViaHub(human1, nullifier1);
        uint256[] memory agents = registry.getAgentsForNullifier(nullifier1);
        assertEq(agents.length, 0);
    }

    function test_GetAgentsForNullifier_SwapAndPop_MiddleElement() public {
        vm.prank(owner);
        registry.setMaxAgentsPerHuman(5);
        _registerViaHub(human1, nullifier1);
        _registerViaHub(human1alt, nullifier1);
        address human1third = makeAddr("human1third");
        _registerViaHub(human1third, nullifier1);
        _deregisterViaHub(human1alt, nullifier1);
        uint256[] memory agents = registry.getAgentsForNullifier(nullifier1);
        assertEq(agents.length, 2);
        assertEq(agents[0], 1);
        assertEq(agents[1], 3);
    }

    function test_GetAgentsForNullifier_Paginated() public {
        vm.prank(owner);
        registry.setMaxAgentsPerHuman(5);
        _registerViaHub(human1, nullifier1);
        _registerViaHub(human1alt, nullifier1);
        address human1third = makeAddr("human1third");
        _registerViaHub(human1third, nullifier1);
        // Get page: offset=1, limit=1
        uint256[] memory agents = registry.getAgentsForNullifier(nullifier1, 1, 1);
        assertEq(agents.length, 1);
        assertEq(agents[0], 2);
    }

    function test_GetAgentsForNullifier_Paginated_OffsetBeyondLength() public {
        _registerViaHub(human1, nullifier1);
        uint256[] memory agents = registry.getAgentsForNullifier(nullifier1, 10, 5);
        assertEq(agents.length, 0);
    }

    // ====================================================
    // ERC-721 Basics
    // ====================================================

    function test_TokenName() public view {
        assertEq(registry.name(), "Self Agent ID");
    }

    function test_TokenSymbol() public view {
        assertEq(registry.symbol(), "SAID");
    }

    function test_BalanceAfterRegister() public {
        vm.prank(owner);
        registry.setMaxAgentsPerHuman(0);

        _registerViaHub(human1, nullifier1);
        assertEq(registry.balanceOf(human1), 1);

        // Same human, second wallet
        _registerViaHub(human1alt, nullifier1);
        assertEq(registry.balanceOf(human1alt), 1);
    }

    function test_BalanceAfterDeregister() public {
        vm.prank(owner);
        registry.setMaxAgentsPerHuman(0);

        _registerViaHub(human1, nullifier1);
        _registerViaHub(human1alt, nullifier1);

        _deregisterViaHub(human1, nullifier1);
        assertEq(registry.balanceOf(human1), 0);
        assertEq(registry.balanceOf(human1alt), 1);
    }

    // ====================================================
    // Agent Key Derivation — Verify key = padded address
    // ====================================================

    function test_AgentKey_IsDerivedFromAddress() public {
        _registerViaHub(human1, nullifier1);

        // The agent key should be the zero-padded address
        bytes32 expectedKey = bytes32(uint256(uint160(human1)));
        uint256 agentId = registry.getAgentId(expectedKey);
        assertEq(agentId, 1);
        assertEq(registry.ownerOf(agentId), human1);
    }

    function test_LookupByAddress_Works() public {
        _registerViaHub(human1, nullifier1);

        // Simulate what the frontend does: zeroPadValue(address, 32)
        bytes32 keyFromAddress = bytes32(uint256(uint160(human1)));
        assertTrue(registry.isVerifiedAgent(keyFromAddress));
    }

    // ====================================================
    // Fuzz Tests
    // ====================================================

    function testFuzz_RegisterAgent(uint256 nullifier, address humanAddr) public {
        vm.assume(humanAddr != address(0)); // ERC721 won't mint to zero address
        vm.assume(nullifier != 0); // Non-zero nullifier

        _registerViaHub(humanAddr, nullifier);

        bytes32 agentKey = _agentKeyFor(humanAddr);
        uint256 agentId = registry.getAgentId(agentKey);
        assertTrue(agentId != 0);
        assertTrue(registry.isVerifiedAgent(agentKey));
        assertEq(registry.ownerOf(agentId), humanAddr);
        assertEq(registry.getHumanNullifier(agentId), nullifier);
    }

    function testFuzz_RegisterAndDeregister(uint256 nullifier, address humanAddr) public {
        vm.assume(humanAddr != address(0));
        vm.assume(nullifier != 0);

        _registerViaHub(humanAddr, nullifier);
        bytes32 agentKey = _agentKeyFor(humanAddr);
        uint256 agentId = registry.getAgentId(agentKey);
        assertTrue(registry.isVerifiedAgent(agentKey));

        _deregisterViaHub(humanAddr, nullifier);
        assertFalse(registry.isVerifiedAgent(agentKey));
        assertFalse(registry.hasHumanProof(agentId));
    }

    // ====================================================
    // Advanced Mode — Helpers
    // ====================================================

    function _signRegistration(
        uint256 privKey,
        address humanAddr
    ) internal view returns (uint8 v, bytes32 r, bytes32 s) {
        address agentAddr = vm.addr(privKey);
        uint256 nonce = registry.agentNonces(agentAddr);
        bytes32 messageHash = keccak256(abi.encodePacked(
            "self-agent-id:register:",
            humanAddr,
            block.chainid,
            address(registry),
            nonce
        ));
        bytes32 ethSignedHash = MessageHashUtils.toEthSignedMessageHash(messageHash);
        (v, r, s) = vm.sign(privKey, ethSignedHash);
    }

    function _buildAdvancedUserData(
        address agentAddr,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) internal pure returns (bytes memory) {
        // "K" + config(1) + address(40 hex) + r(64 hex) + s(64 hex) + v(2 hex) = 172 chars
        return abi.encodePacked(
            "K0",
            _toHexString(agentAddr),
            _toHexString32(r),
            _toHexString32(s),
            _toHexString8(v)
        );
    }

    function _registerViaHubAdvanced(address humanAddr, uint256 nullifier, uint256 agentPrivKey) internal {
        address agentAddr = vm.addr(agentPrivKey);
        (uint8 v, bytes32 r, bytes32 s) = _signRegistration(agentPrivKey, humanAddr);
        bytes memory encodedOutput = _buildEncodedOutput(humanAddr, nullifier);
        bytes memory userData = _buildAdvancedUserData(agentAddr, v, r, s);
        vm.prank(hubMock);
        registry.onVerificationSuccess(encodedOutput, userData);
    }

    function _deregisterViaHubAdvanced(address humanAddr, uint256 nullifier, address agentAddr) internal {
        bytes memory encodedOutput = _buildEncodedOutput(humanAddr, nullifier);
        // "X" + config(1) + address(40 hex) = 42 chars
        bytes memory userData = abi.encodePacked("X0", _toHexString(agentAddr));
        vm.prank(hubMock);
        registry.onVerificationSuccess(encodedOutput, userData);
    }

    // ====================================================
    // Advanced Mode — Tests
    // ====================================================

    function test_AdvancedRegister_ValidSignature() public {
        _registerViaHubAdvanced(human1, nullifier1, advAgentPrivKey1);

        uint256 agentId = registry.getAgentId(advAgentKey1);
        assertEq(agentId, 1, "First advanced agent should have ID 1");
        assertTrue(registry.isVerifiedAgent(advAgentKey1));
        assertTrue(registry.hasHumanProof(agentId));
        assertEq(registry.getHumanNullifier(agentId), nullifier1);
        assertEq(registry.ownerOf(agentId), human1);
    }

    function test_AdvancedRegister_StringEncoding() public {
        // Build "K" + address(40 hex) + r(64 hex) + s(64 hex) + v(2 hex)
        (uint8 v, bytes32 r, bytes32 s) = _signRegistration(advAgentPrivKey1, human1);

        // Build hex string without 0x prefixes
        bytes memory addrHex = bytes(_toHexString(advAgentAddr1));
        bytes memory rHex = bytes(_toHexString32(r));
        bytes memory sHex = bytes(_toHexString32(s));
        bytes memory vHex = bytes(_toHexString8(v));

        bytes memory userData = abi.encodePacked("K0", addrHex, rHex, sHex, vHex);
        assertEq(userData.length, 172, "String-encoded advanced userData should be 172 bytes");

        bytes memory encodedOutput = _buildEncodedOutput(human1, nullifier1);
        vm.prank(hubMock);
        registry.onVerificationSuccess(encodedOutput, userData);

        assertTrue(registry.isVerifiedAgent(advAgentKey1));
    }

    function test_AdvancedDeregister() public {
        _registerViaHubAdvanced(human1, nullifier1, advAgentPrivKey1);
        assertTrue(registry.isVerifiedAgent(advAgentKey1));

        _deregisterViaHubAdvanced(human1, nullifier1, advAgentAddr1);
        assertFalse(registry.isVerifiedAgent(advAgentKey1));
        assertEq(registry.getAgentId(advAgentKey1), 0);
    }

    function test_AdvancedReRegisterAfterDeregister() public {
        _registerViaHubAdvanced(human1, nullifier1, advAgentPrivKey1);
        uint256 firstId = registry.getAgentId(advAgentKey1);
        assertTrue(registry.isVerifiedAgent(advAgentKey1));

        _deregisterViaHubAdvanced(human1, nullifier1, advAgentAddr1);
        assertFalse(registry.isVerifiedAgent(advAgentKey1));

        _registerViaHubAdvanced(human1, nullifier1, advAgentPrivKey1);
        uint256 secondId = registry.getAgentId(advAgentKey1);
        assertTrue(registry.isVerifiedAgent(advAgentKey1));
        assertGt(secondId, firstId);
    }

    function test_RevertWhen_ReplayAttackAfterDeregister() public {
        // Capture the signature at nonce 0
        (uint8 v, bytes32 r, bytes32 s) = _signRegistration(advAgentPrivKey1, human1);
        bytes memory oldUserData = _buildAdvancedUserData(advAgentAddr1, v, r, s);

        // Register (consumes nonce 0) then deregister
        bytes memory encodedOutput = _buildEncodedOutput(human1, nullifier1);
        vm.prank(hubMock);
        registry.onVerificationSuccess(encodedOutput, oldUserData);
        assertTrue(registry.isVerifiedAgent(advAgentKey1));
        assertEq(registry.agentNonces(advAgentAddr1), 1, "Nonce should be 1 after registration");

        _deregisterViaHubAdvanced(human1, nullifier1, advAgentAddr1);
        assertFalse(registry.isVerifiedAgent(advAgentKey1));

        // Replay the old signature — should fail because nonce is now 1
        vm.prank(hubMock);
        vm.expectRevert(SelfAgentRegistry.InvalidAgentSignature.selector);
        registry.onVerificationSuccess(encodedOutput, oldUserData);
    }

    function test_NonceIncrementsOnRegistration() public {
        assertEq(registry.agentNonces(advAgentAddr1), 0);

        _registerViaHubAdvanced(human1, nullifier1, advAgentPrivKey1);
        assertEq(registry.agentNonces(advAgentAddr1), 1);

        _deregisterViaHubAdvanced(human1, nullifier1, advAgentAddr1);

        // Re-register with fresh signature (nonce 1)
        _registerViaHubAdvanced(human1, nullifier1, advAgentPrivKey1);
        assertEq(registry.agentNonces(advAgentAddr1), 2);
    }

    function test_RevertWhen_AdvancedWrongSignature() public {
        // Agent 2 signs, but we claim it's agent 1
        (uint8 v, bytes32 r, bytes32 s) = _signRegistration(advAgentPrivKey2, human1);
        bytes memory encodedOutput = _buildEncodedOutput(human1, nullifier1);
        bytes memory userData = _buildAdvancedUserData(advAgentAddr1, v, r, s);

        vm.prank(hubMock);
        vm.expectRevert(SelfAgentRegistry.InvalidAgentSignature.selector);
        registry.onVerificationSuccess(encodedOutput, userData);
    }

    function test_RevertWhen_AdvancedSignatureForWrongHuman() public {
        // Agent signs for human1, but proof is for human2
        (uint8 v, bytes32 r, bytes32 s) = _signRegistration(advAgentPrivKey1, human1);
        bytes memory encodedOutput = _buildEncodedOutput(human2, nullifier2);
        bytes memory userData = _buildAdvancedUserData(advAgentAddr1, v, r, s);

        vm.prank(hubMock);
        vm.expectRevert(SelfAgentRegistry.InvalidAgentSignature.selector);
        registry.onVerificationSuccess(encodedOutput, userData);
    }

    function test_RevertWhen_AdvancedUserDataTooShort() public {
        bytes memory encodedOutput = _buildEncodedOutput(human1, nullifier1);
        // Too short for advanced register (needs 172 chars)
        bytes memory userData = abi.encodePacked("K0", bytes9(0));

        vm.prank(hubMock);
        vm.expectRevert(SelfAgentRegistry.InvalidUserData.selector);
        registry.onVerificationSuccess(encodedOutput, userData);
    }

    function test_SimpleModeStillWorks() public {
        // Ensure simple mode is completely unaffected by advanced mode additions
        _registerViaHub(human1, nullifier1);
        assertTrue(registry.isVerifiedAgent(agentKey1));
        assertEq(registry.ownerOf(registry.getAgentId(agentKey1)), human1);

        _deregisterViaHub(human1, nullifier1);
        assertFalse(registry.isVerifiedAgent(agentKey1));
    }

    function test_MixedModes() public {
        // Register one agent simple, one advanced
        _registerViaHub(human1, nullifier1);
        _registerViaHubAdvanced(human2, nullifier2, advAgentPrivKey1);

        // Both should be verifiable
        assertTrue(registry.isVerifiedAgent(agentKey1));
        assertTrue(registry.isVerifiedAgent(advAgentKey1));

        // Different agent IDs
        uint256 simpleId = registry.getAgentId(agentKey1);
        uint256 advancedId = registry.getAgentId(advAgentKey1);
        assertEq(simpleId, 1);
        assertEq(advancedId, 2);

        // Different owners
        assertEq(registry.ownerOf(simpleId), human1);
        assertEq(registry.ownerOf(advancedId), human2);
    }

    // ====================================================
    // Hex formatting helpers for string-encoded tests
    // ====================================================

    function _toHexString(address addr) internal pure returns (string memory) {
        bytes memory result = new bytes(40);
        bytes memory hexChars = "0123456789abcdef";
        uint160 value = uint160(addr);
        for (uint256 i = 40; i > 0; i--) {
            result[i - 1] = hexChars[value & 0xf];
            value >>= 4;
        }
        return string(result);
    }

    function _toHexString32(bytes32 val) internal pure returns (string memory) {
        bytes memory result = new bytes(64);
        bytes memory hexChars = "0123456789abcdef";
        uint256 value = uint256(val);
        for (uint256 i = 64; i > 0; i--) {
            result[i - 1] = hexChars[value & 0xf];
            value >>= 4;
        }
        return string(result);
    }

    function _toHexString8(uint8 val) internal pure returns (string memory) {
        bytes memory result = new bytes(2);
        bytes memory hexChars = "0123456789abcdef";
        result[1] = hexChars[val & 0xf];
        result[0] = hexChars[(val >> 4) & 0xf];
        return string(result);
    }

    // ====================================================
    // V4: Wallet-Free Registration — Helpers
    // ====================================================

    function _buildWalletFreeUserData(
        address agentAddr,
        address guardian,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) internal pure returns (bytes memory) {
        // "W" + config(1) + agentAddr(40 hex) + guardian(40 hex) + r(64 hex) + s(64 hex) + v(2 hex) = 212 chars
        return abi.encodePacked(
            "W0",
            _toHexString(agentAddr),
            _toHexString(guardian),
            _toHexString32(r),
            _toHexString32(s),
            _toHexString8(v)
        );
    }

    function _registerWalletFree(
        address humanAddr,
        uint256 nullifier,
        uint256 agentPrivKey,
        address guardian
    ) internal {
        address agentAddr = vm.addr(agentPrivKey);
        (uint8 v, bytes32 r, bytes32 s) = _signRegistration(agentPrivKey, humanAddr);
        bytes memory encodedOutput = _buildEncodedOutput(humanAddr, nullifier);
        bytes memory userData = _buildWalletFreeUserData(agentAddr, guardian, v, r, s);
        vm.prank(hubMock);
        registry.onVerificationSuccess(encodedOutput, userData);
    }

    // ====================================================
    // V4: Wallet-Free Registration — Tests
    // ====================================================

    function test_WalletFreeRegister_MintsToAgent() public {
        _registerWalletFree(human1, nullifier1, advAgentPrivKey1, human1);

        uint256 agentId = registry.getAgentId(advAgentKey1);
        assertEq(agentId, 1);
        assertTrue(registry.isVerifiedAgent(advAgentKey1));
        assertTrue(registry.hasHumanProof(agentId));
        // NFT minted to agent address, NOT human address
        assertEq(registry.ownerOf(agentId), advAgentAddr1);
    }

    function test_WalletFreeRegister_SetsGuardian() public {
        _registerWalletFree(human1, nullifier1, advAgentPrivKey1, human1);

        uint256 agentId = registry.getAgentId(advAgentKey1);
        assertEq(registry.agentGuardian(agentId), human1);
    }

    function test_WalletFreeRegister_NoGuardian() public {
        _registerWalletFree(human1, nullifier1, advAgentPrivKey1, address(0));

        uint256 agentId = registry.getAgentId(advAgentKey1);
        assertEq(registry.agentGuardian(agentId), address(0));
    }

    function test_WalletFreeRegister_EmitsGuardianEvent() public {
        address agentAddr = vm.addr(advAgentPrivKey1);
        (uint8 v, bytes32 r, bytes32 s) = _signRegistration(advAgentPrivKey1, human1);
        bytes memory encodedOutput = _buildEncodedOutput(human1, nullifier1);
        bytes memory userData = _buildWalletFreeUserData(agentAddr, human1, v, r, s);

        vm.expectEmit(true, true, false, false);
        emit SelfAgentRegistry.GuardianSet(1, human1);

        vm.prank(hubMock);
        registry.onVerificationSuccess(encodedOutput, userData);
    }

    function test_WalletFreeRegister_StringEncoding() public {
        (uint8 v, bytes32 r, bytes32 s) = _signRegistration(advAgentPrivKey1, human1);

        bytes memory addrHex = bytes(_toHexString(advAgentAddr1));
        bytes memory guardianHex = bytes(_toHexString(human1));
        bytes memory rHex = bytes(_toHexString32(r));
        bytes memory sHex = bytes(_toHexString32(s));
        bytes memory vHex = bytes(_toHexString8(v));

        bytes memory userData = abi.encodePacked("W0", addrHex, guardianHex, rHex, sHex, vHex);
        assertEq(userData.length, 212, "String-encoded wallet-free userData should be 212 bytes");

        bytes memory encodedOutput = _buildEncodedOutput(human1, nullifier1);
        vm.prank(hubMock);
        registry.onVerificationSuccess(encodedOutput, userData);

        assertTrue(registry.isVerifiedAgent(advAgentKey1));
        assertEq(registry.ownerOf(registry.getAgentId(advAgentKey1)), advAgentAddr1);
        assertEq(registry.agentGuardian(registry.getAgentId(advAgentKey1)), human1);
    }

    function test_RevertWhen_WalletFreeUserDataTooShort() public {
        bytes memory encodedOutput = _buildEncodedOutput(human1, nullifier1);
        // Too short for wallet-free register (needs 212 chars)
        bytes memory userData = abi.encodePacked("W0", bytes20(0));

        vm.prank(hubMock);
        vm.expectRevert(SelfAgentRegistry.InvalidUserData.selector);
        registry.onVerificationSuccess(encodedOutput, userData);
    }

    function test_RevertWhen_WalletFreeWrongSignature() public {
        // Agent 2 signs, but we claim it's agent 1
        (uint8 v, bytes32 r, bytes32 s) = _signRegistration(advAgentPrivKey2, human1);
        bytes memory encodedOutput = _buildEncodedOutput(human1, nullifier1);
        bytes memory userData = _buildWalletFreeUserData(advAgentAddr1, human1, v, r, s);

        vm.prank(hubMock);
        vm.expectRevert(SelfAgentRegistry.InvalidAgentSignature.selector);
        registry.onVerificationSuccess(encodedOutput, userData);
    }

    // ====================================================
    // V4: Guardian Revoke — Tests
    // ====================================================

    function test_GuardianRevoke() public {
        _registerWalletFree(human1, nullifier1, advAgentPrivKey1, human1);
        uint256 agentId = registry.getAgentId(advAgentKey1);
        assertTrue(registry.isVerifiedAgent(advAgentKey1));

        vm.prank(human1); // guardian
        registry.guardianRevoke(agentId);

        assertFalse(registry.isVerifiedAgent(advAgentKey1));
        assertEq(registry.getAgentCountForHuman(nullifier1), 0);
    }

    function test_RevertWhen_GuardianRevoke_NotGuardian() public {
        _registerWalletFree(human1, nullifier1, advAgentPrivKey1, human1);
        uint256 agentId = registry.getAgentId(advAgentKey1);

        vm.prank(human2); // not guardian
        vm.expectRevert(abi.encodeWithSelector(SelfAgentRegistry.NotGuardian.selector, agentId));
        registry.guardianRevoke(agentId);
    }

    function test_RevertWhen_GuardianRevoke_NoGuardianSet() public {
        // Register without guardian
        _registerWalletFree(human1, nullifier1, advAgentPrivKey1, address(0));
        uint256 agentId = registry.getAgentId(advAgentKey1);

        vm.prank(human1);
        vm.expectRevert(abi.encodeWithSelector(SelfAgentRegistry.NoGuardianSet.selector, agentId));
        registry.guardianRevoke(agentId);
    }

    function test_GuardianRevoke_ClearsGuardian() public {
        _registerWalletFree(human1, nullifier1, advAgentPrivKey1, human1);
        uint256 agentId = registry.getAgentId(advAgentKey1);

        vm.prank(human1);
        registry.guardianRevoke(agentId);

        assertEq(registry.agentGuardian(agentId), address(0));
    }

    // ====================================================
    // V4: Self-Deregister — Tests
    // ====================================================

    function test_SelfDeregister_ByNftOwner() public {
        _registerWalletFree(human1, nullifier1, advAgentPrivKey1, human1);
        uint256 agentId = registry.getAgentId(advAgentKey1);

        // Agent (NFT owner) deregisters itself
        vm.prank(advAgentAddr1);
        registry.selfDeregister(agentId);

        assertFalse(registry.isVerifiedAgent(advAgentKey1));
    }

    function test_SelfDeregister_SimpleMode() public {
        // Simple mode: human owns the NFT, human can self-deregister
        _registerViaHub(human1, nullifier1);
        uint256 agentId = registry.getAgentId(agentKey1);

        vm.prank(human1);
        registry.selfDeregister(agentId);

        assertFalse(registry.isVerifiedAgent(agentKey1));
    }

    function test_RevertWhen_SelfDeregister_NotOwner() public {
        _registerWalletFree(human1, nullifier1, advAgentPrivKey1, human1);
        uint256 agentId = registry.getAgentId(advAgentKey1);

        vm.prank(human2); // not the NFT owner
        vm.expectRevert(abi.encodeWithSelector(SelfAgentRegistry.NotNftOwner.selector, agentId));
        registry.selfDeregister(agentId);
    }

    // ====================================================
    // V4: Metadata — Tests
    // ====================================================

    function test_UpdateMetadata() public {
        _registerViaHub(human1, nullifier1);
        uint256 agentId = registry.getAgentId(agentKey1);

        string memory metadata = '{"verified":{"olderThan":18},"declared":{"name":"REMI"}}';

        vm.prank(human1);
        registry.updateAgentMetadata(agentId, metadata);

        assertEq(registry.getAgentMetadata(agentId), metadata);
    }

    function test_UpdateMetadata_EmitsEvent() public {
        _registerViaHub(human1, nullifier1);
        uint256 agentId = registry.getAgentId(agentKey1);

        vm.expectEmit(true, false, false, false);
        emit SelfAgentRegistry.AgentMetadataUpdated(agentId);

        vm.prank(human1);
        registry.updateAgentMetadata(agentId, "{}");
    }

    function test_RevertWhen_UpdateMetadata_NotOwner() public {
        _registerViaHub(human1, nullifier1);
        uint256 agentId = registry.getAgentId(agentKey1);

        vm.prank(human2);
        vm.expectRevert(abi.encodeWithSelector(SelfAgentRegistry.NotNftOwner.selector, agentId));
        registry.updateAgentMetadata(agentId, "{}");
    }

    function test_Metadata_WalletFreeAgent() public {
        _registerWalletFree(human1, nullifier1, advAgentPrivKey1, human1);
        uint256 agentId = registry.getAgentId(advAgentKey1);

        // Agent (NFT owner) can update its own metadata
        string memory metadata = '{"verified":{"olderThan":21},"declared":{"purpose":"trading"}}';
        vm.prank(advAgentAddr1);
        registry.updateAgentMetadata(agentId, metadata);

        assertEq(registry.getAgentMetadata(agentId), metadata);
    }

    function test_Metadata_ClearedOnRevoke() public {
        _registerViaHub(human1, nullifier1);
        uint256 agentId = registry.getAgentId(agentKey1);

        vm.prank(human1);
        registry.updateAgentMetadata(agentId, '{"test":true}');
        assertEq(registry.getAgentMetadata(agentId), '{"test":true}');

        _deregisterViaHub(human1, nullifier1);
        assertEq(registry.getAgentMetadata(agentId), "");
    }

    function test_Metadata_DefaultEmpty() public {
        _registerViaHub(human1, nullifier1);
        uint256 agentId = registry.getAgentId(agentKey1);
        assertEq(registry.getAgentMetadata(agentId), "");
    }

    // ====================================================
    // V4: Mixed Modes — All three modes coexist
    // ====================================================

    function test_AllThreeModes() public {
        vm.prank(owner);
        registry.setMaxAgentsPerHuman(0);

        // Simple: human1
        _registerViaHub(human1, nullifier1);

        // Advanced: human2 + advAgentPrivKey1
        _registerViaHubAdvanced(human2, nullifier2, advAgentPrivKey1);

        // Wallet-free: human1alt + advAgentPrivKey2 (same human as human1 via nullifier1)
        _registerWalletFree(human1alt, nullifier1, advAgentPrivKey2, human1alt);

        // Verify all three
        assertTrue(registry.isVerifiedAgent(agentKey1));
        assertTrue(registry.isVerifiedAgent(advAgentKey1));
        assertTrue(registry.isVerifiedAgent(advAgentKey2));

        // Simple → NFT owned by human
        assertEq(registry.ownerOf(registry.getAgentId(agentKey1)), human1);
        // Advanced → NFT owned by human
        assertEq(registry.ownerOf(registry.getAgentId(advAgentKey1)), human2);
        // Wallet-free → NFT owned by agent
        assertEq(registry.ownerOf(registry.getAgentId(advAgentKey2)), advAgentAddr2);

        // Wallet-free has guardian
        assertEq(registry.agentGuardian(registry.getAgentId(advAgentKey2)), human1alt);
        // Others don't
        assertEq(registry.agentGuardian(registry.getAgentId(agentKey1)), address(0));
        assertEq(registry.agentGuardian(registry.getAgentId(advAgentKey1)), address(0));

        // Same human check
        assertTrue(registry.sameHuman(
            registry.getAgentId(agentKey1),
            registry.getAgentId(advAgentKey2)
        ));
        assertFalse(registry.sameHuman(
            registry.getAgentId(agentKey1),
            registry.getAgentId(advAgentKey1)
        ));
    }

    // ====================================================
    // V4: Fuzz — Wallet-Free
    // ====================================================

    function testFuzz_WalletFreeRegister(uint256 nullifier, address humanAddr, uint256 agentPrivKey) public {
        vm.assume(humanAddr != address(0));
        vm.assume(nullifier != 0);
        vm.assume(agentPrivKey != 0);
        vm.assume(agentPrivKey < 115792089237316195423570985008687907852837564279074904382605163141518161494337); // secp256k1 order

        address agentAddr = vm.addr(agentPrivKey);
        vm.assume(agentAddr != address(0));

        _registerWalletFree(humanAddr, nullifier, agentPrivKey, humanAddr);

        bytes32 agentKey = bytes32(uint256(uint160(agentAddr)));
        uint256 agentId = registry.getAgentId(agentKey);
        assertTrue(agentId != 0);
        assertTrue(registry.isVerifiedAgent(agentKey));
        assertEq(registry.ownerOf(agentId), agentAddr);
        assertEq(registry.agentGuardian(agentId), humanAddr);
    }

    // ====================================================
    // V5: ZK-Attested Credentials — Tests
    // ====================================================

    function _assertCredentialsMatch(uint256 agentId) internal view {
        SelfAgentRegistry.AgentCredentials memory creds = registry.getAgentCredentials(agentId);
        assertEq(creds.issuingState, "GBR");
        assertEq(creds.nationality, "GBR");
        assertEq(creds.dateOfBirth, "950101");
        assertEq(creds.gender, "F");
        assertEq(creds.expiryDate, "300101");
        assertEq(creds.idNumber, "123456789");
        assertEq(creds.olderThan, 0);
        assertEq(creds.name.length, 3);
        assertEq(creds.name[0], "ALICE");
        assertEq(creds.name[1], "");
        assertEq(creds.name[2], "SMITH");
        assertFalse(creds.ofac[0]);
        assertFalse(creds.ofac[1]);
        assertFalse(creds.ofac[2]);
    }

    function _assertCredentialsEmpty(uint256 agentId) internal view {
        SelfAgentRegistry.AgentCredentials memory creds = registry.getAgentCredentials(agentId);
        assertEq(bytes(creds.issuingState).length, 0);
        assertEq(bytes(creds.nationality).length, 0);
        assertEq(bytes(creds.dateOfBirth).length, 0);
        assertEq(bytes(creds.gender).length, 0);
        assertEq(bytes(creds.expiryDate).length, 0);
        assertEq(bytes(creds.idNumber).length, 0);
        assertEq(creds.olderThan, 0);
        assertEq(creds.name.length, 0);
    }

    function test_Credentials_StoredOnSimpleRegister() public {
        _registerViaHub(human1, nullifier1);
        uint256 agentId = registry.getAgentId(agentKey1);
        _assertCredentialsMatch(agentId);
    }

    function test_Credentials_StoredOnAdvancedRegister() public {
        _registerViaHubAdvanced(human1, nullifier1, advAgentPrivKey1);
        uint256 agentId = registry.getAgentId(advAgentKey1);
        _assertCredentialsMatch(agentId);
    }

    function test_Credentials_StoredOnWalletFreeRegister() public {
        _registerWalletFree(human1, nullifier1, advAgentPrivKey1, human1);
        uint256 agentId = registry.getAgentId(advAgentKey1);
        _assertCredentialsMatch(agentId);
    }

    function test_Credentials_ClearedOnRevoke() public {
        _registerViaHub(human1, nullifier1);
        uint256 agentId = registry.getAgentId(agentKey1);
        _assertCredentialsMatch(agentId);

        _deregisterViaHub(human1, nullifier1);
        _assertCredentialsEmpty(agentId);
    }

    function test_Credentials_ClearedOnGuardianRevoke() public {
        _registerWalletFree(human1, nullifier1, advAgentPrivKey1, human1);
        uint256 agentId = registry.getAgentId(advAgentKey1);
        _assertCredentialsMatch(agentId);

        vm.prank(human1);
        registry.guardianRevoke(agentId);
        _assertCredentialsEmpty(agentId);
    }

    function test_Credentials_EmptyByDefault() public view {
        _assertCredentialsEmpty(999);
    }

    function test_Credentials_EmitEvent() public {
        bytes memory encodedOutput = _buildEncodedOutput(human1, nullifier1);
        bytes memory userData = _buildUserData(0x52);

        vm.expectEmit(true, false, false, false);
        emit SelfAgentRegistry.AgentCredentialsStored(1);

        vm.prank(hubMock);
        registry.onVerificationSuccess(encodedOutput, userData);
    }

    function test_Credentials_ReRegistration() public {
        _registerViaHub(human1, nullifier1);
        uint256 firstAgentId = registry.getAgentId(agentKey1);
        _assertCredentialsMatch(firstAgentId);

        _deregisterViaHub(human1, nullifier1);
        _assertCredentialsEmpty(firstAgentId);

        _registerViaHub(human1, nullifier1);
        uint256 secondAgentId = registry.getAgentId(agentKey1);
        _assertCredentialsMatch(secondAgentId);
    }

    // ====================================================
    // V4: Multi-Config Verification Tests
    // ====================================================

    function test_MultiConfig_GetConfigIdBase() public view {
        bytes32 result = registry.getConfigId(0, 0, bytes("R0"));
        assertEq(result, registry.configIds(0));
    }

    function test_MultiConfig_GetConfigIdAge18() public view {
        bytes32 result = registry.getConfigId(0, 0, bytes("R1"));
        assertEq(result, registry.configIds(1));
    }

    function test_MultiConfig_GetConfigIdAge21() public view {
        bytes32 result = registry.getConfigId(0, 0, bytes("R2"));
        assertEq(result, registry.configIds(2));
    }

    function test_MultiConfig_GetConfigIdOFAC() public view {
        bytes32 result = registry.getConfigId(0, 0, bytes("R3"));
        assertEq(result, registry.configIds(3));
    }

    function test_MultiConfig_GetConfigIdAge18OFAC() public view {
        bytes32 result = registry.getConfigId(0, 0, bytes("R4"));
        assertEq(result, registry.configIds(4));
    }

    function test_MultiConfig_GetConfigIdAge21OFAC() public view {
        bytes32 result = registry.getConfigId(0, 0, bytes("R5"));
        assertEq(result, registry.configIds(5));
    }

    function test_MultiConfig_DefaultOnShortData() public view {
        bytes32 result = registry.getConfigId(0, 0, bytes("R"));
        assertEq(result, registry.configIds(0));
    }

    function test_RevertWhen_InvalidConfigDigit() public {
        vm.expectRevert(abi.encodeWithSelector(SelfAgentRegistry.InvalidConfigIndex.selector, uint8(0x39)));
        registry.getConfigId(0, 0, bytes("R9"));
    }

    function test_MultiConfig_BinaryConfigByte() public view {
        // getConfigId accepts binary config bytes (0x00-0x05) at position [1]
        bytes memory data = abi.encodePacked(uint8(0x52), uint8(0x04));
        bytes32 result = registry.getConfigId(0, 0, data);
        assertEq(result, registry.configIds(4));
    }

    function test_MultiConfig_AllConfigIdsNonZero() public view {
        for (uint256 i = 0; i < 6; i++) {
            assertTrue(registry.configIds(i) != bytes32(0), "Config ID should be non-zero");
        }
        // All should be the same fakeConfigId since we mock all calls
        // (In production they'd be distinct — the mock returns the same value)
    }

    function test_MultiConfig_RegisterWithConfig4() public {
        // Register simple mode with config "4" (18+ OFAC)
        bytes memory encodedOutput = _buildEncodedOutput(human1, nullifier1);
        bytes memory userData = abi.encodePacked("R4");
        vm.prank(hubMock);
        registry.onVerificationSuccess(encodedOutput, userData);

        assertTrue(registry.isVerifiedAgent(agentKey1));
    }

    function test_MultiConfig_AdvancedWithConfig1() public {
        // "K1" + addr + sig
        (uint8 v, bytes32 r, bytes32 s) = _signRegistration(advAgentPrivKey1, human1);

        bytes memory addrHex = bytes(_toHexString(advAgentAddr1));
        bytes memory rHex = bytes(_toHexString32(r));
        bytes memory sHex = bytes(_toHexString32(s));
        bytes memory vHex = bytes(_toHexString8(v));

        bytes memory userData = abi.encodePacked("K1", addrHex, rHex, sHex, vHex);
        assertEq(userData.length, 172);

        bytes memory encodedOutput = _buildEncodedOutput(human1, nullifier1);
        vm.prank(hubMock);
        registry.onVerificationSuccess(encodedOutput, userData);

        assertTrue(registry.isVerifiedAgent(advAgentKey1));
    }

    function test_MultiConfig_WalletFreeWithConfig3() public {
        // "W3" + agent + guardian + sig
        (uint8 v, bytes32 r, bytes32 s) = _signRegistration(advAgentPrivKey1, human1);

        bytes memory addrHex = bytes(_toHexString(advAgentAddr1));
        bytes memory guardianHex = bytes(_toHexString(human1));
        bytes memory rHex = bytes(_toHexString32(r));
        bytes memory sHex = bytes(_toHexString32(s));
        bytes memory vHex = bytes(_toHexString8(v));

        bytes memory userData = abi.encodePacked("W3", addrHex, guardianHex, rHex, sHex, vHex);
        assertEq(userData.length, 212);

        bytes memory encodedOutput = _buildEncodedOutput(human1, nullifier1);
        vm.prank(hubMock);
        registry.onVerificationSuccess(encodedOutput, userData);

        assertTrue(registry.isVerifiedAgent(advAgentKey1));
        assertEq(registry.agentGuardian(registry.getAgentId(advAgentKey1)), human1);
    }

    // ====================================================
    // V4: Edge Case & Robustness Tests
    // ====================================================

    function test_MultiConfig_EmptyDataReverts() public {
        // Empty userData should revert with InvalidUserData (length == 0 check)
        bytes memory encodedOutput = _buildEncodedOutput(human1, nullifier1);
        vm.prank(hubMock);
        vm.expectRevert(SelfAgentRegistry.InvalidUserData.selector);
        registry.onVerificationSuccess(encodedOutput, "");
    }

    function test_MultiConfig_SingleByteDefaultsToConfig0() public view {
        // Single byte "R" (no config digit) — getConfigId defaults to config 0
        bytes32 result = registry.getConfigId(0, 0, bytes("R"));
        assertEq(result, registry.configIds(0), "Single byte should default to config 0");
    }

    function test_RevertWhen_ASCII6OutOfRange() public {
        // '6' = 0x36 is out of range — should revert
        vm.expectRevert(abi.encodeWithSelector(SelfAgentRegistry.InvalidConfigIndex.selector, uint8(0x36)));
        registry.getConfigId(0, 0, bytes("R6"));
    }

    function test_RevertWhen_Binary6OutOfRange() public {
        // Binary 0x06 is out of range — should revert
        bytes memory data = abi.encodePacked(uint8(0x52), uint8(0x06));
        vm.expectRevert(abi.encodeWithSelector(SelfAgentRegistry.InvalidConfigIndex.selector, uint8(0x06)));
        registry.getConfigId(0, 0, data);
    }

    function test_RevertWhen_HighByteOutOfRange() public {
        // 0xFF is out of both ASCII and binary range — should revert
        bytes memory data = abi.encodePacked(uint8(0x52), uint8(0xFF));
        vm.expectRevert(abi.encodeWithSelector(SelfAgentRegistry.InvalidConfigIndex.selector, uint8(0xFF)));
        registry.getConfigId(0, 0, data);
    }

    function test_MultiConfig_BinaryAllConfigs() public view {
        // Verify all 6 binary config bytes (0x00-0x05) map correctly
        for (uint8 i = 0; i <= 5; i++) {
            bytes memory data = abi.encodePacked(uint8(0x52), i); // 'R' + binary config
            bytes32 result = registry.getConfigId(0, 0, data);
            assertEq(result, registry.configIds(i), "Binary config mismatch");
        }
    }

    function test_MultiConfig_ASCIIAllConfigs() public view {
        // Verify all 6 ASCII config chars ('0'-'5') map correctly
        bytes memory chars = bytes("012345");
        for (uint256 i = 0; i < 6; i++) {
            bytes memory data = abi.encodePacked(uint8(0x52), chars[i]); // "R" + digit
            bytes32 result = registry.getConfigId(0, 0, data);
            assertEq(result, registry.configIds(i), "ASCII config mismatch");
        }
    }

    function test_MultiConfig_DeregisterWithConfig0Works() public {
        // Register then deregister with "D0" format
        bytes memory encodedOutput = _buildEncodedOutput(human1, nullifier1);
        vm.prank(hubMock);
        registry.onVerificationSuccess(encodedOutput, bytes("R0"));
        assertTrue(registry.isVerifiedAgent(agentKey1));

        vm.prank(hubMock);
        registry.onVerificationSuccess(encodedOutput, bytes("D0"));
        assertFalse(registry.isVerifiedAgent(agentKey1));
    }

    function test_MultiConfig_DeregisterAdvancedWithConfig() public {
        // Register advanced with "K0", then deregister with "X0"
        (uint8 v, bytes32 r, bytes32 s) = _signRegistration(advAgentPrivKey1, human1);
        bytes memory regData = _buildAdvancedUserData(advAgentAddr1, v, r, s);
        assertEq(regData.length, 172);

        bytes memory encodedOutput = _buildEncodedOutput(human1, nullifier1);
        vm.prank(hubMock);
        registry.onVerificationSuccess(encodedOutput, regData);
        assertTrue(registry.isVerifiedAgent(advAgentKey1));

        // Deregister: "X0" + address(40 hex) = 42 chars
        bytes memory deregData = abi.encodePacked("X0", _toHexString(advAgentAddr1));
        assertEq(deregData.length, 42);

        vm.prank(hubMock);
        registry.onVerificationSuccess(encodedOutput, deregData);
        assertFalse(registry.isVerifiedAgent(advAgentKey1));
    }

    function test_MultiConfig_StringDeregisterAdvancedWithConfig() public {
        // Register with "K0", deregister with "X0"
        (uint8 v, bytes32 r, bytes32 s) = _signRegistration(advAgentPrivKey1, human1);
        bytes memory addrHex = bytes(_toHexString(advAgentAddr1));
        bytes memory rHex = bytes(_toHexString32(r));
        bytes memory sHex = bytes(_toHexString32(s));
        bytes memory vHex = bytes(_toHexString8(v));

        bytes memory regData = abi.encodePacked("K0", addrHex, rHex, sHex, vHex);
        assertEq(regData.length, 172);

        bytes memory encodedOutput = _buildEncodedOutput(human1, nullifier1);
        vm.prank(hubMock);
        registry.onVerificationSuccess(encodedOutput, regData);
        assertTrue(registry.isVerifiedAgent(advAgentKey1));

        // Deregister: "X0" + address = 42 chars
        bytes memory deregData = abi.encodePacked("X0", addrHex);
        assertEq(deregData.length, 42);

        vm.prank(hubMock);
        registry.onVerificationSuccess(encodedOutput, deregData);
        assertFalse(registry.isVerifiedAgent(advAgentKey1));
    }

    function test_MultiConfig_ConfigDoesNotAffectRegistration() public {
        // Config 0 and config 5 should both register successfully
        // (Config only affects Hub V2 verification requirements, not our contract logic)
        bytes memory encodedOutput1 = _buildEncodedOutput(human1, nullifier1);
        vm.prank(hubMock);
        registry.onVerificationSuccess(encodedOutput1, bytes("R0"));
        assertTrue(registry.isVerifiedAgent(agentKey1));

        bytes memory encodedOutput2 = _buildEncodedOutput(human2, nullifier2);
        vm.prank(hubMock);
        registry.onVerificationSuccess(encodedOutput2, bytes("R5"));
        assertTrue(registry.isVerifiedAgent(agentKey2));
    }

    function test_MultiConfig_AdvancedRegisterTooShort() public {
        // Advanced register with only 171 chars (missing 1 char, needs 172) should revert
        bytes memory encodedOutput = _buildEncodedOutput(human1, nullifier1);
        bytes memory tooShort = new bytes(171);
        tooShort[0] = bytes1(uint8(0x4B)); // 'K'
        tooShort[1] = bytes1(uint8(0x30)); // '0'
        vm.prank(hubMock);
        vm.expectRevert(SelfAgentRegistry.InvalidUserData.selector);
        registry.onVerificationSuccess(encodedOutput, tooShort);
    }

    function test_MultiConfig_WalletFreeTooShort() public {
        // Wallet-free with only 211 chars (missing 1 char, needs 212) should revert
        bytes memory encodedOutput = _buildEncodedOutput(human1, nullifier1);
        bytes memory tooShort = new bytes(211);
        tooShort[0] = bytes1(uint8(0x57)); // 'W'
        tooShort[1] = bytes1(uint8(0x30)); // '0'
        vm.prank(hubMock);
        vm.expectRevert(SelfAgentRegistry.InvalidUserData.selector);
        registry.onVerificationSuccess(encodedOutput, tooShort);
    }

    function test_MultiConfig_DeregAdvancedTooShort() public {
        // Advanced deregister with only 41 chars (missing 1 char, needs 42) should revert
        bytes memory encodedOutput = _buildEncodedOutput(human1, nullifier1);
        bytes memory tooShort = new bytes(41);
        tooShort[0] = bytes1(uint8(0x58)); // 'X'
        tooShort[1] = bytes1(uint8(0x30)); // '0'
        vm.prank(hubMock);
        vm.expectRevert(SelfAgentRegistry.InvalidUserData.selector);
        registry.onVerificationSuccess(encodedOutput, tooShort);
    }

    function test_RevertWhen_GapBetweenBinaryAndASCII() public {
        // Bytes 0x06-0x2F fall between binary (0-5) and ASCII ('0'=0x30)
        // All should revert with InvalidConfigIndex
        bytes memory data06 = abi.encodePacked(uint8(0x52), uint8(0x06));
        vm.expectRevert(abi.encodeWithSelector(SelfAgentRegistry.InvalidConfigIndex.selector, uint8(0x06)));
        registry.getConfigId(0, 0, data06);
    }

    function test_MultiConfig_SimpleRegisterAllConfigsEndToEnd() public {
        // Register with each of the 6 configs via simple mode and verify each works
        address[6] memory humans;
        uint256[6] memory nullifiers;
        for (uint256 i = 0; i < 6; i++) {
            humans[i] = address(uint160(0xBEEF00 + i));
            nullifiers[i] = 900000 + i;
        }

        bytes memory configChars = bytes("012345");
        for (uint256 i = 0; i < 6; i++) {
            bytes memory encodedOutput = _buildEncodedOutput(humans[i], nullifiers[i]);
            bytes memory userData = abi.encodePacked(uint8(0x52), configChars[i]); // "R" + digit
            vm.prank(hubMock);
            registry.onVerificationSuccess(encodedOutput, userData);
            bytes32 key = bytes32(uint256(uint160(humans[i])));
            assertTrue(registry.isVerifiedAgent(key), "Agent should be verified");
        }
    }

    // ====================================================
    // Security Audit: Soulbound NFTs (C-1)
    // ====================================================

    function test_RevertWhen_TransferAgent() public {
        _registerViaHub(human1, nullifier1);
        uint256 agentId = registry.getAgentId(agentKey1);

        vm.prank(human1);
        vm.expectRevert(SelfAgentRegistry.TransferNotAllowed.selector);
        registry.transferFrom(human1, human2, agentId);
    }

    function test_RevertWhen_SafeTransferAgent() public {
        _registerViaHub(human1, nullifier1);
        uint256 agentId = registry.getAgentId(agentKey1);

        vm.prank(human1);
        vm.expectRevert(SelfAgentRegistry.TransferNotAllowed.selector);
        registry.safeTransferFrom(human1, human2, agentId);
    }

    function test_MintAndBurnStillWork() public {
        // Mint via registration
        _registerViaHub(human1, nullifier1);
        uint256 agentId = registry.getAgentId(agentKey1);
        assertEq(registry.ownerOf(agentId), human1);

        // Burn via deregistration
        _deregisterViaHub(human1, nullifier1);
        vm.expectRevert();
        registry.ownerOf(agentId);
    }

    // ====================================================
    // Security Audit: sameHuman Liveness (C-3)
    // ====================================================

    function test_SameHuman_FalseAfterRevoke() public {
        vm.prank(owner);
        registry.setMaxAgentsPerHuman(0);

        _registerViaHub(human1, nullifier1);
        _registerViaHub(human1alt, nullifier1);

        uint256 id1 = registry.getAgentId(agentKey1);
        uint256 id1alt = registry.getAgentId(agentKey1alt);

        assertTrue(registry.sameHuman(id1, id1alt));

        // Revoke one agent
        _deregisterViaHub(human1, nullifier1);

        // Now sameHuman should return false
        assertFalse(registry.sameHuman(id1, id1alt));
    }

    function test_SameHuman_TrueWhenBothActive() public {
        vm.prank(owner);
        registry.setMaxAgentsPerHuman(0);

        _registerViaHub(human1, nullifier1);
        _registerViaHub(human1alt, nullifier1);

        uint256 id1 = registry.getAgentId(agentKey1);
        uint256 id1alt = registry.getAgentId(agentKey1alt);

        assertTrue(registry.sameHuman(id1, id1alt));
    }

    // ====================================================
    // Security Audit: Chain-Bound Signatures (H-3)
    // ====================================================

    function test_RevertWhen_AdvancedSignatureWrongChain() public {
        // Sign with a different chainId by manually constructing the wrong hash
        uint256 nonce = registry.agentNonces(advAgentAddr1);
        bytes32 wrongHash = keccak256(abi.encodePacked(
            "self-agent-id:register:",
            human1,
            uint256(999), // wrong chain ID
            address(registry),
            nonce
        ));
        bytes32 ethSigned = MessageHashUtils.toEthSignedMessageHash(wrongHash);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(advAgentPrivKey1, ethSigned);

        bytes memory encodedOutput = _buildEncodedOutput(human1, nullifier1);
        bytes memory userData = _buildAdvancedUserData(advAgentAddr1, v, r, s);

        vm.prank(hubMock);
        vm.expectRevert(SelfAgentRegistry.InvalidAgentSignature.selector);
        registry.onVerificationSuccess(encodedOutput, userData);
    }

    // ====================================================
    // Security Audit: Sybil Cap (H-2)
    // ====================================================

    function test_DefaultMaxAgentsPerHuman() public view {
        assertEq(registry.maxAgentsPerHuman(), 1);
    }

    function test_SetMaxAgentsPerHuman() public {
        vm.prank(owner);
        registry.setMaxAgentsPerHuman(5);
        assertEq(registry.maxAgentsPerHuman(), 5);
    }

    function test_RevertWhen_ExceedMaxAgents() public {
        // Default max is 1
        _registerViaHub(human1, nullifier1);

        // Second agent for same human should fail
        bytes memory encodedOutput = _buildEncodedOutput(human1alt, nullifier1);
        bytes memory userData = _buildUserData(0x52);

        vm.prank(hubMock);
        vm.expectRevert(abi.encodeWithSelector(SelfAgentRegistry.TooManyAgentsForHuman.selector, nullifier1, uint256(1)));
        registry.onVerificationSuccess(encodedOutput, userData);
    }

    function test_UnlimitedWhenZero() public {
        vm.prank(owner);
        registry.setMaxAgentsPerHuman(0);

        _registerViaHub(human1, nullifier1);
        _registerViaHub(human1alt, nullifier1);

        assertEq(registry.getAgentCountForHuman(nullifier1), 2);
    }

    function test_DeregisterAndReregister_WithCap() public {
        // Default max is 1
        _registerViaHub(human1, nullifier1);
        _deregisterViaHub(human1, nullifier1);

        // Re-register should work even with max=1 (deregister decrements count)
        _registerViaHub(human1, nullifier1);
        assertTrue(registry.isVerifiedAgent(agentKey1));
    }

    function test_RevertWhen_SetMaxAgentsPerHuman_NotOperationsRole() public {
        bytes32 opsRole = registry.OPERATIONS_ROLE();
        vm.prank(human1);
        vm.expectRevert(abi.encodeWithSelector(
            IAccessControl.AccessControlUnauthorizedAccount.selector,
            human1,
            opsRole
        ));
        registry.setMaxAgentsPerHuman(5);
    }

    // ====================================================
    // ERC-8004: agentURI storage + Registered event (Task 1)
    // ====================================================

    function test_registeredEventEmittedOnSimpleRegister() public {
        bytes memory encodedOutput = _buildEncodedOutput(human1, nullifier1);
        bytes memory userData = _buildUserData(0x52);

        // also verifies agentURI is empty string ""
        vm.expectEmit(true, true, false, true);
        emit IERC8004.Registered(1, "", human1);

        vm.prank(hubMock);
        registry.onVerificationSuccess(encodedOutput, userData);
    }

    function test_registeredEventEmittedOnAdvancedRegister() public {
        address agentAddr = vm.addr(advAgentPrivKey1);
        (uint8 v, bytes32 r, bytes32 s) = _signRegistration(advAgentPrivKey1, human1);
        bytes memory encodedOutput = _buildEncodedOutput(human1, nullifier1);
        bytes memory userData = _buildAdvancedUserData(agentAddr, v, r, s);

        // Advanced mode: NFT minted to humanAddress (human1), agentId = 1; also verifies agentURI is empty string ""
        vm.expectEmit(true, true, false, true);
        emit IERC8004.Registered(1, "", human1);

        vm.prank(hubMock);
        registry.onVerificationSuccess(encodedOutput, userData);
    }

    function test_registeredEventEmittedOnWalletFreeRegister() public {
        address agentAddr = vm.addr(advAgentPrivKey1);
        (uint8 v, bytes32 r, bytes32 s) = _signRegistration(advAgentPrivKey1, human1);
        bytes memory encodedOutput = _buildEncodedOutput(human1, nullifier1);
        bytes memory userData = _buildWalletFreeUserData(agentAddr, human1, v, r, s);

        // Wallet-free: NFT minted to agentAddr, agentId = 1; also verifies agentURI is empty string ""
        vm.expectEmit(true, true, false, true);
        emit IERC8004.Registered(1, "", agentAddr);

        vm.prank(hubMock);
        registry.onVerificationSuccess(encodedOutput, userData);
    }

    function test_registerWithHumanProofStoresURI() public {
        string memory uri = "ipfs://QmTestAgentRegistrationFile";
        bytes memory providerData = abi.encodePacked(agentKey1);

        mockProvider.setNextNullifier(nullifier1);
        vm.prank(human1);
        uint256 agentId = registry.registerWithHumanProof(uri, address(mockProvider), "", providerData);

        assertEq(registry.tokenURI(agentId), uri);
    }

    function test_registerWithHumanProofEmitsRegisteredEvent() public {
        string memory uri = "ipfs://QmTestAgentRegistrationFile";
        bytes memory providerData = abi.encodePacked(agentKey1);

        mockProvider.setNextNullifier(nullifier1);

        vm.expectEmit(true, true, false, true);
        emit IERC8004.Registered(1, uri, human1);

        vm.prank(human1);
        registry.registerWithHumanProof(uri, address(mockProvider), "", providerData);
    }

    function test_tokenURIRevertsForNonexistentToken() public {
        vm.expectRevert();
        registry.tokenURI(999);
    }

    function test_agentURIClearedOnRevoke() public {
        // Register with a URI via mock provider
        string memory uri = "ipfs://QmTestAgentRegistrationFile";
        bytes memory providerData = abi.encodePacked(agentKey1);

        mockProvider.setNextNullifier(nullifier1);
        vm.prank(human1);
        uint256 agentId = registry.registerWithHumanProof(uri, address(mockProvider), "", providerData);
        assertEq(registry.tokenURI(agentId), uri, "URI should be stored after registration");

        // Self-deregister burns the NFT and clears storage
        vm.prank(human1);
        registry.selfDeregister(agentId);

        // tokenURI should revert because the token no longer exists
        vm.expectRevert();
        registry.tokenURI(agentId);
    }

    function test_tokenURIEmptyAfterHubRegister() public {
        // Hub V2 path passes "" for URI — tokenURI should return ""
        _registerViaHub(human1, nullifier1);
        uint256 agentId = registry.getAgentId(agentKey1);
        assertEq(registry.tokenURI(agentId), "");
    }

    // ====================================================
    // V5: setAgentURI — Tests
    // ====================================================

    function test_setAgentURIUpdatesURI() public {
        // Register an agent via Hub then set URI as the NFT owner
        _registerViaHub(human1, nullifier1);
        uint256 agentId = registry.getAgentId(agentKey1);

        string memory newURI = "ipfs://QmNewAgentRegistrationFile";

        vm.prank(human1);
        registry.setAgentURI(agentId, newURI);

        assertEq(registry.tokenURI(agentId), newURI);
    }

    function test_setAgentURIEmitsURIUpdated() public {
        _registerViaHub(human1, nullifier1);
        uint256 agentId = registry.getAgentId(agentKey1);

        string memory newURI = "ipfs://QmURIUpdatedEvent";

        vm.expectEmit(true, false, true, true);
        emit IERC8004.URIUpdated(agentId, newURI, human1);

        vm.prank(human1);
        registry.setAgentURI(agentId, newURI);
    }

    function test_setAgentURIRevertsIfNotOwner() public {
        _registerViaHub(human1, nullifier1);
        uint256 agentId = registry.getAgentId(agentKey1);

        vm.prank(human2);
        vm.expectRevert(abi.encodeWithSelector(SelfAgentRegistry.NotNftOwner.selector, agentId));
        registry.setAgentURI(agentId, "ipfs://QmShouldNotUpdate");
    }

    function test_setAgentURICanClearURI() public {
        // Register with a URI via mock provider
        string memory initialURI = "ipfs://QmInitialAgentURI";
        bytes memory providerData = abi.encodePacked(agentKey1);
        mockProvider.setNextNullifier(nullifier1);

        vm.prank(human1);
        uint256 agentId = registry.registerWithHumanProof(initialURI, address(mockProvider), "", providerData);
        assertEq(registry.tokenURI(agentId), initialURI, "URI should be set after registration");

        // Clear the URI by setting it to empty string
        vm.prank(human1);
        registry.setAgentURI(agentId, "");

        assertEq(registry.tokenURI(agentId), "");
    }

    // ====================================================
    // Task 3: ERC-8004 register() overloads + requireHumanProof
    // ====================================================

    // --- Revert when requireHumanProof = true (default) ---

    function test_registerRevertsWhenProofRequired() public {
        // Default: requireHumanProof = true; bare register() should revert
        vm.prank(human1);
        vm.expectRevert(SelfAgentRegistry.ProofRequired.selector);
        registry.register();
    }

    function test_registerWithURIRevertsWhenProofRequired() public {
        vm.prank(human1);
        vm.expectRevert(SelfAgentRegistry.ProofRequired.selector);
        registry.register("ipfs://QmAgentURI");
    }

    function test_registerWithURIAndMetadataRevertsWhenProofRequired() public {
        SelfAgentRegistry.MetadataEntry[] memory meta = new SelfAgentRegistry.MetadataEntry[](1);
        meta[0] = SelfAgentRegistry.MetadataEntry({ metadataKey: "type", metadataValue: bytes("agent") });

        vm.prank(human1);
        vm.expectRevert(SelfAgentRegistry.ProofRequired.selector);
        registry.register("ipfs://QmAgentURI", meta);
    }

    // --- Work when requireHumanProof = false ---

    function test_registerWorksWhenProofNotRequired() public {
        vm.prank(owner);
        registry.setRequireHumanProof(false);

        vm.prank(human1);
        uint256 agentId = registry.register();

        // NFT minted to human1
        assertEq(registry.ownerOf(agentId), human1);
        // No human proof
        assertFalse(registry.hasHumanProof(agentId));
        // URI is empty
        assertEq(registry.tokenURI(agentId), "");
    }

    function test_registerWithURIWorksWhenProofNotRequired() public {
        vm.prank(owner);
        registry.setRequireHumanProof(false);

        string memory uri = "ipfs://QmBaseRegisterWithURI";
        vm.prank(human1);
        uint256 agentId = registry.register(uri);

        assertEq(registry.ownerOf(agentId), human1);
        assertEq(registry.tokenURI(agentId), uri);
        assertFalse(registry.hasHumanProof(agentId));
    }

    function test_registerWithURIAndMetadataWorksAndSetsMetadata() public {
        vm.prank(owner);
        registry.setRequireHumanProof(false);

        string memory uri = "ipfs://QmTest";
        SelfAgentRegistry.MetadataEntry[] memory meta = new SelfAgentRegistry.MetadataEntry[](1);
        meta[0] = SelfAgentRegistry.MetadataEntry({
            metadataKey: "type",
            metadataValue: bytes("text-agent")
        });

        vm.prank(human1);
        uint256 agentId = registry.register(uri, meta);

        assertEq(registry.ownerOf(agentId), human1);
        assertEq(registry.tokenURI(agentId), uri);
        // Task 4: assert the metadata was actually stored
        assertEq(registry.getMetadata(agentId, "type"), bytes("text-agent"));
    }

    // --- Admin ---

    function test_setRequireHumanProofUpdatesFlag() public {
        assertTrue(registry.requireHumanProof(), "Should be true by default");

        vm.prank(owner);
        registry.setRequireHumanProof(false);
        assertFalse(registry.requireHumanProof());

        vm.prank(owner);
        registry.setRequireHumanProof(true);
        assertTrue(registry.requireHumanProof());
    }

    function test_setRequireHumanProofRevertsIfNotOwner() public {
        vm.prank(human1);
        vm.expectRevert();
        registry.setRequireHumanProof(false);
    }

    // ====================================================
    // Task 4: Key-value metadata store + MetadataSet event
    // ====================================================

    function test_setAndGetMetadata() public {
        _registerViaHub(human1, nullifier1);
        uint256 agentId = registry.getAgentId(agentKey1);

        bytes memory value = bytes("gpt-4o");

        vm.prank(human1);
        registry.setMetadata(agentId, "model", value);

        assertEq(registry.getMetadata(agentId, "model"), value);
    }

    function test_setMetadataEmitsMetadataSet() public {
        _registerViaHub(human1, nullifier1);
        uint256 agentId = registry.getAgentId(agentKey1);

        bytes memory value = bytes("gpt-4o");

        vm.expectEmit(true, true, false, true);
        emit IERC8004.MetadataSet(agentId, "model", "model", value);

        vm.prank(human1);
        registry.setMetadata(agentId, "model", value);
    }

    function test_setMetadataRevertsForReservedAgentWalletKey() public {
        _registerViaHub(human1, nullifier1);
        uint256 agentId = registry.getAgentId(agentKey1);

        vm.prank(human1);
        vm.expectRevert(SelfAgentRegistry.ReservedMetadataKey.selector);
        registry.setMetadata(agentId, "agentWallet", bytes("0xdeadbeef"));
    }

    function test_setMetadataRevertsIfNotOwner() public {
        _registerViaHub(human1, nullifier1);
        uint256 agentId = registry.getAgentId(agentKey1);

        vm.prank(human2);
        vm.expectRevert(abi.encodeWithSelector(SelfAgentRegistry.NotNftOwner.selector, agentId));
        registry.setMetadata(agentId, "model", bytes("gpt-4o"));
    }

    function test_getMetadataReturnsEmptyForUnsetKey() public {
        _registerViaHub(human1, nullifier1);
        uint256 agentId = registry.getAgentId(agentKey1);

        bytes memory result = registry.getMetadata(agentId, "nonexistent-key");
        assertEq(result.length, 0);
    }

    function test_registerWithMetadataBatchNowStoresMetadata() public {
        vm.prank(owner);
        registry.setRequireHumanProof(false);

        string memory uri = "ipfs://QmBatchMetadataTest";
        SelfAgentRegistry.MetadataEntry[] memory meta = new SelfAgentRegistry.MetadataEntry[](2);
        meta[0] = SelfAgentRegistry.MetadataEntry({ metadataKey: "model", metadataValue: bytes("claude-3") });
        meta[1] = SelfAgentRegistry.MetadataEntry({ metadataKey: "version", metadataValue: bytes("1.0.0") });

        vm.prank(human1);
        uint256 agentId = registry.register(uri, meta);

        assertEq(registry.getMetadata(agentId, "model"), bytes("claude-3"));
        assertEq(registry.getMetadata(agentId, "version"), bytes("1.0.0"));
    }

    // ====================================================
    // Task 5: Agent Wallet (setAgentWallet / getAgentWallet / unsetAgentWallet)
    // ====================================================

    /// @dev Helper: build a valid EIP-712 signature for setAgentWallet.
    ///      The typehash and domain must match exactly what the contract uses.
    function _signAgentWalletSet(
        uint256 walletPrivKey,
        uint256 agentId,
        address ownerAddr,
        uint256 deadline
    ) internal view returns (bytes memory sig) {
        address walletAddr = vm.addr(walletPrivKey);
        uint256 nonce = registry.walletSetNonces(agentId);
        bytes32 structHash = keccak256(abi.encode(
            registry.AGENT_WALLET_SET_TYPEHASH(),
            agentId,
            walletAddr,
            ownerAddr,
            nonce,
            deadline
        ));
        bytes32 digest = keccak256(abi.encodePacked(
            "\x19\x01",
            registry.domainSeparator(),
            structHash
        ));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(walletPrivKey, digest);
        sig = abi.encodePacked(r, s, v);
    }

    function test_setAgentWalletStoresWallet() public {
        _registerViaHub(human1, nullifier1);
        uint256 agentId = registry.getAgentId(agentKey1);

        uint256 walletPrivKey = 0xB0B;
        address walletAddr = vm.addr(walletPrivKey);
        uint256 deadline = block.timestamp + 1 hours;

        bytes memory sig = _signAgentWalletSet(walletPrivKey, agentId, human1, deadline);

        vm.prank(human1);
        registry.setAgentWallet(agentId, walletAddr, deadline, sig);

        assertEq(registry.getAgentWallet(agentId), walletAddr);
    }

    function test_setAgentWalletEmitsMetadataSet() public {
        _registerViaHub(human1, nullifier1);
        uint256 agentId = registry.getAgentId(agentKey1);

        uint256 walletPrivKey = 0xB0B;
        address walletAddr = vm.addr(walletPrivKey);
        uint256 deadline = block.timestamp + 1 hours;

        bytes memory sig = _signAgentWalletSet(walletPrivKey, agentId, human1, deadline);

        vm.expectEmit(true, true, false, true);
        emit IERC8004.MetadataSet(agentId, "agentWallet", "agentWallet", abi.encode(walletAddr));

        vm.prank(human1);
        registry.setAgentWallet(agentId, walletAddr, deadline, sig);
    }

    function test_setAgentWalletRevertsOnExpiredDeadline() public {
        _registerViaHub(human1, nullifier1);
        uint256 agentId = registry.getAgentId(agentKey1);

        uint256 walletPrivKey = 0xB0B;
        address walletAddr = vm.addr(walletPrivKey);
        uint256 deadline = block.timestamp - 1; // already expired

        bytes memory sig = _signAgentWalletSet(walletPrivKey, agentId, human1, deadline);

        vm.prank(human1);
        vm.expectRevert(SelfAgentRegistry.DeadlineExpired.selector);
        registry.setAgentWallet(agentId, walletAddr, deadline, sig);
    }

    function test_setAgentWalletRevertsOnBadSignature() public {
        _registerViaHub(human1, nullifier1);
        uint256 agentId = registry.getAgentId(agentKey1);

        uint256 walletPrivKey = 0xB0B;
        address walletAddr = vm.addr(walletPrivKey);
        uint256 deadline = block.timestamp + 1 hours;

        // Sign with wrong private key (0xDEAD instead of 0xB0B)
        uint256 wrongPrivKey = 0xDEAD;
        bytes memory badSig = _signAgentWalletSet(wrongPrivKey, agentId, human1, deadline);

        vm.prank(human1);
        vm.expectRevert(SelfAgentRegistry.InvalidWalletSignature.selector);
        registry.setAgentWallet(agentId, walletAddr, deadline, badSig);
    }

    function test_setAgentWalletRevertsIfNotNFTOwner() public {
        _registerViaHub(human1, nullifier1);
        uint256 agentId = registry.getAgentId(agentKey1);

        uint256 walletPrivKey = 0xB0B;
        address walletAddr = vm.addr(walletPrivKey);
        uint256 deadline = block.timestamp + 1 hours;

        // Sign as if human2 is the owner (but human2 does not own the NFT)
        bytes memory sig = _signAgentWalletSet(walletPrivKey, agentId, human2, deadline);

        vm.prank(human2); // not the NFT owner
        vm.expectRevert(abi.encodeWithSelector(SelfAgentRegistry.NotNftOwner.selector, agentId));
        registry.setAgentWallet(agentId, walletAddr, deadline, sig);
    }

    function test_getAgentWalletReturnsZeroWhenUnset() public {
        _registerViaHub(human1, nullifier1);
        uint256 agentId = registry.getAgentId(agentKey1);

        assertEq(registry.getAgentWallet(agentId), address(0));
    }

    function test_unsetAgentWalletClearsWallet() public {
        _registerViaHub(human1, nullifier1);
        uint256 agentId = registry.getAgentId(agentKey1);

        // First set a wallet
        uint256 walletPrivKey = 0xB0B;
        address walletAddr = vm.addr(walletPrivKey);
        uint256 deadline = block.timestamp + 1 hours;
        bytes memory sig = _signAgentWalletSet(walletPrivKey, agentId, human1, deadline);

        vm.prank(human1);
        registry.setAgentWallet(agentId, walletAddr, deadline, sig);
        assertEq(registry.getAgentWallet(agentId), walletAddr);

        // Now unset it
        vm.prank(human1);
        registry.unsetAgentWallet(agentId);

        assertEq(registry.getAgentWallet(agentId), address(0));
    }

    function test_unsetAgentWalletEmitsMetadataSet() public {
        _registerViaHub(human1, nullifier1);
        uint256 agentId = registry.getAgentId(agentKey1);

        // First set a wallet
        uint256 walletPrivKey = 0xB0B;
        address walletAddr = vm.addr(walletPrivKey);
        uint256 deadline = block.timestamp + 1 hours;
        bytes memory sig = _signAgentWalletSet(walletPrivKey, agentId, human1, deadline);

        vm.prank(human1);
        registry.setAgentWallet(agentId, walletAddr, deadline, sig);

        // Expect MetadataSet event with empty data on unset
        vm.expectEmit(true, true, false, true);
        emit IERC8004.MetadataSet(agentId, "agentWallet", "agentWallet", bytes(""));

        vm.prank(human1);
        registry.unsetAgentWallet(agentId);
    }

    function test_unsetAgentWalletRevertsIfNotNFTOwner() public {
        _registerViaHub(human1, nullifier1);
        uint256 agentId = registry.getAgentId(agentKey1);

        vm.prank(address(0xBAD));
        vm.expectRevert(abi.encodeWithSelector(SelfAgentRegistry.NotNftOwner.selector, agentId));
        registry.unsetAgentWallet(agentId);
    }

    function test_cannotSetAgentWalletViaSetMetadata() public {
        _registerViaHub(human1, nullifier1);
        uint256 agentId = registry.getAgentId(agentKey1);

        vm.prank(human1);
        vm.expectRevert(SelfAgentRegistry.ReservedMetadataKey.selector);
        registry.setMetadata(agentId, "agentWallet", abi.encode(human2));
    }

    // ====================================================
    // ERC-165 supportsInterface
    // ====================================================

    function test_supportsERC165() public view {
        assertTrue(registry.supportsInterface(0x01ffc9a7)); // ERC-165 itself
    }

    function test_supportsERC721() public view {
        assertTrue(registry.supportsInterface(0x80ac58cd)); // ERC-721
    }

    function test_supportsERC8004() public view {
        bytes4 id = type(IERC8004).interfaceId;
        assertTrue(registry.supportsInterface(id));
    }

    function test_supportsERC8004ProofOfHuman() public view {
        bytes4 id = type(IERC8004ProofOfHuman).interfaceId;
        assertTrue(registry.supportsInterface(id));
    }

    function test_doesNotSupportRandomInterface() public view {
        assertFalse(registry.supportsInterface(0xdeadbeef));
    }

    // ====================================================
    // Task 7: proofExpiresAt + maxProofAge
    // ====================================================

    /// @dev Build encoded output with a custom document expiry date string (YYMMDD format).
    ///      Used by tests that need to exercise document-expiry capping logic.
    function _buildEncodedOutputWithDocExpiry(
        address humanAddr,
        uint256 nullifier,
        string memory docExpiryDate
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
                expiryDate: docExpiryDate,
                olderThan: 0,
                ofac: [false, false, false]
            });

        return abi.encode(output);
    }

    /// @dev Register via hub with a custom document expiry date string.
    function _registerViaHubWithDocExpiry(
        address humanAddr,
        uint256 nullifier,
        string memory docExpiryDate
    ) internal {
        bytes memory encodedOutput = _buildEncodedOutputWithDocExpiry(humanAddr, nullifier, docExpiryDate);
        bytes memory userData = _buildUserData(0x52); // 'R'
        vm.prank(hubMock);
        registry.onVerificationSuccess(encodedOutput, userData);
    }

    function test_proofExpiresAtSetOnRegistration() public {
        _registerViaHub(human1, nullifier1);
        uint256 expiry = registry.proofExpiresAt(registry.getAgentId(agentKey1));
        // Default expiryDate in test output is "300101" (2030-01-01), which is far in the future.
        // So proofExpiresAt should be capped by maxProofAge (365 days default).
        assertApproxEqAbs(expiry, block.timestamp + 365 days, 60);
    }

    function test_hasHumanProofStillTrueAfterExpiry() public {
        // hasHumanProof() does NOT check expiry — it only checks whether a proof was ever
        // submitted and the agent still exists. Use isProofFresh() for freshness checks.
        _registerViaHub(human1, nullifier1);
        uint256 agentId = registry.getAgentId(agentKey1);
        assertTrue(registry.hasHumanProof(agentId));
        vm.warp(block.timestamp + 366 days);
        // Still true after expiry — proof exists, just not fresh
        assertTrue(registry.hasHumanProof(agentId));
    }

    function test_isProofFreshReturnsFalseAfterExpiry() public {
        _registerViaHub(human1, nullifier1);
        uint256 agentId = registry.getAgentId(agentKey1);
        assertTrue(registry.isProofFresh(agentId));
        vm.warp(block.timestamp + 366 days);
        assertFalse(registry.isProofFresh(agentId));
    }

    function test_setMaxProofAgeUpdatesValue() public {
        vm.expectEmit(false, false, false, true);
        emit IERC8004ProofOfHuman.MaxProofAgeUpdated(180 days);
        vm.prank(owner);
        registry.setMaxProofAge(180 days);
        assertEq(registry.maxProofAge(), 180 days);
    }

    function test_setMaxProofAgeRevertsOnZero() public {
        vm.prank(owner);
        vm.expectRevert(SelfAgentRegistry.InvalidMaxProofAge.selector);
        registry.setMaxProofAge(0);
    }

    function test_proofExpiresAtCappedByDocumentExpiry() public {
        // Foundry's default block.timestamp is 1. Set it to a realistic value so
        // we can construct a doc expiry that lies BETWEEN now and now+maxProofAge.
        vm.warp(1_700_000_000); // ~Nov 2023 — a stable, known timestamp

        // Document expires 2024-06-01 ("240601") — within the 365-day maxProofAge window.
        // Exact unix timestamp for 2024-06-01 00:00:00 UTC = 1_717_200_000.
        // The formula: (2024-1970)*365 + (2024-1969)/4 + daysInMonths(2024,6) + 0
        //   = 54*365 + 55/4 + 152 = 19710 + 13 + 152 = 19875 days * 86400 = 1_717_200_000
        uint256 expectedDocExpiry = 1_717_200_000; // 2024-06-01 00:00:00 UTC
        uint256 ageExpiry = 1_700_000_000 + 365 days;

        // doc expiry < ageExpiry → proofExpiresAt should equal docExpiry
        assertTrue(expectedDocExpiry < ageExpiry, "precondition: doc expiry must be before age cap");

        _registerViaHubWithDocExpiry(human1, nullifier1, "240601");

        uint256 agentId = registry.getAgentId(agentKey1);
        uint256 actualExpiry = registry.proofExpiresAt(agentId);

        // Tightened to 1-hour tolerance: formula is exact for 2000-2049 range (2000 is div-by-400
        // leap year and 2100 is out of range), so no multi-day error is expected here.
        assertApproxEqAbs(actualExpiry, expectedDocExpiry, 1 hours);

        // Also confirm the expiry is strictly less than the age-based cap
        assertLt(actualExpiry, ageExpiry);
    }

    function test_refreshExpiredProof_DeregisterAndReRegister() public {
        // Full lifecycle: register → proof expires → isProofFresh false → deregister → re-register → fresh again
        _registerViaHub(human1, nullifier1);
        uint256 firstAgentId = registry.getAgentId(agentKey1);
        uint256 firstExpiry = registry.proofExpiresAt(firstAgentId);
        assertTrue(registry.isProofFresh(firstAgentId), "proof should be fresh right after registration");

        // Fast-forward past expiry
        vm.warp(firstExpiry + 1);
        assertFalse(registry.isProofFresh(firstAgentId), "proof should be stale after expiry");
        assertTrue(registry.hasHumanProof(firstAgentId), "hasHumanProof should still be true (historical)");

        // Attempting to re-register without deregistering should revert
        bytes memory encodedOutput = _buildEncodedOutput(human1, nullifier1);
        bytes memory userData = _buildUserData(0x52); // 'R'
        vm.prank(hubMock);
        vm.expectRevert(abi.encodeWithSelector(SelfAgentRegistry.AgentAlreadyRegistered.selector, agentKey1));
        registry.onVerificationSuccess(encodedOutput, userData);

        // Deregister the expired agent
        _deregisterViaHub(human1, nullifier1);
        assertEq(registry.getAgentId(agentKey1), 0, "agent key mapping should be cleared");
        assertEq(registry.proofExpiresAt(firstAgentId), 0, "expiry should be cleared on deregister");

        // Re-register with the same key — gets a new agentId and fresh proof
        _registerViaHub(human1, nullifier1);
        uint256 secondAgentId = registry.getAgentId(agentKey1);
        assertGt(secondAgentId, firstAgentId, "new agentId should be higher (monotonic)");
        assertTrue(registry.isProofFresh(secondAgentId), "re-registered proof should be fresh");
        assertApproxEqAbs(
            registry.proofExpiresAt(secondAgentId),
            block.timestamp + registry.maxProofAge(),
            60,
            "new expiry should be ~now + maxProofAge"
        );

        // Old agentId should be fully cleaned up
        assertFalse(registry.hasHumanProof(firstAgentId), "old agentId hasHumanProof should be false");
        assertFalse(registry.isProofFresh(firstAgentId), "old agentId isProofFresh should be false");
    }

    function test_refreshExpiredProof_ViaRevokeHumanProof() public {
        // Same lifecycle but using the synchronous registerWithHumanProof + revokeHumanProof path
        bytes32 syncKey = bytes32(uint256(0xbeef));
        bytes memory providerData = abi.encodePacked(syncKey);

        mockProvider.setShouldVerify(true);
        mockProvider.setNextNullifier(nullifier1);
        vm.prank(human1);
        uint256 firstId = registry.registerWithHumanProof("", address(mockProvider), "", providerData);
        assertTrue(registry.isProofFresh(firstId), "proof should be fresh after sync registration");

        // Fast-forward past expiry
        vm.warp(block.timestamp + registry.maxProofAge() + 1);
        assertFalse(registry.isProofFresh(firstId), "proof should be stale after maxProofAge");

        // Revoke and re-register
        vm.prank(human1);
        registry.revokeHumanProof(firstId, address(mockProvider), "", "");

        mockProvider.setShouldVerify(true);
        mockProvider.setNextNullifier(nullifier1);
        vm.prank(human1);
        uint256 secondId = registry.registerWithHumanProof("", address(mockProvider), "", providerData);
        assertGt(secondId, firstId, "new agentId should be higher");
        assertTrue(registry.isProofFresh(secondId), "refreshed proof should be fresh");
    }

    // ====================================================
    // Security Audit Fixes — SC-1: setAgentWallet nonce replay
    // ====================================================

    function test_setAgentWalletNonceIncrementsOnSet() public {
        _registerViaHub(human1, nullifier1);
        uint256 agentId = registry.getAgentId(agentKey1);

        assertEq(registry.walletSetNonces(agentId), 0, "nonce starts at 0");

        uint256 walletPrivKey = 0xB0B;
        address walletAddr = vm.addr(walletPrivKey);
        uint256 deadline = block.timestamp + 1 hours;
        bytes memory sig = _signAgentWalletSet(walletPrivKey, agentId, human1, deadline);

        vm.prank(human1);
        registry.setAgentWallet(agentId, walletAddr, deadline, sig);

        assertEq(registry.walletSetNonces(agentId), 1, "nonce should be 1 after first set");
    }

    function test_setAgentWalletReplayAfterUnsetReverts() public {
        _registerViaHub(human1, nullifier1);
        uint256 agentId = registry.getAgentId(agentKey1);

        uint256 walletPrivKey = 0xB0B;
        address walletAddr = vm.addr(walletPrivKey);
        uint256 deadline = block.timestamp + 1 hours;

        // Sign at nonce=0
        bytes memory sig = _signAgentWalletSet(walletPrivKey, agentId, human1, deadline);

        // Set wallet (consumes nonce 0)
        vm.prank(human1);
        registry.setAgentWallet(agentId, walletAddr, deadline, sig);

        // Unset wallet
        vm.prank(human1);
        registry.unsetAgentWallet(agentId);

        // Replay the same signature — should revert because nonce is now 1
        vm.prank(human1);
        vm.expectRevert(SelfAgentRegistry.InvalidWalletSignature.selector);
        registry.setAgentWallet(agentId, walletAddr, deadline, sig);
    }

    // ====================================================
    // Security Audit Fixes — SC-5/SC-6: Nullifier/provider cleanup on revocation
    // ====================================================

    function test_revokeAgentClearsNullifierAndProvider() public {
        _registerViaHub(human1, nullifier1);
        uint256 agentId = registry.getAgentId(agentKey1);

        // Before revocation: nullifier and provider are set
        assertEq(registry.agentNullifier(agentId), nullifier1);
        assertTrue(registry.agentProofProvider(agentId) != address(0));

        // Revoke
        vm.prank(human1);
        registry.selfDeregister(agentId);

        // After revocation: nullifier and provider should be cleared
        assertEq(registry.agentNullifier(agentId), 0, "nullifier should be cleared after revocation");
        assertEq(registry.agentProofProvider(agentId), address(0), "provider should be cleared after revocation");
    }

    // ====================================================
    // Security Audit Fixes — SC-12: ProofProviderRemoved event on setSelfProofProvider
    // ====================================================

    function test_setSelfProofProviderEmitsRemovedEventForOldProvider() public {
        address oldProvider = address(selfProvider);

        // Deploy a new mock provider
        SelfHumanProofProvider newProvider = new SelfHumanProofProvider(hubMock, registry.scope());

        vm.prank(owner);
        // Expect the old provider to be removed
        vm.expectEmit(true, false, false, false);
        emit IERC8004ProofOfHuman.ProofProviderRemoved(oldProvider);
        registry.setSelfProofProvider(address(newProvider));
    }

    // ====================================================
    // agentConfigId — Tracks verification config used at registration
    // ====================================================

    function test_AgentConfigId_StoredOnRegistration() public {
        _registerViaHub(human1, nullifier1);
        bytes32 configId = registry.agentConfigId(1);
        assertEq(configId, fakeConfigId);
    }

    function test_AgentConfigId_ZeroForExternalProvider() public {
        vm.prank(owner);
        registry.setRequireHumanProof(false);
        vm.prank(human1);
        uint256 agentId = registry.registerWithHumanProof(
            "",
            address(mockProvider),
            abi.encode(true, nullifier1),
            abi.encodePacked(bytes32(uint256(uint160(human1))))
        );
        assertEq(registry.agentConfigId(agentId), bytes32(0));
    }

    function test_AgentConfigId_ClearedOnRevocation() public {
        _registerViaHub(human1, nullifier1);
        assertEq(registry.agentConfigId(1), fakeConfigId);
        _deregisterViaHub(human1, nullifier1);
        assertEq(registry.agentConfigId(1), bytes32(0));
    }

    // ====================================================
    // Proof Refresh (ACTION_REFRESH = 0x46)
    // ====================================================

    function test_RefreshHumanProof_UpdatesExpiry() public {
        _registerViaHub(human1, nullifier1);
        vm.warp(block.timestamp + 180 days);

        bytes memory refreshUserData = abi.encodePacked(uint8(0x46), uint8(0), uint256(1));
        bytes memory output = _buildEncodedOutput(human1, nullifier1);
        vm.prank(hubMock);
        registry.onVerificationSuccess(output, refreshUserData);

        uint256 newExpiry = registry.proofExpiresAt(1);
        assertGt(newExpiry, block.timestamp + 300 days);
        assertTrue(registry.isProofFresh(1));
    }

    function test_RefreshHumanProof_EmitsEvent() public {
        _registerViaHub(human1, nullifier1);
        vm.warp(block.timestamp + 180 days);

        bytes memory refreshUserData = abi.encodePacked(uint8(0x46), uint8(0), uint256(1));
        bytes memory output = _buildEncodedOutput(human1, nullifier1);

        vm.expectEmit(true, false, false, false);
        emit IERC8004ProofOfHuman.HumanProofRefreshed(1, 0, 0, bytes32(0));
        vm.prank(hubMock);
        registry.onVerificationSuccess(output, refreshUserData);
    }

    function test_RefreshHumanProof_PreservesAgentId() public {
        _registerViaHub(human1, nullifier1);
        uint256 originalId = registry.getAgentId(_agentKeyFor(human1));

        vm.warp(block.timestamp + 180 days);
        bytes memory refreshUserData = abi.encodePacked(uint8(0x46), uint8(0), uint256(1));
        bytes memory output = _buildEncodedOutput(human1, nullifier1);
        vm.prank(hubMock);
        registry.onVerificationSuccess(output, refreshUserData);

        assertEq(registry.getAgentId(_agentKeyFor(human1)), originalId);
        assertEq(registry.ownerOf(originalId), human1);
    }

    function test_RefreshHumanProof_DoesNotChangeAgentCount() public {
        _registerViaHub(human1, nullifier1);
        uint256 countBefore = registry.getAgentCountForHuman(nullifier1);

        vm.warp(block.timestamp + 180 days);
        bytes memory refreshUserData = abi.encodePacked(uint8(0x46), uint8(0), uint256(1));
        bytes memory output = _buildEncodedOutput(human1, nullifier1);
        vm.prank(hubMock);
        registry.onVerificationSuccess(output, refreshUserData);

        assertEq(registry.getAgentCountForHuman(nullifier1), countBefore);
    }

    function test_RefreshHumanProof_WorksAfterExpiry() public {
        _registerViaHub(human1, nullifier1);
        vm.warp(block.timestamp + 400 days);
        assertFalse(registry.isProofFresh(1));

        bytes memory refreshUserData = abi.encodePacked(uint8(0x46), uint8(0), uint256(1));
        bytes memory output = _buildEncodedOutput(human1, nullifier1);
        vm.prank(hubMock);
        registry.onVerificationSuccess(output, refreshUserData);

        assertTrue(registry.isProofFresh(1));
    }

    function test_RefreshHumanProof_MultipleRefreshes() public {
        _registerViaHub(human1, nullifier1);

        vm.warp(block.timestamp + 180 days);
        bytes memory refreshUserData = abi.encodePacked(uint8(0x46), uint8(0), uint256(1));
        bytes memory output = _buildEncodedOutput(human1, nullifier1);
        vm.prank(hubMock);
        registry.onVerificationSuccess(output, refreshUserData);
        uint256 firstExpiry = registry.proofExpiresAt(1);

        vm.warp(block.timestamp + 180 days);
        vm.prank(hubMock);
        registry.onVerificationSuccess(output, refreshUserData);
        uint256 secondExpiry = registry.proofExpiresAt(1);

        assertGt(secondExpiry, firstExpiry);
    }

    function test_RevertWhen_RefreshWithWrongNullifier() public {
        _registerViaHub(human1, nullifier1);

        bytes memory refreshUserData = abi.encodePacked(uint8(0x46), uint8(0), uint256(1));
        bytes memory output = _buildEncodedOutput(human2, nullifier2);
        vm.prank(hubMock);
        vm.expectRevert(abi.encodeWithSelector(
            SelfAgentRegistry.NotAgentOwner.selector, nullifier1, nullifier2
        ));
        registry.onVerificationSuccess(output, refreshUserData);
    }

    function test_RevertWhen_RefreshRevokedAgent() public {
        _registerViaHub(human1, nullifier1);
        _deregisterViaHub(human1, nullifier1);

        bytes memory refreshUserData = abi.encodePacked(uint8(0x46), uint8(0), uint256(1));
        bytes memory output = _buildEncodedOutput(human1, nullifier1);
        vm.prank(hubMock);
        vm.expectRevert(abi.encodeWithSelector(
            SelfAgentRegistry.AgentHasNoHumanProof.selector, 1
        ));
        registry.onVerificationSuccess(output, refreshUserData);
    }

    function test_RevertWhen_RefreshNotSupported_ExternalProvider() public {
        vm.prank(owner);
        registry.setRequireHumanProof(false);
        vm.prank(human1);
        uint256 agentId = registry.registerWithHumanProof(
            "",
            address(mockProvider),
            abi.encode(true, nullifier1),
            abi.encodePacked(bytes32(uint256(uint160(human1))))
        );

        bytes memory refreshUserData = abi.encodePacked(uint8(0x46), uint8(0), agentId);
        bytes memory output = _buildEncodedOutput(human1, nullifier1);
        vm.prank(hubMock);
        vm.expectRevert(abi.encodeWithSelector(
            IERC8004ProofOfHuman.RefreshNotSupported.selector, agentId
        ));
        registry.onVerificationSuccess(output, refreshUserData);
    }

    function test_RevertWhen_RefreshWithConfigMismatch() public {
        _registerViaHub(human1, nullifier1);
        assertEq(registry.agentConfigId(1), fakeConfigId);

        // Use vm.record + vm.accesses to find the storage slot for agentConfigId[1]
        vm.record();
        registry.agentConfigId(1);
        (bytes32[] memory reads, ) = vm.accesses(address(registry));
        // Find the slot that currently holds fakeConfigId
        bytes32 configSlot;
        bool found = false;
        for (uint256 i = 0; i < reads.length; i++) {
            if (vm.load(address(registry), reads[i]) == fakeConfigId) {
                configSlot = reads[i];
                found = true;
                break;
            }
        }
        assertTrue(found, "Could not find configId storage slot");

        // Overwrite stored configId with a different value to simulate mismatch
        bytes32 differentConfig = bytes32(uint256(0xDEAD));
        vm.store(address(registry), configSlot, differentConfig);
        assertEq(registry.agentConfigId(1), differentConfig);

        // Refresh should revert: stored=differentConfig vs hub-resolved=fakeConfigId
        bytes memory refreshUserData = abi.encodePacked(uint8(0x46), uint8(0), uint256(1));
        bytes memory output2 = _buildEncodedOutput(human1, nullifier1);
        vm.prank(hubMock);
        vm.expectRevert(abi.encodeWithSelector(
            IERC8004ProofOfHuman.ConfigMismatch.selector, differentConfig, fakeConfigId
        ));
        registry.onVerificationSuccess(output2, refreshUserData);
    }

    function test_RevertWhen_RefreshWithShortUserData() public {
        _registerViaHub(human1, nullifier1);

        // Only 2 bytes (action + config), missing the agentId
        bytes memory shortUserData = abi.encodePacked(uint8(0x46), uint8(0));
        bytes memory output = _buildEncodedOutput(human1, nullifier1);
        vm.prank(hubMock);
        vm.expectRevert(SelfAgentRegistry.InvalidUserData.selector);
        registry.onVerificationSuccess(output, shortUserData);
    }

    // ====================================================
    // ACTION_IDENTIFY — Read-only nullifier identification
    // ====================================================

    function test_Identify_EmitsNullifierIdentified() public {
        // Register an agent first so there's something to find
        _registerViaHub(human1, nullifier1);

        bytes memory identifyData = abi.encodePacked(uint8(0x49), uint8(0));
        bytes memory output = _buildEncodedOutput(human1, nullifier1);

        vm.expectEmit(true, false, false, true, address(registry));
        emit IERC8004ProofOfHuman.NullifierIdentified(nullifier1, 1);

        vm.prank(hubMock);
        registry.onVerificationSuccess(output, identifyData);
    }

    function test_Identify_NoStateChanges() public {
        _registerViaHub(human1, nullifier1);
        uint256 agentId = registry.getAgentId(agentKey1);
        uint256 countBefore = registry.getAgentCountForHuman(nullifier1);
        uint256 expiryBefore = registry.proofExpiresAt(agentId);

        bytes memory identifyData = abi.encodePacked(uint8(0x49), uint8(0));
        bytes memory output = _buildEncodedOutput(human1, nullifier1);
        vm.prank(hubMock);
        registry.onVerificationSuccess(output, identifyData);

        // Nothing changed
        assertEq(registry.getAgentCountForHuman(nullifier1), countBefore);
        assertEq(registry.proofExpiresAt(agentId), expiryBefore);
        assertTrue(registry.isVerifiedAgent(agentKey1));
    }

    function test_Identify_ZeroAgentsEmitsZeroCount() public {
        // Identify with a nullifier that has no agents registered
        bytes memory identifyData = abi.encodePacked(uint8(0x49), uint8(0));
        bytes memory output = _buildEncodedOutput(human1, nullifier1);

        vm.expectEmit(true, false, false, true, address(registry));
        emit IERC8004ProofOfHuman.NullifierIdentified(nullifier1, 0);

        vm.prank(hubMock);
        registry.onVerificationSuccess(output, identifyData);
    }

    function test_Identify_MultipleAgentsReportsCorrectCount() public {
        _registerViaHub(human1, nullifier1);

        // Register a second agent for the same human (different wallet)
        vm.prank(owner);
        registry.setMaxAgentsPerHuman(3);
        _registerViaHub(human1alt, nullifier1);

        bytes memory identifyData = abi.encodePacked(uint8(0x49), uint8(0));
        bytes memory output = _buildEncodedOutput(human1, nullifier1);

        vm.expectEmit(true, false, false, true, address(registry));
        emit IERC8004ProofOfHuman.NullifierIdentified(nullifier1, 2);

        vm.prank(hubMock);
        registry.onVerificationSuccess(output, identifyData);
    }
}
