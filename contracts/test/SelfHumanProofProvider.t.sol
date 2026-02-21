// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import { Test } from "forge-std/Test.sol";
import { SelfHumanProofProvider } from "../src/SelfHumanProofProvider.sol";

contract SelfHumanProofProviderTest is Test {
    SelfHumanProofProvider provider;
    address hubMock = makeAddr("hub");
    uint256 testScope = 12345;

    function setUp() public {
        provider = new SelfHumanProofProvider(hubMock, testScope);
    }

    function test_HubV2() public view {
        assertEq(provider.hubV2(), hubMock);
    }

    function test_Scope() public view {
        assertEq(provider.scope(), testScope);
    }

    function test_ProviderName() public view {
        assertEq(provider.providerName(), "self");
    }

    function test_VerificationStrength() public view {
        assertEq(provider.verificationStrength(), 100);
    }

    function test_RevertWhen_VerifyHumanProof() public {
        vm.expectRevert(SelfHumanProofProvider.DirectVerificationNotSupported.selector);
        provider.verifyHumanProof("", "");
    }
}
