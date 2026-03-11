// SPDX-License-Identifier: MIT

pragma solidity 0.8.28;

import { AgentDemoVerifierEd25519 } from "../src/AgentDemoVerifierEd25519.sol";
import { BaseScript } from "./Base.s.sol";
import { console } from "forge-std/console.sol";

/// @title DeployAgentDemoVerifierEd25519
/// @notice Deploys AgentDemoVerifierEd25519 pointing to the existing SelfAgentRegistry
/// @dev Requires environment variables:
///      - PRIVATE_KEY: Deployer private key
///      - REGISTRY_ADDRESS: SelfAgentRegistry address
///        Celo Sepolia V5: 0x043DaCac8b0771DD5b444bCC88f2f8BBDBEdd379
contract DeployAgentDemoVerifierEd25519 is BaseScript {
    function run() public broadcast returns (AgentDemoVerifierEd25519 verifier) {
        address registryAddress = vm.envAddress("REGISTRY_ADDRESS");

        verifier = new AgentDemoVerifierEd25519(registryAddress);

        console.log("AgentDemoVerifierEd25519 deployed to:", address(verifier));
        console.log("Registry:", registryAddress);
    }
}
