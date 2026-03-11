/**
 * Ed25519 full registration flow test against Celo Sepolia.
 *
 * This script:
 * 1. Generates an Ed25519 keypair
 * 2. Fetches the nonce from the upgraded Sepolia contract
 * 3. Computes the challenge hash
 * 4. Signs it with Ed25519
 * 5. Computes extKpub (Edwards → Weierstrass)
 * 6. Builds the full userData (554 hex chars)
 * 7. Logs everything so you can verify it would work through the Hub V2 callback
 *
 * Usage: node test/ed25519-sepolia-e2e.mjs
 */

import { ethers } from "ethers";
import { ed25519 } from "@noble/curves/ed25519.js";

// ── Config ──────────────────────────────────────────────────────────────
const RPC_URL = "https://forno.celo-sepolia.celo-testnet.org";
const REGISTRY_ADDRESS = "0x043DaCac8b0771DD5b444bCC88f2f8BBDBEdd379";
const CHAIN_ID = 11142220n;

// Use the RFC 8032 vector 2 secret for deterministic testing.
// Load from environment to avoid hardcoded secret detection.
const SECRET_HEX =
  process.env.ED25519_TEST_SECRET ||
  (() => {
    throw new Error(
      "Set ED25519_TEST_SECRET env var (e.g. RFC 8032 vector 2: 4ccd089b…)"
    );
  })();

// A dummy human address (doesn't matter for this verification test)
const HUMAN_ADDRESS = "0x551775463D338c0c406b3266c63AF6EDA8b3e47a";

// ── Field constants from SCL_wei25519.sol ────────────────────────────────
const p = 0x7fffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffedn;
const a_const = 19298681539552699237261830834781317975544997444273427339909597334573241639236n;
const delta = 0x2aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaad2451n;
const c_const = 0x70d9120b9f5ff9442d84f723fc03b0813a5e2c2eb482e57d3391fb5500ba81e7n;

// ── Modular arithmetic ──────────────────────────────────────────────────
function mod(x, m) { return ((x % m) + m) % m; }
function modMul(a, b, m) { return mod(a * b, m); }
function modAdd(a, b, m) { return mod(a + b, m); }
function modPow(base, exp, m) {
  let result = 1n;
  base = mod(base, m);
  while (exp > 0n) {
    if (exp & 1n) result = modMul(result, base, m);
    exp >>= 1n;
    base = modMul(base, base, m);
  }
  return result;
}
function modInverse(a, m) { return modPow(mod(a, m), m - 2n, m); }

// ── Edwards → Weierstrass ───────────────────────────────────────────────
function edwards2Weierstrass(ex, ey) {
  const oneMinusEy = mod(1n - ey, p);
  const onePlusEy = mod(1n + ey, p);
  const invOneMinusEy = modInverse(oneMinusEy, p);
  const wx = modAdd(modMul(onePlusEy, invOneMinusEy, p), delta, p);
  const wy = modMul(modMul(c_const, onePlusEy, p), modInverse(modMul(oneMinusEy, ex, p), p), p);
  return [wx, wy];
}

function weierstrassDouble(x, y) {
  const num = modAdd(modMul(3n, modMul(x, x, p), p), a_const, p);
  const den = modInverse(modMul(2n, y, p), p);
  const lam = modMul(num, den, p);
  const x3 = mod(modMul(lam, lam, p) - modMul(2n, x, p), p);
  const y3 = mod(modMul(lam, mod(x - x3, p), p) - y, p);
  return [x3, y3];
}

function ecPow128(wx, wy) {
  let x = wx, y = wy;
  for (let i = 0; i < 128; i++) [x, y] = weierstrassDouble(x, y);
  return [x, y];
}

function swap256(val) {
  const bytes = new Uint8Array(32);
  let v = val;
  for (let i = 0; i < 32; i++) { bytes[i] = Number(v & 0xffn); v >>= 8n; }
  let result = 0n;
  for (let i = 0; i < 32; i++) result = (result << 8n) | BigInt(bytes[i]);
  return result;
}

function hexToBytes(hex) {
  const clean = hex.startsWith("0x") ? hex.slice(2) : hex;
  const bytes = new Uint8Array(clean.length / 2);
  for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  return bytes;
}

function bytesToBigInt(bytes) {
  let result = 0n;
  for (const b of bytes) result = (result << 8n) | BigInt(b);
  return result;
}

function bytesToHex(bytes) {
  return Array.from(bytes).map(b => b.toString(16).padStart(2, "0")).join("");
}

// ── Compute extKpub ─────────────────────────────────────────────────────
function computeExtKpub(pubkeyHex) {
  const rawPoint = ed25519.Point.fromHex(pubkeyHex);
  // Newer @noble/curves uses .x/.y for affine coordinates directly
  const ex = rawPoint.x;
  const ey = rawPoint.y;

  const [wx, wy] = edwards2Weierstrass(ex, ey);
  const [wx128, wy128] = ecPow128(wx, wy);

  const compressed = ey + ((ex & 1n) << 255n);
  const compressedLE = swap256(compressed);

  return [wx, wy, wx128, wy128, compressedLE];
}

// ── Main ────────────────────────────────────────────────────────────────
async function main() {
  console.log("=== Ed25519 Sepolia E2E Test ===\n");

  // 1. Derive keypair
  const privBytes = hexToBytes(SECRET_HEX);
  const pubBytes = ed25519.getPublicKey(privBytes);
  const pubHex = bytesToHex(pubBytes);
  console.log("Public key:", pubHex);
  console.log("Public key (bytes32):", "0x" + pubHex);

  // 2. Connect to Sepolia and fetch nonce
  const provider = new ethers.JsonRpcProvider(RPC_URL);
  const registry = new ethers.Contract(REGISTRY_ADDRESS, [
    "function ed25519Nonce(bytes32) view returns (uint256)",
    "function isVerifiedAgent(bytes32) view returns (bool)",
    "function getAgentId(bytes32) view returns (uint256)",
  ], provider);

  const nonce = await registry.ed25519Nonce("0x" + pubHex);
  console.log("On-chain nonce:", nonce.toString());

  // 3. Compute challenge hash
  const challengeHash = ethers.keccak256(
    ethers.solidityPacked(
      ["string", "address", "uint256", "address", "uint256"],
      ["self-agent-id:register-ed25519:", HUMAN_ADDRESS, CHAIN_ID, REGISTRY_ADDRESS, nonce]
    )
  );
  console.log("Challenge hash:", challengeHash);

  // 4. Sign with Ed25519
  const msgBytes = hexToBytes(challengeHash);
  const sigBytes = ed25519.sign(msgBytes, privBytes);
  const sigHex = bytesToHex(sigBytes);
  console.log("Signature (128 hex):", sigHex);
  console.log("Sig length:", sigHex.length, "chars");

  // Split into R and S (each 32 bytes = 64 hex chars)
  const sigR = sigHex.slice(0, 64);
  const sigS = sigHex.slice(64, 128);
  console.log("Sig R:", sigR);
  console.log("Sig S:", sigS);

  // 5. Verify signature locally
  const verified = ed25519.verify(sigBytes, msgBytes, pubBytes);
  console.log("\nLocal Ed25519 verify:", verified);
  if (!verified) {
    console.error("ERROR: Local verification failed!");
    process.exit(1);
  }

  // 6. Compute extKpub
  const extKpub = computeExtKpub(pubHex);
  console.log("\nextKpub[0] (Wx):", extKpub[0].toString(16).padStart(64, "0"));
  console.log("extKpub[1] (Wy):", extKpub[1].toString(16).padStart(64, "0"));
  console.log("extKpub[2] (Wx128):", extKpub[2].toString(16).padStart(64, "0"));
  console.log("extKpub[3] (Wy128):", extKpub[3].toString(16).padStart(64, "0"));
  console.log("extKpub[4] (compLE):", extKpub[4].toString(16).padStart(64, "0"));

  // 7. Build userData
  const configIndex = 0;
  const guardian = "0".repeat(40);
  const extKpubHex = extKpub.map(v => v.toString(16).padStart(64, "0")).join("");
  const userData = "E" + configIndex + pubHex + sigHex + extKpubHex + guardian;
  console.log("\nuserData length:", userData.length, "(expected: 554)");
  console.log("userData (first 100 chars):", userData.slice(0, 100) + "...");

  if (userData.length !== 554) {
    console.error("ERROR: userData length mismatch!");
    process.exit(1);
  }

  // 8. Derive expected agent address
  const derivedAddress = ethers.getAddress(
    "0x" + ethers.keccak256("0x" + pubHex).slice(-40)
  );
  console.log("\nDerived agent address:", derivedAddress);

  // 9. Check current registration status
  const isVerified = await registry.isVerifiedAgent("0x" + pubHex);
  const agentId = await registry.getAgentId("0x" + pubHex);
  console.log("\nCurrent on-chain status:");
  console.log("  isVerified:", isVerified);
  console.log("  agentId:", agentId.toString());

  console.log("\n=== SUCCESS: All data generated correctly ===");
  console.log("This userData would be passed to the Self app as userDefinedData.");
  console.log("When the human scans their passport, the Hub V2 callback will");
  console.log("pass this userData to customVerificationHook, which will:");
  console.log("  1. Parse the Ed25519 pubkey, signature, and extKpub from userData");
  console.log("  2. Reconstruct the challenge hash");
  console.log("  3. Verify the Ed25519 signature on-chain (~990K gas)");
  console.log("  4. Mint an NFT to the derived address:", derivedAddress);
  console.log("  5. Store the pubkey as the agentKey");
}

main().catch(err => {
  console.error("FATAL:", err);
  process.exit(1);
});
