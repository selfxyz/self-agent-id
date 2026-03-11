// SPDX-FileCopyrightText: 2025-2026 Social Connect Labs, Inc.
// SPDX-License-Identifier: BUSL-1.1
// NOTE: Converts to Apache-2.0 on 2029-06-11 per LICENSE.

import { ethers } from "ethers";
import type { NetworkId } from "./network";

// Pre-registered demo agents (one per network)
export const DEMO_AGENTS: Record<NetworkId, { address: string; key: string }> =
  {
    "celo-sepolia": {
      address: "0x56738c05507379C38Bbfa8f75064fd344716245F",
      key: ethers.zeroPadValue(
        "0x56738c05507379C38Bbfa8f75064fd344716245F",
        32,
      ),
    },
    "celo-mainnet": {
      address: "0xAc8BA8E6328c293Ff5aC4121E41AFb50c8D32107",
      key: ethers.zeroPadValue(
        "0xAc8BA8E6328c293Ff5aC4121E41AFb50c8D32107",
        32,
      ),
    },
  };

/** Get demo agent address for a given network */
export function getDemoAgentAddress(networkId: NetworkId): string {
  return DEMO_AGENTS[networkId].address;
}

/** Get demo agent key (bytes32) for a given network */
export function getDemoAgentKey(networkId: NetworkId): string {
  return DEMO_AGENTS[networkId].key;
}

// Legacy exports for backward compat (default to Sepolia)
export const DEMO_AGENT_ADDRESS = DEMO_AGENTS["celo-sepolia"].address;
export const DEMO_AGENT_KEY = DEMO_AGENTS["celo-sepolia"].key;

export const TESTS = [
  {
    id: "service" as const,
    title: "Agent-to-Service",
    description:
      "Your agent cryptographically signs a request and calls a gated census service. The service verifies the signature, checks isVerifiedAgent() on-chain, then reads ZK-attested credentials. POST contributes credentials to the census. GET returns aggregate stats: top nationalities, age verification rates, and OFAC compliance.",
  },
  {
    id: "peer" as const,
    title: "Agent-to-Agent",
    description:
      "Your agent sends a cryptographically signed request to another agent. That agent verifies the signature, checks isVerifiedAgent() on-chain, then checks sameHuman() to detect whether both agents share the same human backer. The response is signed back \u2014 proving mutual authentication.",
  },
  {
    id: "gate" as const,
    title: "Agent-to-Chain",
    descriptionEcdsa:
      "Your agent signs an EIP-712 typed-data meta-transaction off-chain. A relayer submits it to the AgentDemoVerifier contract, which recovers the signer via ecrecover, checks isVerifiedAgent() on the registry, and writes verification state on-chain. Explorer link proves the transaction. Rate-limited to 3 per hour per human.",
    descriptionEd25519:
      "Your agent signs a meta-transaction with Ed25519 off-chain. A relayer submits it to the AgentDemoVerifierEd25519 contract, which verifies the Ed25519 signature on-chain, checks isVerifiedAgent() on the registry, and writes verification state on-chain. Explorer link proves the transaction. Rate-limited to 3 per hour per human.",
    description:
      "Your agent signs a meta-transaction off-chain. A relayer submits it to an on-chain verifier contract, which cryptographically verifies the signature, checks isVerifiedAgent() on the registry, and writes verification state on-chain. Explorer link proves the transaction. Rate-limited to 3 per hour per human.",
  },
  {
    id: "chat" as const,
    title: "AI Agent Chat",
    description:
      "Chat with a LangChain-powered AI agent. The agent independently verifies callers on-chain via isVerifiedAgent() before responding \u2014 unverified agents are hard-refused at the service level, never trusted to the LLM. Authenticated via cryptographic request signing, rate-limited to 10 messages per hour.",
  },
] as const;

export type TestId = (typeof TESTS)[number]["id"];
