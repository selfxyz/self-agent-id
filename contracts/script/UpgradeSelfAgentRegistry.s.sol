// SPDX-License-Identifier: MIT

pragma solidity 0.8.28;

import { SelfAgentRegistry } from "../src/SelfAgentRegistry.sol";
import { BaseScript } from "./Base.s.sol";
import { console } from "forge-std/console.sol";

/// @title UpgradeSelfAgentRegistry
/// @notice Upgrades the SelfAgentRegistry proxy to a new implementation
/// @dev Requires environment variables:
///      - PRIVATE_KEY: Deployer private key (must have SECURITY_ROLE)
///      - PROXY_ADDRESS: The SelfAgentRegistry proxy address
contract UpgradeSelfAgentRegistry is BaseScript {
    function run() public broadcast {
        address proxy = vm.envAddress("PROXY_ADDRESS");

        // Deploy new implementation
        SelfAgentRegistry newImpl = new SelfAgentRegistry();
        console.log("New implementation deployed to:", address(newImpl));

        // Upgrade proxy to new implementation
        SelfAgentRegistry(proxy).upgradeToAndCall(address(newImpl), "");
        console.log("Proxy upgraded:", proxy);
    }
}
