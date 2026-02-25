// SPDX-License-Identifier: MIT

pragma solidity 0.8.28;

import { AgentGate } from "../src/AgentGate.sol";
import { BaseScript } from "./Base.s.sol";
import { console } from "forge-std/console.sol";

/// @title DeployAgentGate
/// @notice Deploys AgentGate pointing to the existing SelfAgentRegistry
/// @dev Requires environment variables:
///      - PRIVATE_KEY: Deployer private key
///      - REGISTRY_ADDRESS: SelfAgentRegistry address
///        Celo Sepolia V5: 0x29d941856134b1D053AfFF57fa560324510C79fa
contract DeployAgentGate is BaseScript {
    function run() public broadcast returns (AgentGate gate) {
        address registryAddress = vm.envAddress("REGISTRY_ADDRESS");

        gate = new AgentGate(registryAddress);

        console.log("AgentGate deployed to:", address(gate));
        console.log("Registry:", registryAddress);
    }
}
