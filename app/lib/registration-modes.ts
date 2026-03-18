// SPDX-FileCopyrightText: 2025-2026 Social Connect Labs, Inc.
// SPDX-License-Identifier: BUSL-1.1
// NOTE: Converts to Apache-2.0 on 2029-06-11 per LICENSE.

/** Registration mode — determines how the agent key is generated and linked. */
export type Mode =
  | "linked"
  | "walletfree"
  | "smartwallet"
  | "privy"
  | "ed25519"
  | "ed25519-linked";

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
    shortDesc: "Generate an agent key and link it to your existing wallet",
    keyType: "EVM (generated)",
    walletNeeded: true,
    bestFor: "Developers who already have a wallet",
  },
  walletfree: {
    label: "Wallet-Free",
    shortDesc: "Generate an agent key with no wallet required",
    keyType: "EVM (generated)",
    walletNeeded: false,
    bestFor: "Quick start without any wallet setup",
  },
  smartwallet: {
    label: "Smart Wallet",
    shortDesc: "Create an agent backed by a passkey smart wallet",
    keyType: "EVM (passkey)",
    walletNeeded: false,
    bestFor: "Modern passkey-based authentication",
  },
  privy: {
    label: "Social Login (Privy)",
    shortDesc: "Sign in with email or social account via Privy",
    keyType: "EVM (embedded)",
    walletNeeded: false,
    bestFor: "Non-crypto-native users who prefer social login",
  },
  ed25519: {
    label: "Ed25519",
    shortDesc:
      "Paste your agent's existing Ed25519 public key. No wallet needed.",
    keyType: "Ed25519",
    walletNeeded: false,
    bestFor: "OpenClaw, ElizaOS, and other Ed25519 agents",
  },
  "ed25519-linked": {
    label: "Ed25519 + Guardian",
    shortDesc:
      "Ed25519 agent key with your wallet as guardian for direct revocation control.",
    keyType: "Ed25519 + EVM",
    walletNeeded: true,
    bestFor: "Ed25519 agents where a human wants wallet-based control",
  },
} as const;
