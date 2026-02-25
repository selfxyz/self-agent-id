# SPDX-FileCopyrightText: 2025-2026 Social Connect Labs, Inc.
# SPDX-License-Identifier: BUSL-1.1
# NOTE: Converts to Apache-2.0 on 2029-06-11 per LICENSE.

"""Pure signing functions — no network dependencies."""
from urllib.parse import urlparse
from web3 import Web3
from eth_account import Account
from eth_account.messages import encode_defunct


def canonicalize_signing_url(url: str) -> str:
    """Canonical URL for signing/verification: path + optional query string."""
    if not url:
        return ""

    parsed = urlparse(url)

    # Absolute URL: keep only path + query
    if parsed.scheme and parsed.netloc:
        path = parsed.path or "/"
        return path + (f"?{parsed.query}" if parsed.query else "")

    # Relative URL/path inputs
    if url.startswith("?"):
        return "/" + url

    path = parsed.path or "/"
    if not path.startswith("/"):
        path = "/" + path
    return path + (f"?{parsed.query}" if parsed.query else "")


def compute_body_hash(body: str | None) -> str:
    """Keccak256 of UTF-8 body. Returns hex string WITH '0x' prefix.

    Matches TS: ethers.keccak256(ethers.toUtf8Bytes(body || ""))
    """
    text = body if body is not None else ""
    return "0x" + Web3.keccak(text=text).hex()


def compute_message(timestamp: str, method: str, url: str, body_hash: str) -> bytes:
    """Keccak256 of concatenated signing material. Returns raw 32 bytes.

    Matches TS: ethers.keccak256(ethers.toUtf8Bytes(timestamp + METHOD + url + bodyHash))
    Note: body_hash MUST include "0x" prefix (it's part of the string).
    """
    canonical_url = canonicalize_signing_url(url)
    payload = timestamp + method.upper() + canonical_url + body_hash
    return Web3.keccak(text=payload)


def sign_message(message_bytes: bytes, private_key: str) -> str:
    """EIP-191 personal_sign over raw 32-byte hash. Returns hex signature.

    CRITICAL: Use encode_defunct(primitive=message_bytes), NOT text=.
    The TS SDK calls wallet.signMessage(getBytes(hash)) which passes
    raw bytes to EIP-191 personal_sign. Using text= would UTF-8 encode
    the bytes as a string, producing a completely different signature.
    """
    signable = encode_defunct(primitive=message_bytes)
    acct = Account.from_key(private_key)
    signed = acct.sign_message(signable)
    return "0x" + signed.signature.hex()


def recover_signer(message_bytes: bytes, signature: str) -> str:
    """Recover the signer address from an EIP-191 signature.

    Matches TS: ethers.verifyMessage(ethers.getBytes(message), signature)
    """
    signable = encode_defunct(primitive=message_bytes)
    return Account.recover_message(signable, signature=signature)


def address_to_agent_key(address: str) -> bytes:
    """Convert 20-byte address to 32-byte agent key (left zero-padded).

    Matches TS: ethers.zeroPadValue(address, 32)
    """
    addr_bytes = bytes.fromhex(address[2:] if address.startswith("0x") else address)
    return b"\x00" * 12 + addr_bytes
