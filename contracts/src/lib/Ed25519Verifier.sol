// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import { SCL_EIP6565 } from "@solidity/lib/libSCL_EIP6565.sol";

/// @title Ed25519Verifier
/// @notice Wrapper around SCL crypto-lib for Ed25519 signature verification.
/// @dev Uses SCL's Verify_LE which expects little-endian (RFC 8032 native) format.
library Ed25519Verifier {
    /// @notice Verify an Ed25519 signature using precomputed extended public key.
    /// @param message The message that was signed (raw bytes as string)
    /// @param r Signature R component (little-endian, uint256)
    /// @param s Signature S component (little-endian, uint256)
    /// @param extKpub Precomputed extended public key [Wx, Wy, Wx128, Wy128, compressedLE]
    /// @return True if signature is valid
    function verify(
        string memory message,
        uint256 r,
        uint256 s,
        uint256[5] memory extKpub
    ) internal view returns (bool) {
        return SCL_EIP6565.Verify_LE(message, r, s, extKpub);
    }

    /// @notice Derive a deterministic Ethereum address from an Ed25519 public key.
    /// @dev Used as the NFT owner for Ed25519-registered agents. Nobody holds the
    ///      secp256k1 private key for this address — it's a virtual owner.
    /// @param ed25519Pubkey The 32-byte compressed Ed25519 public key
    /// @return The derived address
    function deriveAddress(bytes32 ed25519Pubkey) internal pure returns (address) {
        return address(uint160(uint256(keccak256(abi.encodePacked(ed25519Pubkey)))));
    }
}
