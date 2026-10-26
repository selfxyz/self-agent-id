// SPDX-FileCopyrightText: 2025-2026 Social Connect Labs, Inc.
// SPDX-License-Identifier: BUSL-1.1
// NOTE: Converts to Apache-2.0 on 2029-06-11 per LICENSE.

/**
 * Ed25519 agent registration helpers.
 *
 * Challenge hash, signature and pubkey checks, address derivation, extKpub
 * (Edwards-to-Weierstrass, matching the on-chain SCL verifier) and the "E"
 * userData the registry decodes from the Self proof.
 */

import { ethers } from "ethers";
import { ed25519 } from "@noble/curves/ed25519.js";

// ── Field constants from SCL_wei25519.sol ────────────────────────────────────

const p = 0x7fffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffedn;
const a =
  19298681539552699237261830834781317975544997444273427339909597334573241639236n;
const delta =
  0x2aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaad2451n;
const c_const =
  0x70d9120b9f5ff9442d84f723fc03b0813a5e2c2eb482e57d3391fb5500ba81e7n;

// ── Modular arithmetic helpers ───────────────────────────────────────────────

/**
 * Reduce x into [0, m).
 *
 * @param x - Value (may be negative).
 * @param m - Modulus.
 * @returns x mod m, non-negative.
 */
function mod(x: bigint, m: bigint): bigint {
  return ((x % m) + m) % m;
}

/**
 * Add modulo m.
 *
 * @param a - First addend.
 * @param b - Second addend.
 * @param m - Modulus.
 * @returns (a + b) mod m.
 */
function modAdd(a: bigint, b: bigint, m: bigint): bigint {
  return mod(a + b, m);
}

/**
 * Multiply modulo m.
 *
 * @param a - First factor.
 * @param b - Second factor.
 * @param m - Modulus.
 * @returns (a * b) mod m.
 */
function modMul(a: bigint, b: bigint, m: bigint): bigint {
  return mod(a * b, m);
}

/**
 * Invert modulo a prime using Fermat's little theorem: a^(m-2) mod m.
 *
 * @param a - Value to invert (0 has no inverse and yields 0).
 * @param m - Prime modulus.
 * @returns a^-1 mod m.
 */
function modInverse(a: bigint, m: bigint): bigint {
  return modPow(mod(a, m), m - 2n, m);
}

/**
 * Raise to a power modulo m (square-and-multiply).
 *
 * @param base - Base.
 * @param exp - Non-negative exponent.
 * @param m - Modulus.
 * @returns base^exp mod m.
 */
function modPow(base: bigint, exp: bigint, m: bigint): bigint {
  let result = 1n;
  base = mod(base, m);
  while (exp > 0n) {
    if (exp & 1n) result = modMul(result, base, m);
    exp >>= 1n;
    base = modMul(base, base, m);
  }
  return result;
}

// ── Weierstrass curve operations ─────────────────────────────────────────────

/**
 * Double a point on the short Weierstrass curve y^2 = x^3 + ax + b.
 *
 * @param x - Point x.
 * @param y - Point y.
 * @returns 2P as [x, y].
 */
function weierstrassDouble(x: bigint, y: bigint): [bigint, bigint] {
  // lambda = (3*x^2 + a) / (2*y)
  const num = modAdd(modMul(3n, modMul(x, x, p), p), a, p);
  const den = modInverse(modMul(2n, y, p), p);
  const lam = modMul(num, den, p);
  // x3 = lambda^2 - 2*x
  const x3 = mod(modMul(lam, lam, p) - modMul(2n, x, p), p);
  // y3 = lambda * (x - x3) - y
  const y3 = mod(modMul(lam, mod(x - x3, p), p) - y, p);
  return [x3, y3];
}

/**
 * Compute Q * 2^128 via 128 sequential point doublings.
 *
 * @param wx - Weierstrass x of Q.
 * @param wy - Weierstrass y of Q.
 * @returns Q * 2^128 as [x, y].
 */
function ecPow128(wx: bigint, wy: bigint): [bigint, bigint] {
  let x = wx;
  let y = wy;
  for (let i = 0; i < 128; i++) {
    [x, y] = weierstrassDouble(x, y);
  }
  return [x, y];
}

// ── Edwards <-> Weierstrass conversion (matching SCL) ────────────────────────

/**
 * Convert an affine Edwards point to Weierstrass, matching SCL's
 * Edwards2WeierStrass:
 *   Wx = ((1 + ey) / (1 - ey)) + delta
 *   Wy = (c * (1 + ey)) / ((1 - ey) * ex)
 *
 * @param ex - Edwards x.
 * @param ey - Edwards y.
 * @returns [Wx, Wy].
 */
function edwards2Weierstrass(ex: bigint, ey: bigint): [bigint, bigint] {
  const oneMinusEy = mod(1n - ey, p);
  const onePlusEy = mod(1n + ey, p);
  const invOneMinusEy = modInverse(oneMinusEy, p);

  const wx = modAdd(modMul(onePlusEy, invOneMinusEy, p), delta, p);
  const wy = modMul(
    modMul(c_const, onePlusEy, p),
    modInverse(modMul(oneMinusEy, ex, p), p),
    p,
  );
  return [wx, wy];
}

// ── Byte manipulation ────────────────────────────────────────────────────────

/**
 * Reverse the bytes of a 256-bit number (matching SCL's Swap256).
 *
 * @param val - 256-bit value.
 * @returns The byte-reversed value.
 */
function swap256(val: bigint): bigint {
  const bytes = new Uint8Array(32);
  let v = val;
  for (let i = 0; i < 32; i++) {
    bytes[i] = Number(v & 0xffn);
    v >>= 8n;
  }
  // bytes is now LE; reverse to get BE-of-swapped = LE representation as big-endian bigint
  let result = 0n;
  for (let i = 0; i < 32; i++) {
    result = (result << 8n) | BigInt(bytes[i]);
  }
  return result;
}

/**
 * Decode a hex string (optional 0x) to bytes. Does not validate input.
 *
 * @param hex - Even-length hex string.
 * @returns The bytes.
 */
function hexToBytes(hex: string): Uint8Array {
  const clean = hex.startsWith("0x") ? hex.slice(2) : hex;
  const bytes = new Uint8Array(clean.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Compute the registration challenge hash an Ed25519 agent signs.
 *
 * Must match the registry's _verifyEd25519Signature message format.
 *
 * @param params.humanAddress - Human identifier: the human's wallet
 *   (ed25519-linked) or the key's derived address (ed25519).
 * @param params.chainId - Chain ID of the registry.
 * @param params.registryAddress - Registry address.
 * @param params.nonce - The pubkey's current ed25519Nonce on the registry.
 * @returns 0x-prefixed keccak256 hash.
 * @throws If an address is malformed.
 */
export function computeEd25519ChallengeHash(params: {
  humanAddress: string;
  chainId: bigint;
  registryAddress: string;
  nonce: bigint;
}): string {
  return ethers.keccak256(
    ethers.solidityPacked(
      ["string", "address", "uint256", "address", "uint256"],
      [
        "self-agent-id:register-ed25519:",
        params.humanAddress,
        params.chainId,
        params.registryAddress,
        params.nonce,
      ],
    ),
  );
}

/**
 * Compute extKpub[5] from a 32-byte Ed25519 public key.
 *
 * Edwards-to-Weierstrass conversion matching SCL's SetKey output.
 *
 * @param pubkeyHex - 64-char hex of the compressed Ed25519 public key.
 * @returns [Wx, Wy, Wx128, Wy128, compressedLE].
 * @throws If the key does not decode to a curve point.
 */
export function computeExtKpub(pubkeyHex: string): bigint[] {
  // 1. Decompress Ed25519 point using @noble/curves
  const rawPoint = ed25519.Point.fromHex(pubkeyHex);
  // noble/curves v2: runtime point has X, Y, Z, T as bigint properties
  const point = rawPoint as unknown as {
    X: bigint;
    Y: bigint;
    Z: bigint;
    T: bigint;
  };

  // Normalize from extended (X:Y:Z:T) to affine (x, y)
  const zInv = modInverse(point.Z, p);
  const ex = modMul(point.X, zInv, p);
  const ey = modMul(point.Y, zInv, p);

  // 2. Edwards to Weierstrass
  const [wx, wy] = edwards2Weierstrass(ex, ey);

  // 3. Compute Q * 2^128
  const [wx128, wy128] = ecPow128(wx, wy);

  // 4. Compressed Edwards key in LE (matching SCL: Swap256(edCompress(Kpub)))
  // edCompress: y + ((x & 1) << 255)
  const compressed = ey + ((ex & 1n) << 255n);
  const compressedLE = swap256(compressed);

  return [wx, wy, wx128, wy128, compressedLE];
}

/**
 * Build the Ed25519 userData string carried in the Self app request.
 *
 * The registry decodes it when Hub V2 delivers the proof.
 * Format: "E" + config(1) + pubkey(64) + sig(128) + extKpub[0..4](320) +
 * guardian(40) = 554 chars.
 *
 * @param params.configIndex - Verification config index (single digit).
 * @param params.ed25519Pubkey - 64 hex chars, no 0x.
 * @param params.signature - 128 hex chars (r+s), no 0x.
 * @param params.extKpub - The 5 values from computeExtKpub.
 * @param params.guardian - Guardian address as 40 hex chars, no 0x (default
 *   zero, i.e. no guardian).
 * @returns The userData string.
 */
export function buildEd25519UserData(params: {
  configIndex: number;
  ed25519Pubkey: string; // 64 hex chars (no 0x prefix)
  signature: string; // 128 hex chars (r+s concatenated, no 0x prefix)
  extKpub: bigint[]; // 5 uint256 values
  guardian?: string; // 40 hex chars (no 0x prefix) or undefined
}): string {
  const { configIndex, ed25519Pubkey, signature, extKpub, guardian } = params;
  const guardianHex = guardian || "0".repeat(40);
  const extKpubHex = extKpub
    .map((v) => v.toString(16).padStart(64, "0"))
    .join("");
  return (
    "E" + configIndex + ed25519Pubkey + signature + extKpubHex + guardianHex
  );
}

/**
 * Validate a hex string as a 32-byte Ed25519 public key.
 *
 * Rejects small-order points (incl. the identity), for which trivial
 * signatures verify under every message.
 *
 * @param hex - Candidate key (any type), 64 hex chars without 0x.
 * @returns True for a valid, non-small-order curve point.
 */
export function isValidEd25519PubkeyHex(hex: unknown): hex is string {
  if (typeof hex !== "string" || !/^[0-9a-fA-F]{64}$/.test(hex)) return false;
  try {
    return !ed25519.Point.fromHex(hex).isSmallOrder();
  } catch {
    return false;
  }
}

/**
 * Verify an Ed25519 signature strictly (non-ZIP-215).
 *
 * @param signatureHex - 128 hex chars, no 0x.
 * @param messageHash - 0x-prefixed 32-byte hash that was signed.
 * @param pubkeyHex - 64 hex chars, no 0x.
 * @returns True if valid; false on a bad signature or any malformed input.
 */
export function verifyEd25519Signature(
  signatureHex: string,
  messageHash: string,
  pubkeyHex: string,
): boolean {
  if (!/^[0-9a-fA-F]{128}$/.test(signatureHex)) return false;
  if (!isValidEd25519PubkeyHex(pubkeyHex)) return false;
  try {
    return ed25519.verify(
      hexToBytes(signatureHex),
      ethers.getBytes(messageHash),
      hexToBytes(pubkeyHex),
      { zip215: false },
    );
  } catch {
    return false;
  }
}

/**
 * Derive the agent's EVM address from an Ed25519 public key.
 *
 * Matches the contract's Ed25519Verifier.deriveAddress: last 20 bytes of
 * keccak256(pubkey).
 *
 * @param pubkeyHex - 64 hex chars, no 0x.
 * @returns The checksummed address.
 * @throws If pubkeyHex is not valid hex.
 */
export function deriveEd25519Address(pubkeyHex: string): string {
  return ethers.getAddress(
    "0x" + ethers.keccak256("0x" + pubkeyHex.padStart(64, "0")).slice(2 + 24), // last 20 bytes
  );
}
