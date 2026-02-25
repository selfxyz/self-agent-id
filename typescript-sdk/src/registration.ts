// SPDX-FileCopyrightText: 2025-2026 Social Connect Labs, Inc.
// SPDX-License-Identifier: BUSL-1.1
// NOTE: Converts to Apache-2.0 on 2029-06-11 per LICENSE.

import { ethers } from "ethers";

export type RegistrationMode =
  | "verified-wallet"
  | "agent-identity"
  | "wallet-free"
  | "smart-wallet";

export interface RegistrationDisclosures {
  minimumAge?: 0 | 18 | 21;
  ofac?: boolean;
}

export interface RegistrationChallengeInput {
  humanIdentifier: string;
  chainId: number | bigint | string;
  registryAddress: string;
}

export interface RegistrationSignatureParts {
  r: string;
  s: string;
  v: number;
}

export interface SignedRegistrationChallenge extends RegistrationSignatureParts {
  messageHash: string;
  signature: string;
  agentAddress: string;
}

const ACTION = {
  REGISTER: 0x01,
  DEREGISTER: 0x02,
  REGISTER_ADVANCED: 0x03,
  DEREGISTER_ADVANCED: 0x04,
  REGISTER_WALLET_FREE: 0x05,
} as const;

const ASCII_ACTION = {
  REGISTER: "R",
  DEREGISTER: "D",
  REGISTER_ADVANCED: "K",
  DEREGISTER_ADVANCED: "X",
  REGISTER_WALLET_FREE: "W",
} as const;

function normalizeAddress(address: string): string {
  return ethers.getAddress(address);
}

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

function assertConfigIndex(idx: number): void {
  if (!Number.isInteger(idx) || idx < 0 || idx > 5) {
    throw new Error(`Invalid config index: ${idx}. Expected 0..5.`);
  }
}

function normalizeV(v: number): number {
  if (v === 27 || v === 28) return v;
  if (v === 0 || v === 1) return v + 27;
  throw new Error(`Invalid signature v: ${v}`);
}

function signatureParts(signature: string | RegistrationSignatureParts): RegistrationSignatureParts {
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

function addressHex(address: string): string {
  return normalizeAddress(address).slice(2).toLowerCase();
}

function configDigit(configIndex: number): string {
  assertConfigIndex(configIndex);
  return String(configIndex);
}

function numberToOneByte(value: number): Uint8Array {
  if (!Number.isInteger(value) || value < 0 || value > 255) {
    throw new Error(`Invalid one-byte value: ${value}`);
  }
  return Uint8Array.from([value]);
}

function bytes32(value: string): Uint8Array {
  const b = ethers.getBytes(value);
  if (b.length !== 32) {
    throw new Error(`Expected 32 bytes, got ${b.length}`);
  }
  return b;
}

export function getRegistrationConfigIndex(disclosures: RegistrationDisclosures = {}): number {
  return toConfigIndex(disclosures);
}

export function computeRegistrationChallengeHash(input: RegistrationChallengeInput): string {
  const human = normalizeAddress(input.humanIdentifier);
  const registry = normalizeAddress(input.registryAddress);
  const chainId = BigInt(input.chainId);

  return ethers.keccak256(
    ethers.solidityPacked(
      ["string", "address", "uint256", "address"],
      ["self-agent-id:register:", human, chainId, registry]
    )
  );
}

export async function signRegistrationChallenge(
  agentPrivateKey: string,
  input: RegistrationChallengeInput
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

export function buildSimpleRegisterUserDataAscii(disclosures: RegistrationDisclosures = {}): string {
  const idx = configDigit(toConfigIndex(disclosures));
  return ASCII_ACTION.REGISTER + idx;
}

export function buildSimpleDeregisterUserDataAscii(disclosures: RegistrationDisclosures = {}): string {
  const idx = configDigit(toConfigIndex(disclosures));
  return ASCII_ACTION.DEREGISTER + idx;
}

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
  return ASCII_ACTION.DEREGISTER_ADVANCED + idx + addressHex(params.agentAddress);
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

export function buildSimpleRegisterUserDataBinary(disclosures: RegistrationDisclosures = {}): string {
  const idx = toConfigIndex(disclosures);
  assertConfigIndex(idx);
  return ethers.concat([numberToOneByte(ACTION.REGISTER), numberToOneByte(idx)]);
}

export function buildSimpleDeregisterUserDataBinary(disclosures: RegistrationDisclosures = {}): string {
  const idx = toConfigIndex(disclosures);
  assertConfigIndex(idx);
  return ethers.concat([numberToOneByte(ACTION.DEREGISTER), numberToOneByte(idx)]);
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
  const guardian = normalizeAddress(params.guardianAddress ?? ethers.ZeroAddress);

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
