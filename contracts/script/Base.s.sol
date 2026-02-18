// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import { Script } from "forge-std/Script.sol";

/// @title BaseScript
/// @notice Shared broadcast modifier for deployment scripts
abstract contract BaseScript is Script {
    address internal broadcaster;

    modifier broadcast() {
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");
        broadcaster = vm.addr(deployerPrivateKey);
        vm.startBroadcast(deployerPrivateKey);
        _;
        vm.stopBroadcast();
    }
}
