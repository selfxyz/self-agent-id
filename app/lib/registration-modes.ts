// SPDX-FileCopyrightText: 2025-2026 Social Connect Labs, Inc.
// SPDX-License-Identifier: BUSL-1.1
// NOTE: Converts to Apache-2.0 on 2029-06-11 per LICENSE.

/**
 * Registration modes accepted by POST /api/agent/register, their aliases and
 * the metadata discovery endpoints show for each.
 */

/** Canonical registration mode names; the mode decides how the agent key is generated and linked. */
export const REGISTRATION_MODES = [
  "linked",
  "wallet-free",
  "ed25519",
  "ed25519-linked",
  "privy",
  "smartwallet",
] as const;

/** One canonical registration mode. */
export type Mode = (typeof REGISTRATION_MODES)[number];

/** Previously published spellings the server still accepts (alias → canonical). */
export const MODE_ALIASES: Record<string, Mode> = {
  walletfree: "wallet-free",
  "smart-wallet": "smartwallet",
};

/**
 * Resolve a request's mode value to its canonical name.
 *
 * @param raw - The `mode` field from the request body (any type).
 * @returns The canonical mode (aliases resolved), or null if not a known mode
 *   string.
 */
export function normalizeMode(raw: unknown): Mode | null {
  if (typeof raw !== "string") return null;
  const mode = Object.hasOwn(MODE_ALIASES, raw) ? MODE_ALIASES[raw] : raw;
  return (REGISTRATION_MODES as readonly string[]).includes(mode)
    ? (mode as Mode)
    : null;
}

/** Metadata for a registration mode, displayed in discovery endpoints. */
export interface ModeInfo {
  label: string;
  shortDesc: string;
  keyType: string;
  walletNeeded: boolean;
  bestFor: string;
}

/** Static metadata for every registration mode. */
export const MODE_INFO: Record<Mode, ModeInfo> = {
  linked: {
    label: "Linked Agent",
    shortDesc:
      "Server generates an agent key and links it to the human's wallet (humanAddress), which owns the agent NFT",
    keyType: "EVM (generated)",
    walletNeeded: true,
    bestFor: "Developers who already have a wallet",
  },
  "wallet-free": {
    label: "Wallet-Free",
    shortDesc:
      "Server generates an agent key that owns its own agent NFT; no wallet required",
    keyType: "EVM (generated)",
    walletNeeded: false,
    bestFor: "Quick start without any wallet setup",
  },
  smartwallet: {
    label: "Smart Wallet",
    shortDesc:
      "Like linked, with humanAddress set to the human's passkey smart wallet",
    keyType: "EVM (generated)",
    walletNeeded: true,
    bestFor: "Humans using a passkey smart wallet",
  },
  privy: {
    label: "Social Login (Privy)",
    shortDesc:
      "Like linked, with humanAddress set to the human's Privy embedded wallet",
    keyType: "EVM (generated)",
    walletNeeded: true,
    bestFor: "Humans who signed in with email or social login via Privy",
  },
  ed25519: {
    label: "Ed25519",
    shortDesc:
      "Register the agent's existing Ed25519 public key (signed challenge). No wallet needed.",
    keyType: "Ed25519",
    walletNeeded: false,
    bestFor: "OpenClaw, ElizaOS, and other Ed25519 agents",
  },
  "ed25519-linked": {
    label: "Ed25519 + Guardian",
    shortDesc:
      "Ed25519 agent key with the human's wallet (humanAddress) as guardian for direct revocation control.",
    keyType: "Ed25519 + EVM",
    walletNeeded: true,
    bestFor: "Ed25519 agents where a human wants wallet-based control",
  },
} as const;

/** Modes whose request must carry the human's wallet as `humanAddress`. */
export const MODES_REQUIRING_HUMAN: ReadonlySet<Mode> = new Set(
  REGISTRATION_MODES.filter((mode) => MODE_INFO[mode].walletNeeded),
);
