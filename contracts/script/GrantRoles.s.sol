// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import { console } from "forge-std/console.sol";
import { BaseScript } from "./Base.s.sol";

interface IAccessControl {
    function grantRole(bytes32 role, address account) external;
    function hasRole(bytes32 role, address account) external view returns (bool);
}

/// @title GrantRoles
/// @notice Grants SECURITY_ROLE and OPERATIONS_ROLE to multisigs on all 3 upgradeable contracts
/// @dev Does NOT renounce deployer roles — that will be done manually later.
///      Requires environment variables:
///      - PRIVATE_KEY: Deployer private key (must hold SECURITY_ROLE)
///      - REGISTRY: SelfAgentRegistry proxy address
///      - REPUTATION_REGISTRY: SelfReputationRegistry proxy address
///      - VALIDATION_REGISTRY: SelfValidationRegistry proxy address
///      - SECURITY_MULTISIG: 3/5 multisig address
///      - OPERATIONS_MULTISIG: 2/5 multisig address
contract GrantRoles is BaseScript {
    bytes32 constant SECURITY_ROLE = keccak256("SECURITY_ROLE");
    bytes32 constant OPERATIONS_ROLE = keccak256("OPERATIONS_ROLE");

    function run() external broadcast {
        address registry = vm.envAddress("REGISTRY");
        address repRegistry = vm.envAddress("REPUTATION_REGISTRY");
        address valRegistry = vm.envAddress("VALIDATION_REGISTRY");
        address securityMultisig = vm.envAddress("SECURITY_MULTISIG");
        address operationsMultisig = vm.envAddress("OPERATIONS_MULTISIG");

        address[3] memory contracts = [registry, repRegistry, valRegistry];
        string[3] memory names = ["SelfAgentRegistry", "SelfReputationRegistry", "SelfValidationRegistry"];

        for (uint256 i = 0; i < 3; i++) {
            IAccessControl ac = IAccessControl(contracts[i]);

            ac.grantRole(SECURITY_ROLE, securityMultisig);
            console.log(names[i], "- SECURITY_ROLE granted to:", securityMultisig);

            ac.grantRole(OPERATIONS_ROLE, operationsMultisig);
            console.log(names[i], "- OPERATIONS_ROLE granted to:", operationsMultisig);

            // Verify
            require(ac.hasRole(SECURITY_ROLE, securityMultisig), "SECURITY_ROLE grant failed");
            require(ac.hasRole(OPERATIONS_ROLE, operationsMultisig), "OPERATIONS_ROLE grant failed");
        }

        console.log("Role grants complete! Deployer roles NOT renounced.");
    }
}
