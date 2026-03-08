// SPDX-FileCopyrightText: 2025-2026 Social Connect Labs, Inc.
// SPDX-License-Identifier: BUSL-1.1
// NOTE: Converts to Apache-2.0 on 2029-06-11 per LICENSE.

import { ethers } from "ethers";

/**
 * The supported registration modes for the SelfAgentRegistry.
 *
 * - `"self-custody"` -- human address equals agent address (simple register).
 * - `"linked"` -- human delegates to a separate agent address (advanced register).
 * - `"wallet-free"` -- agent key is generated; no prior wallet required.
 * - `"ed25519"` -- like wallet-free but uses Ed25519 key instead of secp256k1.
 * - `"ed25519-linked"` -- Ed25519 agent key linked to a human's wallet.
 * - `"smartwallet"` -- like wallet-free but intended for smart-wallet deployment.
 */
export type RegistrationMode =
  | "wallet-free"
  | "ed25519"
  | "self-custody"
  | "linked"
  | "ed25519-linked"
  | "smartwallet";

/**
 * Disclosure requirements that map to a verification config index (0..5)
 * on the SelfAgentRegistry contract.
 *
 * @param minimumAge - Minimum age gate: 0 (none), 18, or 21.
 * @param ofac - Whether OFAC screening is required.
 */
export interface RegistrationDisclosures {
  minimumAge?: 0 | 18 | 21;
  ofac?: boolean;
}

/**
 * Input for computing or signing a registration challenge hash.
 *
 * @param humanIdentifier - The human's on-chain address (checksummed or not).
 * @param chainId - Target chain ID (e.g. 42220 for Celo mainnet).
 * @param registryAddress - Deployed SelfAgentRegistry contract address.
 * @param nonce - The agent's current registration nonce from `agentNonces(agent)`. Use 0 for first-time registrations.
 */
export interface RegistrationChallengeInput {
  humanIdentifier: string;
  chainId: number | bigint | string;
  registryAddress: string;
  nonce: number | bigint | string;
}

/**
 * The r, s, v components of an ECDSA signature.
 *
 * @param r - The r component (32-byte hex string with 0x prefix).
 * @param s - The s component (32-byte hex string with 0x prefix).
 * @param v - Recovery parameter (27 or 28).
 */
export interface RegistrationSignatureParts {
  r: string;
  s: string;
  v: number;
}

/**
 * Result of signing a registration challenge, including the full signature
 * and its decomposed r/s/v parts.
 *
 * @param messageHash - The keccak256 challenge hash that was signed.
 * @param signature - The full 65-byte hex-encoded signature.
 * @param agentAddress - The checksummed agent address derived from the signing key.
 */
export interface SignedRegistrationChallenge extends RegistrationSignatureParts {
  messageHash: string;
  signature: string;
  agentAddress: string;
}

/** Binary action bytes used in the compact binary userData encoding. */
const ACTION = {
  REGISTER: 0x01,
  DEREGISTER: 0x02,
  REGISTER_ADVANCED: 0x03,
  DEREGISTER_ADVANCED: 0x04,
  REGISTER_WALLET_FREE: 0x05,
} as const;

/** ASCII action characters used in the human-readable userData encoding. */
const ASCII_ACTION = {
  REGISTER: "R",
  DEREGISTER: "D",
  REGISTER_ADVANCED: "K",
  DEREGISTER_ADVANCED: "X",
  REGISTER_WALLET_FREE: "W",
} as const;

/**
 * Checksums an Ethereum address using EIP-55.
 * @param address - Raw or checksummed address string.
 * @returns The checksummed address.
 * @throws If the address is invalid.
 */
function normalizeAddress(address: string): string {
  return ethers.getAddress(address);
}

/**
 * Maps disclosure requirements to a verification config index (0..5).
 *
 * Index mapping:
 * - 0: no age gate, no OFAC
 * - 1: age >= 18, no OFAC
 * - 2: age >= 21, no OFAC
 * - 3: no age gate, OFAC
 * - 4: age >= 18, OFAC
 * - 5: age >= 21, OFAC
 *
 * @param disclosures - The disclosure requirements.
 * @returns The config index (0..5).
 */
function toConfigIndex(disclosures: RegistrationDisclosures): number {
  const minimumAge = disclosures.minimumAge ?? 0;
  const ofac = disclosures.ofac ?? false;

  if (minimumAge === 18 && ofac) return 4;
  if (minimumAge === 21 && ofac) return 5;
  if (minimumAge === 18) return 1;
  if (minimumAge === 21) return 2;
  if (ofac) return 3;
  return 0;
}

/**
 * Validates that a config index is an integer in the range 0..5.
 * @param idx - The config index to validate.
 * @throws If the index is out of range.
 */
function assertConfigIndex(idx: number): void {
  if (!Number.isInteger(idx) || idx < 0 || idx > 5) {
    throw new Error(`Invalid config index: ${idx}. Expected 0..5.`);
  }
}

/**
 * Normalizes an ECDSA recovery parameter to the canonical 27/28 form.
 * @param v - Recovery parameter (0, 1, 27, or 28).
 * @returns Normalized v (27 or 28).
 * @throws If v is not a recognized recovery value.
 */
function normalizeV(v: number): number {
  if (v === 27 || v === 28) return v;
  if (v === 0 || v === 1) return v + 27;
  throw new Error(`Invalid signature v: ${v}`);
}

/**
 * Extracts or normalizes r/s/v signature parts from a full hex signature string
 * or an existing parts object.
 * @param signature - Full hex signature or pre-split parts.
 * @returns Normalized signature parts with canonical v.
 */
function signatureParts(
  signature: string | RegistrationSignatureParts,
): RegistrationSignatureParts {
  if (typeof signature === "string") {
    const sig = ethers.Signature.from(signature);
    return { r: sig.r, s: sig.s, v: normalizeV(sig.v) };
  }

  return {
    r: signature.r,
    s: signature.s,
    v: normalizeV(signature.v),
  };
}

/**
 * Returns the lowercase hex representation of an address without the 0x prefix.
 * @param address - Ethereum address.
 * @returns 40-character lowercase hex string.
 */
function addressHex(address: string): string {
  return normalizeAddress(address).slice(2).toLowerCase();
}

/**
 * Converts a config index to its single-digit ASCII representation after validation.
 * @param configIndex - Config index (0..5).
 * @returns Single-character string ("0".."5").
 * @throws If the config index is invalid.
 */
function configDigit(configIndex: number): string {
  assertConfigIndex(configIndex);
  return String(configIndex);
}

/**
 * Encodes a single integer (0..255) as a one-byte Uint8Array.
 * @param value - Integer in the range 0..255.
 * @returns Single-element Uint8Array.
 * @throws If the value is not a valid unsigned byte.
 */
function numberToOneByte(value: number): Uint8Array {
  if (!Number.isInteger(value) || value < 0 || value > 255) {
    throw new Error(`Invalid one-byte value: ${value}`);
  }
  return Uint8Array.from([value]);
}

/**
 * Decodes a hex string into a Uint8Array, asserting exactly 32 bytes.
 * @param value - Hex-encoded 32-byte value (with or without 0x prefix).
 * @returns 32-byte Uint8Array.
 * @throws If the decoded length is not exactly 32.
 */
function bytes32(value: string): Uint8Array {
  const b = ethers.getBytes(value);
  if (b.length !== 32) {
    throw new Error(`Expected 32 bytes, got ${b.length}`);
  }
  return b;
}

/**
 * Returns the on-chain verification config index for the given disclosure requirements.
 * @param disclosures - Disclosure requirements (defaults to no age gate, no OFAC).
 * @returns Config index in range 0..5.
 */
export function getRegistrationConfigIndex(
  disclosures: RegistrationDisclosures = {},
): number {
  return toConfigIndex(disclosures);
}

/**
 * Computes the keccak256 challenge hash that an agent must sign to prove
 * ownership of its private key during advanced/wallet-free registration.
 *
 * The hash is `keccak256(abi.encodePacked("self-agent-id:register:", human, chainId, registry, nonce))`.
 *
 * @param input - Human address, chain ID, registry address, and agent nonce.
 * @returns The 32-byte keccak256 hash as a hex string.
 */
export function computeRegistrationChallengeHash(
  input: RegistrationChallengeInput,
): string {
  const human = normalizeAddress(input.humanIdentifier);
  const registry = normalizeAddress(input.registryAddress);
  const chainId = BigInt(input.chainId);
  const nonce = BigInt(input.nonce);

  return ethers.keccak256(
    ethers.solidityPacked(
      ["string", "address", "uint256", "address", "uint256"],
      ["self-agent-id:register:", human, chainId, registry, nonce],
    ),
  );
}

/**
 * Signs the registration challenge hash with the given agent private key.
 *
 * @param agentPrivateKey - Hex-encoded private key of the agent wallet.
 * @param input - Challenge input containing human address, chain ID, and registry address.
 * @returns The signed challenge including message hash, full signature, r/s/v parts, and agent address.
 */
export async function signRegistrationChallenge(
  agentPrivateKey: string,
  input: RegistrationChallengeInput,
): Promise<SignedRegistrationChallenge> {
  const wallet = new ethers.Wallet(agentPrivateKey);
  const messageHash = computeRegistrationChallengeHash(input);
  const signature = await wallet.signMessage(ethers.getBytes(messageHash));
  const sig = ethers.Signature.from(signature);

  return {
    messageHash,
    signature,
    r: sig.r,
    s: sig.s,
    v: normalizeV(sig.v),
    agentAddress: wallet.address,
  };
}

/**
 * Builds ASCII-encoded userData for a simple (self-custody) registration.
 * Format: `"R" + configDigit`.
 *
 * @param disclosures - Disclosure requirements (defaults to none).
 * @returns Two-character ASCII userData string.
 */
export function buildSimpleRegisterUserDataAscii(
  disclosures: RegistrationDisclosures = {},
): string {
  const idx = configDigit(toConfigIndex(disclosures));
  return ASCII_ACTION.REGISTER + idx;
}

/**
 * Builds ASCII-encoded userData for a simple (self-custody) deregistration.
 * Format: `"D" + configDigit`.
 *
 * @param disclosures - Disclosure requirements (defaults to none).
 * @returns Two-character ASCII userData string.
 */
export function buildSimpleDeregisterUserDataAscii(
  disclosures: RegistrationDisclosures = {},
): string {
  const idx = configDigit(toConfigIndex(disclosures));
  return ASCII_ACTION.DEREGISTER + idx;
}

/**
 * Builds ASCII-encoded userData for an advanced (linked) registration.
 * Format: `"K" + configDigit + agentAddressHex(40) + r(64) + s(64) + v(2)`.
 *
 * @param params.agentAddress - The delegated agent's Ethereum address.
 * @param params.signature - Full hex signature or pre-split r/s/v parts.
 * @param params.disclosures - Disclosure requirements (defaults to none).
 * @returns ASCII userData string (172 characters).
 */
export function buildAdvancedRegisterUserDataAscii(params: {
  agentAddress: string;
  signature: string | RegistrationSignatureParts;
  disclosures?: RegistrationDisclosures;
}): string {
  const idx = configDigit(toConfigIndex(params.disclosures ?? {}));
  const sig = signatureParts(params.signature);

  return (
    ASCII_ACTION.REGISTER_ADVANCED +
    idx +
    addressHex(params.agentAddress) +
    sig.r.slice(2).toLowerCase() +
    sig.s.slice(2).toLowerCase() +
    sig.v.toString(16).padStart(2, "0")
  );
}

export function buildAdvancedDeregisterUserDataAscii(params: {
  agentAddress: string;
  disclosures?: RegistrationDisclosures;
}): string {
  const idx = configDigit(toConfigIndex(params.disclosures ?? {}));
  return (
    ASCII_ACTION.DEREGISTER_ADVANCED + idx + addressHex(params.agentAddress)
  );
}

export function buildWalletFreeRegisterUserDataAscii(params: {
  agentAddress: string;
  guardianAddress?: string;
  signature: string | RegistrationSignatureParts;
  disclosures?: RegistrationDisclosures;
}): string {
  const idx = configDigit(toConfigIndex(params.disclosures ?? {}));
  const guardian = params.guardianAddress
    ? addressHex(params.guardianAddress)
    : "0".repeat(40);
  const sig = signatureParts(params.signature);

  return (
    ASCII_ACTION.REGISTER_WALLET_FREE +
    idx +
    addressHex(params.agentAddress) +
    guardian +
    sig.r.slice(2).toLowerCase() +
    sig.s.slice(2).toLowerCase() +
    sig.v.toString(16).padStart(2, "0")
  );
}

export function buildSimpleRegisterUserDataBinary(
  disclosures: RegistrationDisclosures = {},
): string {
  const idx = toConfigIndex(disclosures);
  assertConfigIndex(idx);
  return ethers.concat([
    numberToOneByte(ACTION.REGISTER),
    numberToOneByte(idx),
  ]);
}

export function buildSimpleDeregisterUserDataBinary(
  disclosures: RegistrationDisclosures = {},
): string {
  const idx = toConfigIndex(disclosures);
  assertConfigIndex(idx);
  return ethers.concat([
    numberToOneByte(ACTION.DEREGISTER),
    numberToOneByte(idx),
  ]);
}

export function buildAdvancedRegisterUserDataBinary(params: {
  agentAddress: string;
  signature: string | RegistrationSignatureParts;
  disclosures?: RegistrationDisclosures;
}): string {
  const idx = toConfigIndex(params.disclosures ?? {});
  assertConfigIndex(idx);
  const sig = signatureParts(params.signature);

  return ethers.concat([
    numberToOneByte(ACTION.REGISTER_ADVANCED),
    numberToOneByte(idx),
    ethers.getBytes(normalizeAddress(params.agentAddress)),
    bytes32(sig.r),
    bytes32(sig.s),
    numberToOneByte(sig.v),
  ]);
}

export function buildAdvancedDeregisterUserDataBinary(params: {
  agentAddress: string;
  disclosures?: RegistrationDisclosures;
}): string {
  const idx = toConfigIndex(params.disclosures ?? {});
  assertConfigIndex(idx);

  return ethers.concat([
    numberToOneByte(ACTION.DEREGISTER_ADVANCED),
    numberToOneByte(idx),
    ethers.getBytes(normalizeAddress(params.agentAddress)),
  ]);
}

export function buildWalletFreeRegisterUserDataBinary(params: {
  agentAddress: string;
  guardianAddress?: string;
  signature: string | RegistrationSignatureParts;
  disclosures?: RegistrationDisclosures;
}): string {
  const idx = toConfigIndex(params.disclosures ?? {});
  assertConfigIndex(idx);
  const sig = signatureParts(params.signature);
  const guardian = normalizeAddress(
    params.guardianAddress ?? ethers.ZeroAddress,
  );

  return ethers.concat([
    numberToOneByte(ACTION.REGISTER_WALLET_FREE),
    numberToOneByte(idx),
    ethers.getBytes(normalizeAddress(params.agentAddress)),
    ethers.getBytes(guardian),
    bytes32(sig.r),
    bytes32(sig.s),
    numberToOneByte(sig.v),
  ]);
}
