// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import { Test } from "forge-std/Test.sol";
import { SelfAgentRegistry } from "../src/SelfAgentRegistry.sol";
import { SelfReputationRegistry } from "../src/SelfReputationRegistry.sol";
import { SelfValidationRegistry } from "../src/SelfValidationRegistry.sol";
import { SelfHumanProofProvider } from "../src/SelfHumanProofProvider.sol";
import { ProxyRoot } from "../src/upgradeable/ProxyRoot.sol";
import { ISelfVerificationRoot } from "@selfxyz/contracts/contracts/interfaces/ISelfVerificationRoot.sol";
import { IIdentityVerificationHubV2 } from "@selfxyz/contracts/contracts/interfaces/IIdentityVerificationHubV2.sol";
import { IAccessControl } from "@openzeppelin/contracts/access/IAccessControl.sol";
import { Initializable } from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";

contract UpgradesTest is Test {
    SelfAgentRegistry registry;
    SelfAgentRegistry registryImpl;
    SelfReputationRegistry rep;
    SelfValidationRegistry val;
    SelfHumanProofProvider selfProvider;

    address owner = makeAddr("owner");
    address hubMock = makeAddr("hub");
    address nonAdmin = makeAddr("nonAdmin");

    bytes32 fakeConfigId = bytes32(uint256(0xc0de));

    function setUp() public {
        vm.mockCall(
            hubMock,
            abi.encodeWithSelector(IIdentityVerificationHubV2.setVerificationConfigV2.selector),
            abi.encode(fakeConfigId)
        );

        // Deploy SelfAgentRegistry behind proxy
        registryImpl = new SelfAgentRegistry();
        registry = SelfAgentRegistry(address(new ProxyRoot(
            address(registryImpl),
            abi.encodeCall(SelfAgentRegistry.initialize, (hubMock, owner))
        )));

        selfProvider = new SelfHumanProofProvider(hubMock, registry.scope());
        vm.prank(owner);
        registry.setSelfProofProvider(address(selfProvider));

        // Deploy SelfReputationRegistry behind proxy
        SelfReputationRegistry repImpl = new SelfReputationRegistry();
        rep = SelfReputationRegistry(address(new ProxyRoot(
            address(repImpl),
            abi.encodeCall(SelfReputationRegistry.initialize, (address(registry), owner))
        )));

        // Deploy SelfValidationRegistry behind proxy
        SelfValidationRegistry valImpl = new SelfValidationRegistry();
        val = SelfValidationRegistry(address(new ProxyRoot(
            address(valImpl),
            abi.encodeCall(SelfValidationRegistry.initialize, (address(registry), owner))
        )));
    }

    // ====================================================
    // Implementation cannot be initialized directly
    // ====================================================

    function test_RevertWhen_InitializeImplementation() public {
        vm.expectRevert(Initializable.InvalidInitialization.selector);
        registryImpl.initialize(hubMock, owner);
    }

    // ====================================================
    // Proxy cannot be initialized twice
    // ====================================================

    function test_RevertWhen_ReinitializeProxy() public {
        vm.expectRevert(Initializable.InvalidInitialization.selector);
        registry.initialize(hubMock, owner);
    }

    function test_RevertWhen_ReinitializeRepProxy() public {
        vm.expectRevert(Initializable.InvalidInitialization.selector);
        rep.initialize(address(registry), owner);
    }

    function test_RevertWhen_ReinitializeValProxy() public {
        vm.expectRevert(Initializable.InvalidInitialization.selector);
        val.initialize(address(registry), owner);
    }

    // ====================================================
    // Upgrade works with SECURITY_ROLE
    // ====================================================

    function test_UpgradeWithSecurityRole() public {
        SelfAgentRegistry newImpl = new SelfAgentRegistry();

        vm.prank(owner);
        registry.upgradeToAndCall(address(newImpl), "");

        // Verify state is preserved after upgrade
        assertEq(registry.name(), "Self Agent ID");
        assertEq(registry.symbol(), "SAID");
        assertEq(registry.configIds(0), fakeConfigId);
        assertTrue(registry.hasRole(registry.SECURITY_ROLE(), owner));
    }

    // ====================================================
    // Upgrade reverts without SECURITY_ROLE
    // ====================================================

    function test_RevertWhen_UpgradeWithoutSecurityRole() public {
        SelfAgentRegistry newImpl = new SelfAgentRegistry();
        bytes32 secRole = registry.SECURITY_ROLE();

        vm.prank(nonAdmin);
        vm.expectRevert(abi.encodeWithSelector(
            IAccessControl.AccessControlUnauthorizedAccount.selector,
            nonAdmin,
            secRole
        ));
        registry.upgradeToAndCall(address(newImpl), "");
    }

    // ====================================================
    // Storage preserved across upgrades
    // ====================================================

    function test_StoragePreservedAfterUpgrade() public {
        // Register an agent
        address human = makeAddr("human");
        uint256 nullifier = 42;
        _registerViaHub(human, nullifier);

        bytes32 agentKey = bytes32(uint256(uint160(human)));
        uint256 agentId = registry.getAgentId(agentKey);
        assertTrue(agentId != 0);
        assertTrue(registry.isVerifiedAgent(agentKey));
        assertEq(registry.ownerOf(agentId), human);

        // Upgrade to new implementation
        SelfAgentRegistry newImpl = new SelfAgentRegistry();
        vm.prank(owner);
        registry.upgradeToAndCall(address(newImpl), "");

        // Verify state is fully preserved
        assertEq(registry.getAgentId(agentKey), agentId);
        assertTrue(registry.isVerifiedAgent(agentKey));
        assertEq(registry.ownerOf(agentId), human);
        assertTrue(registry.hasHumanProof(agentId));
        assertEq(registry.getHumanNullifier(agentId), nullifier);
        assertEq(registry.getProofProvider(agentId), address(selfProvider));
        assertEq(registry.getAgentCountForHuman(nullifier), 1);
    }

    // ====================================================
    // New storage fields preserved and functional after upgrade
    // ====================================================

    function test_NewStorageFieldsAfterUpgrade() public {
        // Register an agent (pre-upgrade)
        address human = makeAddr("human");
        uint256 nullifier = 42;
        _registerViaHub(human, nullifier);
        uint256 agentId = registry.getAgentId(bytes32(uint256(uint160(human))));

        // Verify pre-upgrade state
        assertEq(registry.getAgentCountForHuman(nullifier), 1);

        // Upgrade
        SelfAgentRegistry newImpl = new SelfAgentRegistry();
        vm.prank(owner);
        registry.upgradeToAndCall(address(newImpl), "");

        // Verify new view functions work after upgrade
        // getAgentsForNullifier should return the agent registered pre-upgrade
        uint256[] memory agents = registry.getAgentsForNullifier(nullifier);
        assertEq(agents.length, 1);
        assertEq(agents[0], agentId);

        // agentConfigId should be set (from Task 3)
        assertEq(registry.agentConfigId(agentId), fakeConfigId);

        // Verify paginated overload works
        uint256[] memory paginated = registry.getAgentsForNullifier(nullifier, 0, 10);
        assertEq(paginated.length, 1);
        assertEq(paginated[0], agentId);
    }

    function test_RefreshWorksAfterUpgrade() public {
        // Register pre-upgrade
        address human = makeAddr("human");
        uint256 nullifier = 42;
        _registerViaHub(human, nullifier);
        uint256 agentId = registry.getAgentId(bytes32(uint256(uint160(human))));

        // Upgrade
        SelfAgentRegistry newImpl = new SelfAgentRegistry();
        vm.prank(owner);
        registry.upgradeToAndCall(address(newImpl), "");

        // Refresh should work post-upgrade since agent was registered with configId
        vm.warp(block.timestamp + 180 days);
        bytes memory refreshUserData = abi.encodePacked(uint8(0x46), uint8(0), agentId);

        string[] memory names = new string[](3);
        names[0] = "ALICE"; names[1] = ""; names[2] = "SMITH";
        ISelfVerificationRoot.GenericDiscloseOutputV2 memory output = ISelfVerificationRoot
            .GenericDiscloseOutputV2({
                attestationId: bytes32(uint256(1)),
                userIdentifier: uint256(uint160(human)),
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

        vm.prank(hubMock);
        registry.onVerificationSuccess(abi.encode(output), refreshUserData);

        assertTrue(registry.isProofFresh(agentId));
        assertGt(registry.proofExpiresAt(agentId), block.timestamp + 300 days);
    }

    // ====================================================
    // Rep + Val upgrade tests
    // ====================================================

    function test_UpgradeRepWithSecurityRole() public {
        SelfReputationRegistry newImpl = new SelfReputationRegistry();
        vm.prank(owner);
        rep.upgradeToAndCall(address(newImpl), "");
        assertEq(rep.getIdentityRegistry(), address(registry));
    }

    function test_UpgradeValWithSecurityRole() public {
        SelfValidationRegistry newImpl = new SelfValidationRegistry();
        vm.prank(owner);
        val.upgradeToAndCall(address(newImpl), "");
        assertEq(val.getIdentityRegistry(), address(registry));
    }

    // ====================================================
    // Role governance
    // ====================================================

    function test_SecurityRoleIsAdminOfBothRoles() public view {
        assertEq(registry.getRoleAdmin(registry.SECURITY_ROLE()), registry.SECURITY_ROLE());
        assertEq(registry.getRoleAdmin(registry.OPERATIONS_ROLE()), registry.SECURITY_ROLE());
    }

    function test_OwnerHasBothRoles() public view {
        assertTrue(registry.hasRole(registry.SECURITY_ROLE(), owner));
        assertTrue(registry.hasRole(registry.OPERATIONS_ROLE(), owner));
    }

    // ====================================================
    // Deployer does NOT retain roles
    // ====================================================

    function test_DeployerDoesNotRetainRoles() public view {
        // address(this) is the deployer (setUp runs as address(this))
        // owner is the initialOwner passed to initialize()
        // If deployer == owner, this test is trivially true, so we check
        // that address(this) != owner and address(this) has no roles
        assertTrue(address(this) != owner, "test requires deployer != owner");
        assertFalse(registry.hasRole(registry.SECURITY_ROLE(), address(this)));
        assertFalse(registry.hasRole(registry.OPERATIONS_ROLE(), address(this)));
        assertFalse(rep.hasRole(rep.SECURITY_ROLE(), address(this)));
        assertFalse(rep.hasRole(rep.OPERATIONS_ROLE(), address(this)));
        assertFalse(val.hasRole(val.SECURITY_ROLE(), address(this)));
        assertFalse(val.hasRole(val.OPERATIONS_ROLE(), address(this)));
    }

    // ====================================================
    // ERC-7201 storage location verification
    // ====================================================

    function test_ERC7201_SelfAgentRegistryStorageLocation() public pure {
        bytes32 expected = keccak256(
            abi.encode(uint256(keccak256("self.storage.SelfAgentRegistry")) - 1)
        ) & ~bytes32(uint256(0xff));
        assertEq(expected, 0x867b9f313fe85b5b69621ca346ab22f9689356653885ece64b114fbeeff43500);
    }

    function test_ERC7201_SelfReputationRegistryStorageLocation() public pure {
        bytes32 expected = keccak256(
            abi.encode(uint256(keccak256("self.storage.SelfReputationRegistry")) - 1)
        ) & ~bytes32(uint256(0xff));
        assertEq(expected, 0xb74115cc2fc5e81810d485ad3c7e52a4ecbfda17e11c550855f3557e2e12c500);
    }

    function test_ERC7201_SelfValidationRegistryStorageLocation() public pure {
        bytes32 expected = keccak256(
            abi.encode(uint256(keccak256("self.storage.SelfValidationRegistry")) - 1)
        ) & ~bytes32(uint256(0xff));
        assertEq(expected, 0xf29cfc1bc704e28fc8a6cee86a23220f2c463c2f2682ac69308c61b238211500);
    }

    // ====================================================
    // Helpers
    // ====================================================

    function _registerViaHub(address humanAddr, uint256 nullifier) internal {
        string[] memory names = new string[](3);
        names[0] = "ALICE"; names[1] = ""; names[2] = "SMITH";

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

        bytes memory encodedOutput = abi.encode(output);
        bytes memory userData = abi.encodePacked(uint8(0x52), uint8(0));
        vm.prank(hubMock);
        registry.onVerificationSuccess(encodedOutput, userData);
    }
}
