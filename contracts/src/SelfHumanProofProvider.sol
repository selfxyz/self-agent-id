// SPDX-License-Identifier: MIT

pragma solidity 0.8.28;

import { IHumanProofProvider } from "./interfaces/IHumanProofProvider.sol";
import { ISelfHumanProofProvider } from "./interfaces/ISelfHumanProofProvider.sol";

/// @title SelfHumanProofProvider
/// @notice Lightweight metadata wrapper describing Self Protocol as a proof-of-human provider
/// @dev Because Self Hub V2 uses an async callback pattern (verifySelfProof -> Hub -> onVerificationSuccess),
///      verifyHumanProof cannot work as a synchronous call-and-return. The actual verification flow
///      is handled directly by SelfAgentRegistry which inherits SelfVerificationRoot.
///
///      This contract exists to satisfy the IHumanProofProvider interface for the ERC-8004
///      provider whitelist. It stores a reference to the Hub V2 and the scope, and reports
///      metadata (provider name, verification strength). The verifyHumanProof function reverts
///      because the real verification must go through the Hub V2 callback flow.
contract SelfHumanProofProvider is ISelfHumanProofProvider {
    /// @notice The Self Identity Verification Hub V2 address
    address public immutable override hubV2;

    /// @notice The scope used for nullifier generation
    uint256 public immutable override scope;

    /// @notice Error thrown when verifyHumanProof is called directly
    /// @dev Self Hub V2 uses an async callback pattern; use verifySelfProof on the registry instead
    error DirectVerificationNotSupported();

    /// @param _hubV2 Address of the deployed IdentityVerificationHubV2
    /// @param _scope The scope value from the SelfAgentRegistry (computed at registry deploy time)
    constructor(address _hubV2, uint256 _scope) {
        hubV2 = _hubV2;
        scope = _scope;
    }

    /// @inheritdoc IHumanProofProvider
    /// @dev Always reverts. Self Hub V2 uses an async callback pattern.
    ///      Verification must go through SelfAgentRegistry.verifySelfProof() which triggers
    ///      Hub V2 -> onVerificationSuccess -> customVerificationHook.
    function verifyHumanProof(
        bytes calldata,
        bytes calldata
    ) external pure override returns (bool, uint256) {
        revert DirectVerificationNotSupported();
    }

    /// @inheritdoc IHumanProofProvider
    function providerName() external pure override returns (string memory) {
        return "self";
    }

    /// @inheritdoc IHumanProofProvider
    /// @dev 100 = passport/national ID with NFC chip + biometric verification
    function verificationStrength() external pure override returns (uint8) {
        return 100;
    }
}
