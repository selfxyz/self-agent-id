// SPDX-License-Identifier: MIT

pragma solidity 0.8.28;

import { AgentDemoVerifier } from "../src/AgentDemoVerifier.sol";
import { BaseScript } from "./Base.s.sol";
import { console } from "forge-std/console.sol";

/// @title DeployAgentDemoVerifier
/// @notice Deploys AgentDemoVerifier pointing to the existing SelfAgentRegistry
/// @dev Requires environment variables:
///      - PRIVATE_KEY: Deployer private key
///      - REGISTRY_ADDRESS: SelfAgentRegistry address
///        Celo Sepolia V5: 0x29d941856134b1D053AfFF57fa560324510C79fa
contract DeployAgentDemoVerifier is BaseScript {
    function run() public broadcast returns (AgentDemoVerifier verifier) {
        address registryAddress = vm.envAddress("REGISTRY_ADDRESS");

        verifier = new AgentDemoVerifier(registryAddress);

        console.log("AgentDemoVerifier deployed to:", address(verifier));
        console.log("Registry:", registryAddress);
    }
}
