// SPDX-FileCopyrightText: 2025-2026 Social Connect Labs, Inc.
// SPDX-License-Identifier: BUSL-1.1
// NOTE: Converts to Apache-2.0 on 2029-06-11 per LICENSE.

const STORAGE_KEY = "self-agent-id:passkey";

export interface StoredPasskey {
  credentialId: string;
  walletAddress: string;
  createdAt: number;
}

export function savePasskey(passkey: StoredPasskey): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(passkey));
}

export function getPasskey(): StoredPasskey | null {
  if (typeof window === "undefined") return null;
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as StoredPasskey;
  } catch {
    return null;
  }
}

export function clearPasskey(): void {
  if (typeof window === "undefined") return;
  localStorage.removeItem(STORAGE_KEY);
}
