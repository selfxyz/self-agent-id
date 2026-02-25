// SPDX-License-Identifier: MIT

pragma solidity 0.8.28;

import { IHumanProofProvider } from "../../src/interfaces/IHumanProofProvider.sol";

/// @notice Mock provider for testing the synchronous registerWithHumanProof path
contract MockHumanProofProvider is IHumanProofProvider {
    uint256 public nextNullifier;
    bool public shouldVerify;

    constructor() {
        shouldVerify = true;
    }

    function setNextNullifier(uint256 nullifier) external {
        nextNullifier = nullifier;
    }

    function setShouldVerify(bool _shouldVerify) external {
        shouldVerify = _shouldVerify;
    }

    function verifyHumanProof(
        bytes calldata,
        bytes calldata
    ) external view override returns (bool verified, uint256 nullifier) {
        return (shouldVerify, nextNullifier);
    }

    function providerName() external pure override returns (string memory) {
        return "Mock Provider";
    }

    function verificationStrength() external pure override returns (uint8) {
        return 50;
    }
}
