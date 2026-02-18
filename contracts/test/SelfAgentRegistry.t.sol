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
        return abi.encodePacked(action);
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
        assertEq(registry.verificationConfigId(), fakeConfigId);
    }

    function test_GetConfigId_ReturnsStoredId() public view {
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
        bytes memory userData = abi.encodePacked("R");
        vm.prank(hubMock);
        registry.onVerificationSuccess(encodedOutput, userData);
    }

    function _deregisterViaHubString(address humanAddr, uint256 nullifier) internal {
        bytes memory encodedOutput = _buildEncodedOutput(humanAddr, nullifier);
        bytes memory userData = abi.encodePacked("D");
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
        return abi.encodePacked(action, agentAddr, r, s, v);
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
        bytes memory userData = abi.encodePacked(uint8(0x04), agentAddr);
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

        bytes memory userData = abi.encodePacked("K", addrHex, rHex, sHex, vHex);
        assertEq(userData.length, 171, "String-encoded advanced userData should be 171 bytes");

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
        // Only 10 bytes — too short for binary advanced (needs 86)
        bytes memory userData = abi.encodePacked(uint8(0x03), bytes9(0));

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
}
