// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import { console } from "forge-std/console.sol";
import { BaseScript } from "./Base.s.sol";

interface IRegistry {
    function setReputationRegistry(address) external;
    function setValidationRegistry(address) external;
}

interface IReputationRegistry {
    function setDocumentWeight(bytes32, int128, string calldata) external;
    function getDocumentWeight(bytes32) external view returns (int128, string memory);
}

/// @title PostDeploySetup
/// @notice Links registries and configures document weights after deployment
/// @dev Requires environment variables:
///      - PRIVATE_KEY: Deployer private key (must hold OPERATIONS_ROLE + SECURITY_ROLE)
///      - REGISTRY: SelfAgentRegistry proxy address
///      - REPUTATION_REGISTRY: SelfReputationRegistry proxy address
///      - VALIDATION_REGISTRY: SelfValidationRegistry proxy address
contract PostDeploySetup is BaseScript {
    function run() external broadcast {
        address registry = vm.envAddress("REGISTRY");
        address repRegistry = vm.envAddress("REPUTATION_REGISTRY");
        address valRegistry = vm.envAddress("VALIDATION_REGISTRY");

        // Link registries (OPERATIONS_ROLE)
        IRegistry(registry).setReputationRegistry(repRegistry);
        console.log("Reputation registry linked:", repRegistry);

        IRegistry(registry).setValidationRegistry(valRegistry);
        console.log("Validation registry linked:", valRegistry);

        // Set document weights (SECURITY_ROLE)
        IReputationRegistry rep = IReputationRegistry(repRegistry);
        rep.setDocumentWeight(bytes32(uint256(1)), 100, "passport-nfc");  // E_PASSPORT
        rep.setDocumentWeight(bytes32(uint256(2)), 100, "id-card-nfc");   // EU_ID_CARD
        rep.setDocumentWeight(bytes32(uint256(3)), 80, "aadhaar");        // AADHAAR
        rep.setDocumentWeight(bytes32(uint256(4)), 50, "kyc-sumsub");     // KYC

        // Verify
        (int128 w1, string memory t1) = rep.getDocumentWeight(bytes32(uint256(1)));
        console.log("E_PASSPORT weight:", uint256(int256(w1)), t1);
        (int128 w2, string memory t2) = rep.getDocumentWeight(bytes32(uint256(2)));
        console.log("EU_ID_CARD weight:", uint256(int256(w2)), t2);
        (int128 w3, string memory t3) = rep.getDocumentWeight(bytes32(uint256(3)));
        console.log("AADHAAR weight:", uint256(int256(w3)), t3);
        (int128 w4, string memory t4) = rep.getDocumentWeight(bytes32(uint256(4)));
        console.log("KYC weight:", uint256(int256(w4)), t4);

        console.log("Post-deploy setup complete!");
    }
}
