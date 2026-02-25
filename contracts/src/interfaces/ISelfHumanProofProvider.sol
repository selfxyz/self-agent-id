// SPDX-License-Identifier: MIT

pragma solidity 0.8.28;

import { IHumanProofProvider } from "./IHumanProofProvider.sol";

/// @title ISelfHumanProofProvider
/// @notice Self Protocol implementation of IHumanProofProvider
/// @dev Wraps Self's Identity Verification Hub V2 to verify ZK proofs
///      from passport NFC chips. Verification strength = 100 (government document + biometric).
interface ISelfHumanProofProvider is IHumanProofProvider {
    /// @notice Get the Self Hub V2 address used for verification
    function hubV2() external view returns (address);

    /// @notice Get the scope used for nullifier generation
    function scope() external view returns (uint256);
}
