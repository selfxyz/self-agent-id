// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import { console } from "forge-std/console.sol";
import { BaseScript } from "./Base.s.sol";
import { SelfReputationProvider } from "../src/SelfReputationProvider.sol";
import { SelfValidationProvider } from "../src/SelfValidationProvider.sol";

/// @title DeployProviders
/// @notice Deploy SelfReputationProvider + SelfValidationProvider
/// @dev Usage:
///   PRIVATE_KEY=0x... REGISTRY=0x... forge script script/DeployProviders.s.sol \
///     --rpc-url celo-sepolia --broadcast --verify --evm-version cancun
contract DeployProviders is BaseScript {
    function run() external broadcast {
        address registry = vm.envAddress("REGISTRY");
        require(registry != address(0), "REGISTRY env var is zero address");
        require(registry.code.length > 0, "REGISTRY is not a deployed contract");

        SelfReputationProvider rep = new SelfReputationProvider(registry);
        SelfValidationProvider val = new SelfValidationProvider(registry);

        console.log("SelfReputationProvider:", address(rep));
        console.log("SelfValidationProvider:", address(val));
    }
}
