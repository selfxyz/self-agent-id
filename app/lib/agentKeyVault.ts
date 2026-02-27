// SPDX-FileCopyrightText: 2025-2026 Social Connect Labs, Inc.
// SPDX-License-Identifier: BUSL-1.1
// NOTE: Converts to Apache-2.0 on 2029-06-11 per LICENSE.

const STORAGE_KEY = "self-agent-id:agent-key-v1";

type StoredAgentKey = {
  agentAddress: string;
  privateKey: string;
  guardianAddress?: string;
  updatedAt: number;
};

type StoredAgentKeyMap = Record<string, StoredAgentKey>;

function normalizeAddress(address: string): string {
  return address.trim().toLowerCase();
}

function normalizePrivateKey(privateKey: string): string {
  const trimmed = privateKey.trim();
  return trimmed.startsWith("0x") ? trimmed : `0x${trimmed}`;
}

function readVault(): StoredAgentKeyMap {
  if (typeof window === "undefined") return {};
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as StoredAgentKeyMap;
    if (!parsed || typeof parsed !== "object") return {};
    return parsed;
  } catch {
    return {};
  }
}

function writeVault(vault: StoredAgentKeyMap): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(vault));
}

export function saveAgentPrivateKey(params: {
  agentAddress: string;
  privateKey: string;
  guardianAddress?: string;
}): void {
  if (typeof window === "undefined") return;
  const agentAddress = normalizeAddress(params.agentAddress);
  const privateKey = normalizePrivateKey(params.privateKey);
  const guardianAddress = params.guardianAddress
    ? normalizeAddress(params.guardianAddress)
    : undefined;

  const vault = readVault();
  vault[agentAddress] = {
    agentAddress,
    privateKey,
    guardianAddress,
    updatedAt: Date.now(),
  };
  writeVault(vault);
}

export function getAgentPrivateKeyByAgent(agentAddress: string): string | null {
  const key = normalizeAddress(agentAddress);
  const vault = readVault();
  return vault[key]?.privateKey ?? null;
}

export function getAgentPrivateKeyByGuardian(
  guardianAddress: string,
): string | null {
  const key = normalizeAddress(guardianAddress);
  const vault = readVault();

  let latest: StoredAgentKey | null = null;
  for (const item of Object.values(vault)) {
    if (item.guardianAddress === key) {
      if (!latest || item.updatedAt > latest.updatedAt) latest = item;
    }
  }
  return latest?.privateKey ?? null;
}
