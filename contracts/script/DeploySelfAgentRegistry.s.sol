// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import { SelfAgentRegistry } from "../src/SelfAgentRegistry.sol";
import { SelfHumanProofProvider } from "../src/SelfHumanProofProvider.sol";
import { BaseScript } from "./Base.s.sol";
import { console } from "forge-std/console.sol";

/// @title DeploySelfAgentRegistry
/// @notice Deploys SelfAgentRegistry + SelfHumanProofProvider and links them
/// @dev Requires environment variables:
///      - PRIVATE_KEY: Deployer private key
///      - IDENTITY_VERIFICATION_HUB_ADDRESS: Hub V2 address
///        Celo Sepolia: 0x16ECBA51e18a4a7e61fdC417f0d47AFEeDfbed74
contract DeploySelfAgentRegistry is BaseScript {
    error DeploymentFailed();

    function run()
        public
        broadcast
        returns (SelfAgentRegistry registry, SelfHumanProofProvider provider)
    {
        address hubAddress = vm.envAddress("IDENTITY_VERIFICATION_HUB_ADDRESS");

        // Step 1: Deploy the registry (also registers verification config with Hub V2)
        registry = new SelfAgentRegistry(hubAddress, broadcaster);

        console.log("SelfAgentRegistry deployed to:", address(registry));
        console.log("Hub V2:", hubAddress);
        console.log("Scope:", registry.scope());
        console.log("Config IDs (6 configs: base, 18+, 21+, OFAC, 18+OFAC, 21+OFAC):");
        for (uint256 i = 0; i < 6; i++) {
            console.logBytes32(registry.configIds(i));
        }

        if (address(registry) == address(0)) revert DeploymentFailed();

        // Step 2: Deploy the companion SelfHumanProofProvider
        provider = new SelfHumanProofProvider(hubAddress, registry.scope());

        console.log("SelfHumanProofProvider deployed to:", address(provider));

        if (address(provider) == address(0)) revert DeploymentFailed();

        // Step 3: Link the provider to the registry (also approves it)
        registry.setSelfProofProvider(address(provider));

        console.log("Provider linked to registry");
        console.log("Deployment complete!");
    }
}
