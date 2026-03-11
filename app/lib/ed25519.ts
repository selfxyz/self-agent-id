/**
 * Ed25519 registration utilities for Self Agent ID.
 *
 * Provides challenge hash computation, extKpub (Edwards-to-Weierstrass) conversion,
 * and userData builder for the Hub V2 callback.
 */

import { ethers } from "ethers";
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore — noble/curves v2 export map uses .js suffix
import { ed25519 } from "@noble/curves/ed25519.js";

// ============================================================
// Field constants from SCL_wei25519.sol
// ============================================================

const p = 0x7fffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffedn;
const a =
  19298681539552699237261830834781317975544997444273427339909597334573241639236n;
const delta =
  0x2aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaad2451n;
const c_const =
  0x70d9120b9f5ff9442d84f723fc03b0813a5e2c2eb482e57d3391fb5500ba81e7n;

// ============================================================
// Modular arithmetic helpers
// ============================================================

function mod(x: bigint, m: bigint): bigint {
  return ((x % m) + m) % m;
}

function modAdd(a: bigint, b: bigint, m: bigint): bigint {
  return mod(a + b, m);
}

function modMul(a: bigint, b: bigint, m: bigint): bigint {
  return mod(a * b, m);
}

/** Modular inverse using Fermat's little theorem: a^(p-2) mod p */
function modInverse(a: bigint, m: bigint): bigint {
  return modPow(mod(a, m), m - 2n, m);
}

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

// ============================================================
// Weierstrass curve operations
// ============================================================

/** Point doubling on short Weierstrass curve y^2 = x^3 + ax + b */
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

/** Compute Q * 2^128 via 128 sequential point doublings */
function ecPow128(wx: bigint, wy: bigint): [bigint, bigint] {
  let x = wx;
  let y = wy;
  for (let i = 0; i < 128; i++) {
    [x, y] = weierstrassDouble(x, y);
  }
  return [x, y];
}

// ============================================================
// Edwards <-> Weierstrass conversion (matching SCL)
// ============================================================

/**
 * Convert Edwards point (ex, ey) to Weierstrass (Wx, Wy).
 * Matches SCL's Edwards2WeierStrass:
 *   Wx = ((1 + ey) / (1 - ey)) + delta
 *   Wy = (c * (1 + ey)) / ((1 - ey) * ex)
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

// ============================================================
// Byte manipulation
// ============================================================

/** Reverse bytes of a 256-bit number (matching SCL's Swap256) */
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

function hexToBytes(hex: string): Uint8Array {
  const clean = hex.startsWith("0x") ? hex.slice(2) : hex;
  const bytes = new Uint8Array(clean.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

function bytesToBigInt(bytes: Uint8Array): bigint {
  let result = 0n;
  for (const b of bytes) {
    result = (result << 8n) | BigInt(b);
  }
  return result;
}

// ============================================================
// Public API
// ============================================================

/**
 * Compute the registration challenge hash for Ed25519 agents.
 * Must match the contract's _verifyEd25519Signature message format.
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
 * Performs Edwards-to-Weierstrass conversion matching SCL's SetKey output.
 *
 * @param pubkeyHex 64-char hex string of the compressed Ed25519 public key
 * @returns [Wx, Wy, Wx128, Wy128, compressedLE] as bigint array
 */
export function computeExtKpub(pubkeyHex: string): bigint[] {
  const pubkeyBytes = hexToBytes(pubkeyHex);

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
 * Build the Ed25519 userData string for the Hub V2 callback.
 * Format: "E" + config(1) + pubkey(64) + sig(128) + extKpub[0..4](320) + guardian(40) = 554 chars
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

/** Validate a hex string as a 32-byte Ed25519 public key */
export function isValidEd25519PubkeyHex(hex: string): boolean {
  if (!/^[0-9a-fA-F]{64}$/.test(hex)) return false;
  try {
    ed25519.Point.fromHex(hex);
    return true;
  } catch {
    return false;
  }
}

/** Convert base64-encoded Ed25519 public key to hex */
export function base64ToHex(b64: string): string {
  const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  if (bytes.length !== 32) throw new Error("Invalid Ed25519 key length");
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Derive the Ethereum address from an Ed25519 public key.
 * Matches the contract's Ed25519Verifier.deriveAddress.
 */
export function deriveEd25519Address(pubkeyHex: string): string {
  return ethers.getAddress(
    "0x" + ethers.keccak256("0x" + pubkeyHex.padStart(64, "0")).slice(2 + 24), // last 20 bytes
  );
}
