// SPDX-FileCopyrightText: 2025-2026 Social Connect Labs, Inc.
// SPDX-License-Identifier: BUSL-1.1
// NOTE: Converts to Apache-2.0 on 2029-06-11 per LICENSE.

/**
 * Low-level registration helpers: config index, challenge signing and Self `userData` encoders.
 *
 * Each encoder has an ASCII form (what the Self app QR carries) and a binary form
 * (compact bytes); both must match what SelfAgentRegistry decodes on-chain.
 */

import { ethers } from "ethers";

/**
 * The registration modes accepted by the Self Agent ID API (`POST /api/agent/register`).
 *
 * - `"linked"` -- a generated agent key linked to the human's wallet (`humanAddress` required).
 * - `"wallet-free"` -- a generated agent key; no human wallet required.
 * - `"ed25519"` -- the agent's own Ed25519 key; no human wallet required.
 * - `"ed25519-linked"` -- the agent's own Ed25519 key linked to the human's wallet.
 * - `"privy"` -- like `linked`, for a Privy-managed human wallet.
 * - `"smartwallet"` -- like `linked`, for a smart-wallet human account.
 */
export type RegistrationMode =
  | "linked"
  | "wallet-free"
  | "ed25519"
  | "ed25519-linked"
  | "privy"
  | "smartwallet";

/**
 * Disclosure requirements that map to a verification config index (0..5)
 * on the SelfAgentRegistry contract.
 */
export interface RegistrationDisclosures {
  /** Minimum age gate: 0 (none, default), 18, or 21 */
  minimumAge?: 0 | 18 | 21;
  /** Require OFAC screening (default false) */
  ofac?: boolean;
}

/** Input for computing or signing a registration challenge hash. */
export interface RegistrationChallengeInput {
  /** The human's on-chain address (checksummed or not) */
  humanIdentifier: string;
  /** Target chain ID (e.g. 42220 for Celo mainnet) */
  chainId: number | bigint | string;
  /** Deployed SelfAgentRegistry contract address */
  registryAddress: string;
  /** The agent's current nonce from `agentNonces(agent)`; 0 for a first registration */
  nonce: number | bigint | string;
}

/** The r, s, v components of an ECDSA signature. */
export interface RegistrationSignatureParts {
  /** 32-byte hex string with 0x prefix */
  r: string;
  /** 32-byte hex string with 0x prefix */
  s: string;
  /** Recovery parameter (27 or 28; 0/1 are accepted and normalized) */
  v: number;
}

/** Result of signing a registration challenge: full signature plus r/s/v parts. */
export interface SignedRegistrationChallenge extends RegistrationSignatureParts {
  /** The keccak256 challenge hash that was signed */
  messageHash: string;
  /** The full 65-byte hex-encoded signature */
  signature: string;
  /** Checksummed agent address derived from the signing key */
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
 * Checksum an Ethereum address using EIP-55.
 *
 * @param address - Raw or checksummed address string.
 * @returns The checksummed address.
 * @throws If the address is invalid.
 */
function normalizeAddress(address: string): string {
  return ethers.getAddress(address);
}

/**
 * Map disclosure requirements to a verification config index (0..5).
 *
 * Only 0, 18 and 21 are valid `minimumAge` values (on-chain configs). Index mapping:
 * - 0: no age gate, no OFAC
 * - 1: age >= 18, no OFAC
 * - 2: age >= 21, no OFAC
 * - 3: no age gate, OFAC
 * - 4: age >= 18, OFAC
 * - 5: age >= 21, OFAC
 *
 * @param disclosures - The disclosure requirements.
 * @returns The config index (0..5).
 * @throws If `minimumAge` is not 0, 18 or 21 (instead of silently dropping the age gate).
 */
function toConfigIndex(disclosures: RegistrationDisclosures): number {
  const minimumAge: number = disclosures.minimumAge ?? 0;
  const ofac = disclosures.ofac ?? false;

  if (minimumAge !== 0 && minimumAge !== 18 && minimumAge !== 21) {
    throw new Error(
      `Unsupported minimumAge: ${String(minimumAge)}. Expected 0 (no age gate), 18 or 21.`,
    );
  }

  if (minimumAge === 18 && ofac) return 4;
  if (minimumAge === 21 && ofac) return 5;
  if (minimumAge === 18) return 1;
  if (minimumAge === 21) return 2;
  if (ofac) return 3;
  return 0;
}

/**
 * Validate that a config index is an integer in the range 0..5.
 *
 * @param idx - The config index to validate.
 * @throws If the index is out of range.
 */
function assertConfigIndex(idx: number): void {
  if (!Number.isInteger(idx) || idx < 0 || idx > 5) {
    throw new Error(`Invalid config index: ${idx}. Expected 0..5.`);
  }
}

/**
 * Normalize an ECDSA recovery parameter to the canonical 27/28 form.
 *
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
 * Split a full hex signature into r/s/v, or normalize an existing parts object.
 *
 * @param signature - Full hex signature or pre-split parts.
 * @returns Normalized signature parts with canonical v.
 * @throws If the signature is malformed or v is not 0/1/27/28.
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
 * Return the lowercase hex of an address without the 0x prefix.
 *
 * @param address - Ethereum address.
 * @returns 40-character lowercase hex string.
 * @throws If the address is invalid.
 */
function addressHex(address: string): string {
  return normalizeAddress(address).slice(2).toLowerCase();
}

/**
 * Convert a config index to its single-digit ASCII form after validation.
 *
 * @param configIndex - Config index (0..5).
 * @returns Single-character string ("0".."5").
 * @throws If the config index is invalid.
 */
function configDigit(configIndex: number): string {
  assertConfigIndex(configIndex);
  return String(configIndex);
}

/**
 * Encode a single integer (0..255) as a one-byte Uint8Array.
 *
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
 * Decode a hex string into a Uint8Array, asserting exactly 32 bytes.
 *
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
 * Return the on-chain verification config index for the given disclosure requirements.
 *
 * @param disclosures - Disclosure requirements (defaults to no age gate, no OFAC).
 * @returns Config index in range 0..5.
 * @throws If `minimumAge` is not 0, 18 or 21.
 */
export function getRegistrationConfigIndex(
  disclosures: RegistrationDisclosures = {},
): number {
  return toConfigIndex(disclosures);
}

/**
 * Compute the keccak256 challenge hash that an agent must sign to prove
 * ownership of its private key during advanced/wallet-free registration.
 *
 * The hash is `keccak256(abi.encodePacked("self-agent-id:register:", human, chainId, registry, nonce))`.
 *
 * @param input - Human address, chain ID, registry address, and agent nonce.
 * @returns The 32-byte keccak256 hash as a hex string.
 * @throws If either address is invalid.
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
 * Sign the registration challenge hash (EIP-191 personal sign) with the agent's private key.
 *
 * @param agentPrivateKey - Hex-encoded private key of the agent wallet.
 * @param input - Human address, chain ID, registry address and agent nonce.
 * @returns The signed challenge: message hash, full signature, r/s/v parts and agent address.
 * @throws If the private key or an address is invalid.
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
 * Build ASCII userData for a simple registration (agent key = human wallet address).
 * Format: `"R" + configDigit`.
 *
 * @param disclosures - Disclosure requirements (defaults to none).
 * @returns Two-character ASCII userData string.
 * @throws If `minimumAge` is not 0, 18 or 21.
 */
export function buildSimpleRegisterUserDataAscii(
  disclosures: RegistrationDisclosures = {},
): string {
  const idx = configDigit(toConfigIndex(disclosures));
  return ASCII_ACTION.REGISTER + idx;
}

/**
 * Build ASCII userData for a simple deregistration (also used to deregister wallet-free agents).
 * Format: `"D" + configDigit`.
 *
 * @param disclosures - Disclosure requirements (defaults to none).
 * @returns Two-character ASCII userData string.
 * @throws If `minimumAge` is not 0, 18 or 21.
 */
export function buildSimpleDeregisterUserDataAscii(
  disclosures: RegistrationDisclosures = {},
): string {
  const idx = configDigit(toConfigIndex(disclosures));
  return ASCII_ACTION.DEREGISTER + idx;
}

/**
 * Build ASCII userData for an advanced (linked) registration.
 * Format: `"K" + configDigit + agentAddressHex(40) + r(64) + s(64) + v(2)`.
 *
 * @param params - Encoder input.
 * @param params.agentAddress - The delegated agent's Ethereum address.
 * @param params.signature - Agent's signature over the registration challenge (hex or r/s/v parts).
 * @param params.disclosures - Disclosure requirements (defaults to none).
 * @returns ASCII userData string (172 characters).
 * @throws If the address or signature is invalid, or `minimumAge` is not 0, 18 or 21.
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

/**
 * Build ASCII userData for an advanced (linked) deregistration.
 * Format: `"X" + configDigit + agentAddressHex(40)`.
 *
 * @param params - Encoder input.
 * @param params.agentAddress - The agent's Ethereum address.
 * @param params.disclosures - Disclosure requirements (defaults to none).
 * @returns ASCII userData string (42 characters).
 * @throws If the address is invalid, or `minimumAge` is not 0, 18 or 21.
 */
export function buildAdvancedDeregisterUserDataAscii(params: {
  agentAddress: string;
  disclosures?: RegistrationDisclosures;
}): string {
  const idx = configDigit(toConfigIndex(params.disclosures ?? {}));
  return (
    ASCII_ACTION.DEREGISTER_ADVANCED + idx + addressHex(params.agentAddress)
  );
}

/**
 * Build ASCII userData for a wallet-free registration (the agent owns its own NFT).
 * Format: `"W" + configDigit + agentAddressHex(40) + guardianHex(40) + r(64) + s(64) + v(2)`.
 *
 * @param params - Encoder input.
 * @param params.agentAddress - The agent's Ethereum address.
 * @param params.guardianAddress - Optional guardian address (zero address when omitted).
 * @param params.signature - Agent's signature over the registration challenge (hex or r/s/v parts).
 * @param params.disclosures - Disclosure requirements (defaults to none).
 * @returns ASCII userData string (212 characters).
 * @throws If an address or the signature is invalid, or `minimumAge` is not 0, 18 or 21.
 */
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

/**
 * Build binary userData for a simple registration: `0x01 + configIndex`.
 *
 * @param disclosures - Disclosure requirements (defaults to none).
 * @returns 2-byte hex string.
 * @throws If `minimumAge` is not 0, 18 or 21.
 */
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

/**
 * Build binary userData for a simple deregistration: `0x02 + configIndex`.
 *
 * @param disclosures - Disclosure requirements (defaults to none).
 * @returns 2-byte hex string.
 * @throws If `minimumAge` is not 0, 18 or 21.
 */
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

/**
 * Build binary userData for an advanced (linked) registration:
 * `0x03 + configIndex + agentAddress(20) + r(32) + s(32) + v(1)`.
 *
 * @param params - Encoder input.
 * @param params.agentAddress - The delegated agent's Ethereum address.
 * @param params.signature - Agent's signature over the registration challenge (hex or r/s/v parts).
 * @param params.disclosures - Disclosure requirements (defaults to none).
 * @returns 87-byte hex string.
 * @throws If the address or signature is invalid, or `minimumAge` is not 0, 18 or 21.
 */
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

/**
 * Build binary userData for an advanced (linked) deregistration:
 * `0x04 + configIndex + agentAddress(20)`.
 *
 * @param params - Encoder input.
 * @param params.agentAddress - The agent's Ethereum address.
 * @param params.disclosures - Disclosure requirements (defaults to none).
 * @returns 22-byte hex string.
 * @throws If the address is invalid, or `minimumAge` is not 0, 18 or 21.
 */
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

/**
 * Build binary userData for a wallet-free registration:
 * `0x05 + configIndex + agentAddress(20) + guardian(20) + r(32) + s(32) + v(1)`.
 *
 * @param params - Encoder input.
 * @param params.agentAddress - The agent's Ethereum address.
 * @param params.guardianAddress - Optional guardian address (zero address when omitted).
 * @param params.signature - Agent's signature over the registration challenge (hex or r/s/v parts).
 * @param params.disclosures - Disclosure requirements (defaults to none).
 * @returns 107-byte hex string.
 * @throws If an address or the signature is invalid, or `minimumAge` is not 0, 18 or 21.
 */
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
