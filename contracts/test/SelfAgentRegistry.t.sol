// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import { Test } from "forge-std/Test.sol";
import { SelfAgentRegistry } from "../src/SelfAgentRegistry.sol";
import { SelfHumanProofProvider } from "../src/SelfHumanProofProvider.sol";
import { MockHumanProofProvider } from "./mocks/MockHumanProofProvider.sol";
import { ISelfVerificationRoot } from "@selfxyz/contracts/contracts/interfaces/ISelfVerificationRoot.sol";
import { IIdentityVerificationHubV2 } from "@selfxyz/contracts/contracts/interfaces/IIdentityVerificationHubV2.sol";
import { IERC8004ProofOfHuman } from "../src/interfaces/IERC8004ProofOfHuman.sol";
import { MessageHashUtils } from "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";

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
        // This is called in the SelfAgentRegistry constructor
        vm.mockCall(
            hubMock,
            abi.encodeWithSelector(IIdentityVerificationHubV2.setVerificationConfigV2.selector),
            abi.encode(fakeConfigId)
        );

        registry = new SelfAgentRegistry(hubMock, owner);
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
        bytes memory userData = _buildUserData(0x01);
        vm.prank(hubMock);
        registry.onVerificationSuccess(encodedOutput, userData);
    }

    function _deregisterViaHub(address humanAddr, uint256 nullifier) internal {
        bytes memory encodedOutput = _buildEncodedOutput(humanAddr, nullifier);
        bytes memory userData = _buildUserData(0x02);
        vm.prank(hubMock);
        registry.onVerificationSuccess(encodedOutput, userData);
    }

    function _agentKeyFor(address humanAddr) internal pure returns (bytes32) {
        return bytes32(uint256(uint160(humanAddr)));
    }

    // ====================================================
    // Constructor
    // ====================================================

    function test_Constructor() public view {
        assertEq(registry.name(), "Self Agent ID");
        assertEq(registry.symbol(), "SAID");
        assertEq(registry.owner(), owner);
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
        bytes memory userData = _buildUserData(0x01);

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
        bytes memory userData = _buildUserData(0x01);

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
        bytes memory userData = _buildUserData(0x01);

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
        bytes memory userData = _buildUserData(0x02);

        vm.expectEmit(true, false, false, true);
        emit IERC8004ProofOfHuman.HumanProofRevoked(1, nullifier1);

        vm.prank(hubMock);
        registry.onVerificationSuccess(encodedOutput, userData);
    }

    function test_DeregisterAgent_DecrementsCount() public {
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
        bytes memory userData = _buildUserData(0x02);

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
        bytes memory userData = _buildUserData(0x02);

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
        bytes memory userData = _buildUserData(0x02);

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
        vm.expectRevert("Human proof verification failed");
        registry.registerWithHumanProof("", address(mockProvider), "", providerData);
    }

    function test_RevertWhen_SyncRegister_ProviderDataTooShort() public {
        mockProvider.setNextNullifier(nullifier1);

        vm.prank(human1);
        vm.expectRevert("Provider data must contain agent public key");
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
        vm.expectRevert("Not the same human");
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

    function test_RevertWhen_AddProvider_NotOwner() public {
        vm.prank(human1);
        vm.expectRevert();
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
    // ERC-721 Basics
    // ====================================================

    function test_TokenName() public view {
        assertEq(registry.name(), "Self Agent ID");
    }

    function test_TokenSymbol() public view {
        assertEq(registry.symbol(), "SAID");
    }

    function test_BalanceAfterRegister() public {
        _registerViaHub(human1, nullifier1);
        assertEq(registry.balanceOf(human1), 1);

        // Same human, second wallet
        _registerViaHub(human1alt, nullifier1);
        assertEq(registry.balanceOf(human1alt), 1);
    }

    function test_BalanceAfterDeregister() public {
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

        bytes32 agentPubKey = _agentKeyFor(humanAddr);
        uint256 agentId = registry.getAgentId(agentPubKey);
        assertTrue(agentId != 0);
        assertTrue(registry.isVerifiedAgent(agentPubKey));
        assertEq(registry.ownerOf(agentId), humanAddr);
        assertEq(registry.getHumanNullifier(agentId), nullifier);
    }

    function testFuzz_RegisterAndDeregister(uint256 nullifier, address humanAddr) public {
        vm.assume(humanAddr != address(0));
        vm.assume(nullifier != 0);

        _registerViaHub(humanAddr, nullifier);
        bytes32 agentPubKey = _agentKeyFor(humanAddr);
        uint256 agentId = registry.getAgentId(agentPubKey);
        assertTrue(registry.isVerifiedAgent(agentPubKey));

        _deregisterViaHub(humanAddr, nullifier);
        assertFalse(registry.isVerifiedAgent(agentPubKey));
        assertFalse(registry.hasHumanProof(agentId));
    }

    // ====================================================
    // Advanced Mode — Helpers
    // ====================================================

    function _signRegistration(
        uint256 privKey,
        address humanAddr
    ) internal pure returns (uint8 v, bytes32 r, bytes32 s) {
        bytes32 messageHash = keccak256(abi.encodePacked("self-agent-id:register:", humanAddr));
        bytes32 ethSignedHash = MessageHashUtils.toEthSignedMessageHash(messageHash);
        (v, r, s) = vm.sign(privKey, ethSignedHash);
    }

    function _buildAdvancedUserData(
        uint8 action,
        address agentAddr,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) internal pure returns (bytes memory) {
        return abi.encodePacked(action, uint8(0), agentAddr, r, s, v);
    }

    function _registerViaHubAdvanced(address humanAddr, uint256 nullifier, uint256 agentPrivKey) internal {
        address agentAddr = vm.addr(agentPrivKey);
        (uint8 v, bytes32 r, bytes32 s) = _signRegistration(agentPrivKey, humanAddr);
        bytes memory encodedOutput = _buildEncodedOutput(humanAddr, nullifier);
        bytes memory userData = _buildAdvancedUserData(0x03, agentAddr, v, r, s);
        vm.prank(hubMock);
        registry.onVerificationSuccess(encodedOutput, userData);
    }

    function _deregisterViaHubAdvanced(address humanAddr, uint256 nullifier, address agentAddr) internal {
        bytes memory encodedOutput = _buildEncodedOutput(humanAddr, nullifier);
        bytes memory userData = abi.encodePacked(uint8(0x04), uint8(0), agentAddr);
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

    function test_RevertWhen_AdvancedWrongSignature() public {
        // Agent 2 signs, but we claim it's agent 1
        (uint8 v, bytes32 r, bytes32 s) = _signRegistration(advAgentPrivKey2, human1);
        bytes memory encodedOutput = _buildEncodedOutput(human1, nullifier1);
        bytes memory userData = _buildAdvancedUserData(0x03, advAgentAddr1, v, r, s);

        vm.prank(hubMock);
        vm.expectRevert(SelfAgentRegistry.InvalidAgentSignature.selector);
        registry.onVerificationSuccess(encodedOutput, userData);
    }

    function test_RevertWhen_AdvancedSignatureForWrongHuman() public {
        // Agent signs for human1, but proof is for human2
        (uint8 v, bytes32 r, bytes32 s) = _signRegistration(advAgentPrivKey1, human1);
        bytes memory encodedOutput = _buildEncodedOutput(human2, nullifier2);
        bytes memory userData = _buildAdvancedUserData(0x03, advAgentAddr1, v, r, s);

        vm.prank(hubMock);
        vm.expectRevert(SelfAgentRegistry.InvalidAgentSignature.selector);
        registry.onVerificationSuccess(encodedOutput, userData);
    }

    function test_RevertWhen_AdvancedUserDataTooShort() public {
        bytes memory encodedOutput = _buildEncodedOutput(human1, nullifier1);
        // Only 11 bytes — too short for binary advanced (needs 87)
        bytes memory userData = abi.encodePacked(uint8(0x03), uint8(0), bytes9(0));

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
        uint8 action,
        address agentAddr,
        address guardian,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) internal pure returns (bytes memory) {
        return abi.encodePacked(action, uint8(0), agentAddr, guardian, r, s, v);
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
        bytes memory userData = _buildWalletFreeUserData(0x05, agentAddr, guardian, v, r, s);
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
        bytes memory userData = _buildWalletFreeUserData(0x05, agentAddr, human1, v, r, s);

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
        bytes memory userData = abi.encodePacked(uint8(0x05), uint8(0), bytes20(0));

        vm.prank(hubMock);
        vm.expectRevert(SelfAgentRegistry.InvalidUserData.selector);
        registry.onVerificationSuccess(encodedOutput, userData);
    }

    function test_RevertWhen_WalletFreeWrongSignature() public {
        // Agent 2 signs, but we claim it's agent 1
        (uint8 v, bytes32 r, bytes32 s) = _signRegistration(advAgentPrivKey2, human1);
        bytes memory encodedOutput = _buildEncodedOutput(human1, nullifier1);
        bytes memory userData = _buildWalletFreeUserData(0x05, advAgentAddr1, human1, v, r, s);

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

        bytes32 agentPubKey = bytes32(uint256(uint160(agentAddr)));
        uint256 agentId = registry.getAgentId(agentPubKey);
        assertTrue(agentId != 0);
        assertTrue(registry.isVerifiedAgent(agentPubKey));
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
        bytes memory userData = _buildUserData(0x01);

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

    function test_MultiConfig_DefaultOnInvalidDigit() public view {
        bytes32 result = registry.getConfigId(0, 0, bytes("R9"));
        assertEq(result, registry.configIds(0));
    }

    function test_MultiConfig_BinaryConfigByte() public view {
        // Binary: action 0x01, config 0x04
        bytes memory data = abi.encodePacked(uint8(0x01), uint8(0x04));
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

    function test_MultiConfig_ASCII6DefaultsToConfig0() public view {
        // '6' = 0x36 is out of range — should default to config 0
        bytes32 result = registry.getConfigId(0, 0, bytes("R6"));
        assertEq(result, registry.configIds(0), "ASCII '6' should default to config 0");
    }

    function test_MultiConfig_Binary6DefaultsToConfig0() public view {
        // Binary 0x06 is out of range — should default to config 0
        bytes memory data = abi.encodePacked(uint8(0x01), uint8(0x06));
        bytes32 result = registry.getConfigId(0, 0, data);
        assertEq(result, registry.configIds(0), "Binary 0x06 should default to config 0");
    }

    function test_MultiConfig_HighByteDefaultsToConfig0() public view {
        // 0xFF is out of both ASCII and binary range — should default to config 0
        bytes memory data = abi.encodePacked(uint8(0x01), uint8(0xFF));
        bytes32 result = registry.getConfigId(0, 0, data);
        assertEq(result, registry.configIds(0), "0xFF should default to config 0");
    }

    function test_MultiConfig_BinaryAllConfigs() public view {
        // Verify all 6 binary config bytes (0x00-0x05) map correctly
        for (uint8 i = 0; i <= 5; i++) {
            bytes memory data = abi.encodePacked(uint8(0x01), i);
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

    function test_MultiConfig_BinaryDeregisterAdvancedWithConfig() public {
        // Register advanced, then deregister with binary 0x04 + config byte
        (uint8 v, bytes32 r, bytes32 s) = _signRegistration(advAgentPrivKey1, human1);
        bytes memory regData = abi.encodePacked(uint8(0x03), uint8(0x00), advAgentAddr1, r, s, v);
        assertEq(regData.length, 87);

        bytes memory encodedOutput = _buildEncodedOutput(human1, nullifier1);
        vm.prank(hubMock);
        registry.onVerificationSuccess(encodedOutput, regData);
        assertTrue(registry.isVerifiedAgent(advAgentKey1));

        // Deregister: 0x04 + config(1B) + address(20B) = 22 bytes
        bytes memory deregData = abi.encodePacked(uint8(0x04), uint8(0x00), advAgentAddr1);
        assertEq(deregData.length, 22);

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

    function test_MultiConfig_BinaryRegisterTooShort() public {
        // Binary advanced with only 86 bytes (missing 1 byte) should revert
        bytes memory encodedOutput = _buildEncodedOutput(human1, nullifier1);
        bytes memory tooShort = new bytes(86);
        tooShort[0] = bytes1(uint8(0x03));
        tooShort[1] = bytes1(uint8(0x00));
        vm.prank(hubMock);
        vm.expectRevert(SelfAgentRegistry.InvalidUserData.selector);
        registry.onVerificationSuccess(encodedOutput, tooShort);
    }

    function test_MultiConfig_BinaryWalletFreeTooShort() public {
        // Binary wallet-free with only 106 bytes (missing 1 byte) should revert
        bytes memory encodedOutput = _buildEncodedOutput(human1, nullifier1);
        bytes memory tooShort = new bytes(106);
        tooShort[0] = bytes1(uint8(0x05));
        tooShort[1] = bytes1(uint8(0x00));
        vm.prank(hubMock);
        vm.expectRevert(SelfAgentRegistry.InvalidUserData.selector);
        registry.onVerificationSuccess(encodedOutput, tooShort);
    }

    function test_MultiConfig_BinaryDeregAdvancedTooShort() public {
        // Binary advanced deregister with only 21 bytes (missing 1 byte) should revert
        bytes memory encodedOutput = _buildEncodedOutput(human1, nullifier1);
        bytes memory tooShort = new bytes(21);
        tooShort[0] = bytes1(uint8(0x04));
        tooShort[1] = bytes1(uint8(0x00));
        vm.prank(hubMock);
        vm.expectRevert(SelfAgentRegistry.InvalidUserData.selector);
        registry.onVerificationSuccess(encodedOutput, tooShort);
    }

    function test_MultiConfig_GapBetweenBinaryAndASCII() public view {
        // Bytes 0x06-0x2F fall between binary (0-5) and ASCII ('0'=0x30)
        // All should default to config 0
        bytes memory data06 = abi.encodePacked(uint8(0x01), uint8(0x06));
        assertEq(registry.getConfigId(0, 0, data06), registry.configIds(0));

        bytes memory data10 = abi.encodePacked(uint8(0x01), uint8(0x10));
        assertEq(registry.getConfigId(0, 0, data10), registry.configIds(0));

        bytes memory data2F = abi.encodePacked(uint8(0x01), uint8(0x2F));
        assertEq(registry.getConfigId(0, 0, data2F), registry.configIds(0));
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
}
