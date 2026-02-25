// SPDX-License-Identifier: MIT

pragma solidity 0.8.28;

/// @title IHumanProofProvider
/// @notice Interface for proof-of-human verification providers
/// @dev Any identity verification protocol (Self, Worldcoin, Humanity Protocol, etc.)
///      can implement this interface to serve as a proof-of-human provider for ERC-8004.
interface IHumanProofProvider {
    /// @notice Verify a proof of human identity
    /// @param proof The proof data (format depends on provider implementation)
    /// @param data Provider-specific context data
    /// @return verified Whether the proof is valid
    /// @return nullifier A unique identifier for the human, scoped to this provider+context.
    ///         Same human always produces the same nullifier for the same scope.
    ///         Used for sybil resistance.
    function verifyHumanProof(
        bytes calldata proof,
        bytes calldata data
    ) external returns (bool verified, uint256 nullifier);

    /// @notice Get the name of this proof provider
    /// @return The provider name (e.g. "Self Protocol", "World ID")
    function providerName() external view returns (string memory);

    /// @notice Get the verification strength score (0-100)
    /// @dev Used for reputation scoring. Examples:
    ///      100 = passport/national ID with NFC chip
    ///      60 = government ID without chip (e.g. Aadhaar)
    ///      40 = video liveness check
    /// @return The verification strength score
    function verificationStrength() external view returns (uint8);
}
