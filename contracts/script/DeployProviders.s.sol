// SPDX-License-Identifier: MIT

pragma solidity 0.8.28;

import { console } from "forge-std/console.sol";
import { BaseScript } from "./Base.s.sol";
import { SelfReputationSignal } from "../src/SelfReputationSignal.sol";
import { SelfFreshnessChecker } from "../src/SelfFreshnessChecker.sol";
import { SelfReputationRegistry } from "../src/SelfReputationRegistry.sol";
import { SelfValidationRegistry } from "../src/SelfValidationRegistry.sol";
import { ProxyRoot } from "../src/upgradeable/ProxyRoot.sol";

/// @title DeployProviders
/// @notice Deploy SelfReputationRegistry (UUPS proxy) + SelfValidationRegistry (UUPS proxy) +
///         SelfReputationSignal + SelfFreshnessChecker
/// @dev Usage:
///   PRIVATE_KEY=0x... REGISTRY=0x... forge script script/DeployProviders.s.sol \
///     --rpc-url celo-sepolia --broadcast --verify --evm-version cancun
contract DeployProviders is BaseScript {
    function run() external broadcast {
        address registry = vm.envAddress("REGISTRY");
        require(registry != address(0), "REGISTRY env var is zero address");
        require(registry.code.length > 0, "REGISTRY is not a deployed contract");

        // Deploy SelfReputationRegistry behind proxy
        SelfReputationRegistry repImpl = new SelfReputationRegistry();
        SelfReputationRegistry rep = SelfReputationRegistry(address(new ProxyRoot(
            address(repImpl),
            abi.encodeCall(SelfReputationRegistry.initialize, (registry, broadcaster))
        )));
        console.log("SelfReputationRegistry impl:", address(repImpl));
        console.log("SelfReputationRegistry proxy:", address(rep));

        // Deploy SelfValidationRegistry behind proxy
        SelfValidationRegistry valImpl = new SelfValidationRegistry();
        SelfValidationRegistry val = SelfValidationRegistry(address(new ProxyRoot(
            address(valImpl),
            abi.encodeCall(SelfValidationRegistry.initialize, (registry, broadcaster))
        )));
        console.log("SelfValidationRegistry impl:", address(valImpl));
        console.log("SelfValidationRegistry proxy:", address(val));

        // Deploy non-upgradeable signal/checker contracts
        SelfReputationSignal repSignal = new SelfReputationSignal(registry);
        SelfFreshnessChecker freshnessChecker = new SelfFreshnessChecker(registry);

        console.log("SelfReputationSignal:", address(repSignal));
        console.log("SelfFreshnessChecker:", address(freshnessChecker));
    }
}
