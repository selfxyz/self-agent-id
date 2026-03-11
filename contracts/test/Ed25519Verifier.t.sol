// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import "forge-std/Test.sol";

import { Ed25519Verifier } from "../src/lib/Ed25519Verifier.sol";
import { SCL_EIP6565 } from "@solidity/lib/libSCL_EIP6565.sol";
import "@solidity/lib/libSCL_eddsaUtils.sol";

contract Ed25519VerifierTest is Test {
    /// @dev RFC 8032 test vector 2 (page 25): secret key, message "72", signature (r, s) in LE format.
    uint256 constant SECRET_2 = 0x4ccd089b28ff96da9db6c346ec114e0f5b8a319f35aba624da8cf6ed4fb8a6fb;
    uint256 constant R_2 = 0x92a009a9f0d4cab8720e820b5f642540a2b27b5416503f8fb3762223ebdb69da;
    uint256 constant S_2 = 0x085ac1e43e15996e458f3613d0f11d8c387b2eaeb4302aeeb00d291612bb0c00;

    /// @dev RFC 8032 test vector 3 (page 25): secret key, message "af82", signature (r, s) in LE format.
    uint256 constant SECRET_3 = 0xc5aa8df43f9f837bedb7442f31dcb7b166d38535076f094b85ce3a2e0b4458f7;
    uint256 constant R_3 = 0x6291d657deec24024827e69c3abe01a30ce548a284743a445e3680d7db5ac3ac;
    uint256 constant S_3 = 0x18ff9b538d16f290ae67f760984dc6594a7c15e9716ed28dc027beceea1ec40a;

    function test_verify_rfc8032_vector2() public view {
        uint256[5] memory extKpub;
        (extKpub,) = SCL_EIP6565_UTILS.SetKey(SECRET_2);

        bytes memory msg2 = hex"72";
        bool result = Ed25519Verifier.verify(string(msg2), R_2, S_2, extKpub);
        assertTrue(result, "RFC 8032 vector 2 should verify");
    }

    function test_verify_rfc8032_vector3() public view {
        uint256[5] memory extKpub;
        (extKpub,) = SCL_EIP6565_UTILS.SetKey(SECRET_3);

        bytes memory msg3 = hex"af82";
        bool result = Ed25519Verifier.verify(string(msg3), R_3, S_3, extKpub);
        assertTrue(result, "RFC 8032 vector 3 should verify");
    }

    function test_verify_rejectsInvalidSignature() public view {
        uint256[5] memory extKpub;
        (extKpub,) = SCL_EIP6565_UTILS.SetKey(SECRET_2);

        bytes memory msg2 = hex"72";
        // Corrupt the s value by adding 1
        uint256 badS = S_2 + 1;
        bool result = Ed25519Verifier.verify(string(msg2), R_2, badS, extKpub);
        assertFalse(result, "Corrupted signature should not verify");
    }

    function test_verify_rejectsWrongMessage() public view {
        uint256[5] memory extKpub;
        (extKpub,) = SCL_EIP6565_UTILS.SetKey(SECRET_2);

        // Sign was for message hex"72", verify against different message
        bytes memory wrongMsg = hex"73";
        bool result = Ed25519Verifier.verify(string(wrongMsg), R_2, S_2, extKpub);
        assertFalse(result, "Wrong message should not verify");
    }

    function test_verify_rejectsWrongKey() public view {
        // Use vector 3's key to try to verify vector 2's signature
        uint256[5] memory extKpub;
        (extKpub,) = SCL_EIP6565_UTILS.SetKey(SECRET_3);

        bytes memory msg2 = hex"72";
        bool result = Ed25519Verifier.verify(string(msg2), R_2, S_2, extKpub);
        assertFalse(result, "Wrong public key should not verify");
    }

    function test_deriveAddress_deterministic() public pure {
        bytes32 pubkey = bytes32(uint256(0xfc51cd8e6218a1a38da47ed00230f0580816ed13ba3303ac5deb911548908025));
        address addr1 = Ed25519Verifier.deriveAddress(pubkey);
        address addr2 = Ed25519Verifier.deriveAddress(pubkey);
        assertEq(addr1, addr2, "deriveAddress should be deterministic");
        assertTrue(addr1 != address(0), "Derived address should not be zero");
    }

    function test_deriveAddress_differentKeysProduceDifferentAddresses() public pure {
        bytes32 pubkey1 = bytes32(uint256(0xfc51cd8e6218a1a38da47ed00230f0580816ed13ba3303ac5deb911548908025));
        bytes32 pubkey2 = bytes32(uint256(0x3d4017c3e843895a92b70aa74d1b7ebc9c982ccf2ec4968cc0cd55f12af4660c));
        address addr1 = Ed25519Verifier.deriveAddress(pubkey1);
        address addr2 = Ed25519Verifier.deriveAddress(pubkey2);
        assertTrue(addr1 != addr2, "Different pubkeys should produce different addresses");
    }

    function test_deriveAddress_matchesManualKeccak() public pure {
        bytes32 pubkey = bytes32(uint256(0xfc51cd8e6218a1a38da47ed00230f0580816ed13ba3303ac5deb911548908025));
        address expected = address(uint160(uint256(keccak256(abi.encodePacked(pubkey)))));
        address derived = Ed25519Verifier.deriveAddress(pubkey);
        assertEq(derived, expected, "deriveAddress should match manual keccak256");
    }

    function test_gasBenchmark_verify() public {
        uint256[5] memory extKpub;
        (extKpub,) = SCL_EIP6565_UTILS.SetKey(SECRET_3);

        bytes memory msg3 = hex"af82";
        uint256 gasBefore = gasleft();
        Ed25519Verifier.verify(string(msg3), R_3, S_3, extKpub);
        uint256 gasUsed = gasBefore - gasleft();
        emit log_named_uint("Ed25519 verify gas", gasUsed);
    }
}
