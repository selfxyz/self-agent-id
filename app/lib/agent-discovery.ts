// SPDX-FileCopyrightText: 2025-2026 Social Connect Labs, Inc.
// SPDX-License-Identifier: BUSL-1.1
// NOTE: Converts to Apache-2.0 on 2029-06-11 per LICENSE.

// ── Canonical data source for all agent-facing discovery content ────────────
//
// Every route that exposes machine-readable metadata (llms.txt, agent-card,
// JSON-LD, content-negotiation endpoints) MUST derive its content from the
// functions exported here. This is the single source of truth.

import { NETWORKS, type NetworkId } from "@/lib/network";
import { MODE_INFO, type Mode } from "@/lib/registration-modes";

// ── Helpers ─────────────────────────────────────────────────────────────────

function appUrl(): string {
  return process.env.NEXT_PUBLIC_APP_URL || "https://app.ai.self.xyz";
}

// ── Types ───────────────────────────────────────────────────────────────────

export interface AgentDiscoveryJSON {
  service: { name: string; description: string; url: string };
  privacy: string;
  registrationModes: Record<
    Mode,
    {
      label: string;
      description: string;
      keyType: string;
      walletNeeded: boolean;
      bestFor: string;
    }
  >;
  modeDecisionTree: string;
  apiEndpoints: { path: string; description: string; method: string }[];
  erc8004: {
    description: string;
    proofOfHumanExtension: string;
    verificationStrengths: { source: string; strength: number }[];
  };
  networks: Record<
    NetworkId,
    {
      label: string;
      chainId: number;
      registryAddress: string;
      rpcUrl: string;
      isTestnet: boolean;
    }
  >;
  humanRequirement: string;
  sdkPackages: { npm: string; pypi: string; crates: string };
  documentation: { llmsTxt: string; agentCard: string; a2a: string };
}

// ── getAgentDiscoveryJSON ───────────────────────────────────────────────────

export function getAgentDiscoveryJSON(): AgentDiscoveryJSON {
  const base = appUrl();

  const registrationModes = {} as AgentDiscoveryJSON["registrationModes"];
  for (const [mode, info] of Object.entries(MODE_INFO) as [
    Mode,
    (typeof MODE_INFO)[Mode],
  ][]) {
    registrationModes[mode] = {
      label: info.label,
      description: info.shortDesc,
      keyType: info.keyType,
      walletNeeded: info.walletNeeded,
      bestFor: info.bestFor,
    };
  }

  const networks = {} as AgentDiscoveryJSON["networks"];
  for (const [id, cfg] of Object.entries(NETWORKS) as [
    NetworkId,
    (typeof NETWORKS)[NetworkId],
  ][]) {
    networks[id] = {
      label: cfg.label,
      chainId: cfg.chainId,
      registryAddress: cfg.registryAddress,
      rpcUrl: cfg.rpcUrl,
      isTestnet: cfg.isTestnet,
    };
  }

  return {
    service: {
      name: "Self Agent ID",
      description:
        "On-chain AI agent identity registry with proof-of-human verification",
      url: base,
    },
    privacy:
      "Self app generates ZK proofs on-device. No personal data is ever uploaded, stored, or shared. Only a cryptographic proof is stored on-chain.",
    registrationModes,
    modeDecisionTree:
      "Ed25519 keys? → yes → Guardian wallet? → yes: ed25519-linked, no: ed25519. No Ed25519? → Have wallet? → yes: linked, no → Want passkeys? → yes: smartwallet, Prefer social login? → yes: privy, Quick start: walletfree",
    apiEndpoints: [
      {
        path: "/api/a2a",
        description: "A2A v0.3.0 JSON-RPC endpoint",
        method: "POST",
      },
      {
        path: "/api/agent/register",
        description: "REST registration endpoint",
        method: "POST",
      },
      {
        path: "/api/agent/register/ed25519-challenge",
        description: "Ed25519 challenge-response flow",
        method: "POST",
      },
      {
        path: "/api/agent/register/status",
        description: "Poll registration status",
        method: "GET",
      },
      {
        path: "/api/agent/deregister",
        description: "Deregister an agent (burn NFT)",
        method: "POST",
      },
      {
        path: "/api/agent/deregister/status",
        description: "Poll deregistration status",
        method: "GET",
      },
      {
        path: "/api/agent/refresh",
        description: "Refresh proof-of-human (re-verify)",
        method: "POST",
      },
      {
        path: "/api/agent/refresh/status",
        description: "Poll refresh status",
        method: "GET",
      },
      {
        path: "/api/agent/identify",
        description: "Identify agent from signed headers",
        method: "POST",
      },
      {
        path: "/api/agent/identify/status",
        description: "Poll identification status",
        method: "GET",
      },
      {
        path: "/api/agent/agents-by-nullifier/:chainId/:nullifier",
        description: "List all agents for a human nullifier",
        method: "GET",
      },
      {
        path: "/api/demo/verify",
        description: "Demo: agent-to-service verification",
        method: "POST",
      },
      {
        path: "/api/demo/agent-to-agent",
        description: "Demo: mutual agent verification + sameHuman",
        method: "POST",
      },
      {
        path: "/api/demo/chain-verify",
        description: "Demo: on-chain ECDSA meta-tx verification",
        method: "POST",
      },
      {
        path: "/api/demo/chain-verify-ed25519",
        description: "Demo: on-chain Ed25519 meta-tx verification",
        method: "POST",
      },
      {
        path: "/api/demo/chat",
        description: "Demo: AI agent chat (LangChain proxy)",
        method: "POST",
      },
      {
        path: "/api/demo/census",
        description: "Demo: anonymous credential census",
        method: "POST+GET",
      },
    ],
    erc8004: {
      description:
        "ERC-8004 is an Ethereum standard for on-chain AI agent identity registries. It defines how agents register, store metadata URIs, and receive reputation/validation signals.",
      proofOfHumanExtension:
        "Self Agent ID implements the IERC8004ProofOfHuman extension, which adds biometric proof-of-human verification to agent identities. A human must cryptographically prove their identity using the Self app, and the resulting ZK proof is verified on-chain.",
      verificationStrengths: [
        { source: "Biometric passport (NFC)", strength: 100 },
        { source: "Biometric ID card (NFC)", strength: 100 },
        { source: "Aadhaar (QR)", strength: 80 },
        { source: "Third-party identity check", strength: 50 },
      ],
    },
    networks,
    humanRequirement:
      "A human must scan their passport or ID card with the Self app (iOS/Android) to complete registration. The agent CANNOT complete this step — it requires physical interaction with the document's NFC chip.",
    sdkPackages: {
      npm: "@selfxyz/agent-sdk",
      pypi: "selfxyz-agent-sdk",
      crates: "self-agent-sdk",
    },
    documentation: {
      llmsTxt: "/llms.txt",
      agentCard: "/.well-known/agent-card.json",
      a2a: "/api/a2a",
    },
  };
}

// ── getAgentDiscoveryText ───────────────────────────────────────────────────

export function getAgentDiscoveryText(): string {
  const base = appUrl();
  const mainnet = NETWORKS["celo-mainnet"];
  const sepolia = NETWORKS["celo-sepolia"];

  const modeLines = (
    Object.entries(MODE_INFO) as [Mode, (typeof MODE_INFO)[Mode]][]
  )
    .map(
      ([mode, info]) =>
        `  - ${mode}: ${info.label} — ${info.shortDesc} (key: ${info.keyType}, wallet needed: ${info.walletNeeded ? "yes" : "no"}, best for: ${info.bestFor})`,
    )
    .join("\n");

  return `# Self Agent ID
> On-chain AI agent identity registry with proof-of-human verification

## Privacy
Self app generates ZK proofs on-device. No personal data is ever uploaded, stored, or shared. Only a cryptographic proof is stored on-chain.

## Human Requirement
A human must use the Self app (iOS/Android) to complete registration by scanning a QR code. The agent CANNOT complete this step. Note: the human's passport/ID is scanned ONCE when they first set up the Self app — after that, they only need to scan QR codes shown by the agent.

## Registration Modes
${modeLines}

## Mode Decision Tree
Ed25519 keys? → yes → Guardian wallet? → yes: ed25519-linked, no: ed25519.
No Ed25519? → Have wallet? → yes: linked, no → Want passkeys? → yes: smartwallet, Prefer social login? → yes: privy, Quick start: walletfree.

## ERC-8004
ERC-8004 is an Ethereum standard for on-chain AI agent identity registries. Self Agent ID implements the IERC8004ProofOfHuman extension, adding biometric proof-of-human verification to agent identities.

Verification strength scale:
  - 100: Biometric passport (NFC)
  - 100: Biometric ID card (NFC)
  -  80: Aadhaar (QR)
  -  50: Third-party identity check

## Networks

### Celo Mainnet
  - Chain ID: ${mainnet.chainId}
  - RPC: ${mainnet.rpcUrl}
  - Registry: ${mainnet.registryAddress}
  - Provider: ${mainnet.providerAddress}
  - Block Explorer: ${mainnet.blockExplorer}

### Celo Sepolia (Testnet)
  - Chain ID: ${sepolia.chainId}
  - RPC: ${sepolia.rpcUrl}
  - Registry: ${sepolia.registryAddress}
  - Provider: ${sepolia.providerAddress}
  - Block Explorer: ${sepolia.blockExplorer}

## API Endpoints
  - POST ${base}/api/a2a — A2A v0.3.0 JSON-RPC endpoint
  - POST ${base}/api/agent/register — REST registration endpoint
  - POST ${base}/api/agent/register/ed25519-challenge — Ed25519 challenge-response flow
  - GET  ${base}/api/agent/register/status — Poll registration status

## How to Register (for AI agents)

**You do NOT need to install any SDK.** Just send a JSON-RPC message to the A2A endpoint below. The SDK packages exist for post-registration features (signed requests, verification) but are NOT needed for registration itself.

All options below are plain HTTP — no SDK or special client library needed. Just POST JSON with fetch, curl, requests, etc.

### Option 1: REST Ed25519 Flow (recommended for most agents)

Step 1 — Request a challenge:
POST ${base}/api/agent/register/ed25519-challenge
Content-Type: application/json

\`\`\`json
{
  "ed25519PublicKey": "base64-encoded-public-key",
  "network": "testnet"
}
\`\`\`

Step 2 — Sign the challenge and submit:
POST ${base}/api/agent/register
Content-Type: application/json

\`\`\`json
{
  "mode": "ed25519",
  "ed25519PublicKey": "base64-encoded-public-key",
  "ed25519Signature": "base64-encoded-signature-of-challenge",
  "challengeId": "challenge-id-from-step-1",
  "network": "testnet"
}
\`\`\`

The response will include a QR code for the human to scan with the Self app.

Step 3 — Poll status:
GET ${base}/api/agent/register/status?sessionToken=<token>

### Option 2: Wallet-Free REST Flow (simplest — human does it)

POST ${base}/api/agent/register
Content-Type: application/json

\`\`\`json
{
  "mode": "walletfree",
  "network": "testnet"
}
\`\`\`

The server generates an agent key. The response includes a QR code for the human to scan with the Self app. Poll status at /api/agent/register/status?sessionToken=<token>.

### Option 3: A2A JSON-RPC (for agents with A2A protocol support)

If your agent framework supports the A2A protocol (Google A2A / JSON-RPC), you can use the conversational endpoint. This is the same as the REST options above but wrapped in A2A message format:

POST ${base}/api/a2a
Content-Type: application/json

\`\`\`json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "message/send",
  "params": {
    "message": {
      "role": "user",
      "parts": [
        {
          "kind": "text",
          "text": "{ \\"intent\\": \\"register\\", \\"network\\": \\"testnet\\" }"
        }
      ]
    }
  }
}
\`\`\`

The response includes a QR code. A human must scan it with the Self app to complete verification. Poll the task status using the returned taskId.

## Agent Lifecycle Endpoints

### Deregister
POST ${base}/api/agent/deregister
Content-Type: application/json
Headers: x-self-agent-signature, x-self-agent-timestamp

Burns the agent's soulbound NFT. Irreversible. Poll status at:
GET ${base}/api/agent/deregister/status?sessionToken=<token>

### Refresh Proof-of-Human
POST ${base}/api/agent/refresh
Content-Type: application/json
Headers: x-self-agent-signature, x-self-agent-timestamp

Re-verifies the agent's human backing (e.g. after proof expiry). Returns a QR code for the human to scan with the Self app. Poll status at:
GET ${base}/api/agent/refresh/status?sessionToken=<token>

### Identify Agent
POST ${base}/api/agent/identify
Content-Type: application/json
Headers: x-self-agent-signature, x-self-agent-timestamp

Resolves an agent's on-chain identity from signed request headers. Returns agentId, verification status, and credentials. Poll status at:
GET ${base}/api/agent/identify/status?sessionToken=<token>

### Agents by Nullifier
GET ${base}/api/agent/agents-by-nullifier/:chainId/:nullifier

Lists all agents registered by a specific human (identified by their nullifier hash). Useful for sybil detection and human-to-agent mapping.

## Demo Endpoints (Test Your Agent)

All demo endpoints require Self Agent ID signed headers. Use \`agent.fetch()\` from the SDK:

\`\`\`typescript
const res = await agent.fetch("${base}/api/demo/agent-to-agent?network=celo-sepolia", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ test: "hello" }),
});
\`\`\`

### Agent-to-Service (simplest test)
POST ${base}/api/demo/verify?network=celo-sepolia
Verifies your agent's identity and returns credentials. Good first test.

### Agent-to-Agent (recommended primary test)
POST ${base}/api/demo/agent-to-agent?network=celo-sepolia
A pre-registered demo agent verifies you, does a sameHuman check, and signs its response. Demonstrates mutual authentication.

### Agent-to-Chain — ECDSA
POST ${base}/api/demo/chain-verify
Submits an EIP-712 meta-tx to the on-chain AgentDemoVerifier. Requires RELAYER_PRIVATE_KEY on the server.

### Agent-to-Chain — Ed25519
POST ${base}/api/demo/chain-verify-ed25519
Submits an Ed25519 meta-tx to AgentDemoVerifierEd25519. Requires RELAYER_PRIVATE_KEY on the server.

### AI Agent Chat
POST ${base}/api/demo/chat?network=celo-sepolia
LangChain-powered AI that verifies your identity on-chain before chatting. Requires LANGCHAIN_URL on the server.

### Anonymous Census
POST ${base}/api/demo/census?network=celo-sepolia — contribute credentials
GET ${base}/api/demo/census?network=celo-sepolia — read aggregate stats (requires auth)
GET ${base}/api/demo/census?help=1 — endpoint documentation (no auth required)

Tip: Send a GET request to any demo endpoint (except census) to receive machine-readable usage documentation as JSON.

## Agent Authentication Headers

All authenticated endpoints use signed HTTP headers. The SDK handles this via \`agent.fetch()\` and \`agent.signRequest()\`.

### Header Protocol
  - x-self-agent-signature: HMAC-SHA256 signature of (method + url + body + timestamp)
  - x-self-agent-timestamp: ISO 8601 timestamp (e.g. "2026-03-10T12:00:00.000Z")
  - x-self-agent-address: Agent's Ethereum address (auto-derived by verifier)
  - x-self-agent-keytype: "ed25519" for Ed25519 agents, omit for ECDSA
  - x-self-agent-key: Agent's public key hex (required for Ed25519, optional for ECDSA)

### Using the SDK (TypeScript)
\`\`\`typescript
import { SelfAgent, Ed25519Agent } from "@selfxyz/agent-sdk";

// ECDSA agent
const agent = new SelfAgent({ privateKey: "0x...", network: "testnet" });

// Ed25519 agent
const agent = new Ed25519Agent({ privateKey: "<64-hex-seed>", network: "testnet" });

// Automatic signing — recommended
const res = await agent.fetch("https://example.com/api/protected", {
  method: "POST",
  body: JSON.stringify({ data: "hello" }),
});

// Manual signing — for custom HTTP clients
const headers = await agent.signRequest("POST", "https://example.com/api/protected", body);
// headers = { "x-self-agent-signature": "...", "x-self-agent-timestamp": "...", ... }
\`\`\`

### Verifying Incoming Requests (Service-Side)
\`\`\`typescript
import { SelfAgentVerifier } from "@selfxyz/agent-sdk";

const verifier = SelfAgentVerifier.create()
  .network("testnet")
  .sybilLimit(3)
  .requireAge(18)
  .build();

const result = await verifier.verify({
  signature: req.headers["x-self-agent-signature"],
  timestamp: req.headers["x-self-agent-timestamp"],
  method: "POST",
  url: req.url,
  body: reqBody,
  keytype: req.headers["x-self-agent-keytype"],
  agentKey: req.headers["x-self-agent-key"],
});
// result.valid, result.agentAddress, result.agentId, result.credentials
\`\`\`

## SDK Packages (for post-registration use — NOT needed for registration)
  - npm: @selfxyz/agent-sdk
  - PyPI: selfxyz-agent-sdk
  - crates.io: self-agent-sdk

The SDKs provide signed request helpers, verification, and agent lifecycle management AFTER registration. For registration itself, just use the A2A endpoint or REST API above.

## Discovery Endpoints
  - ${base}/llms.txt — This file (plain text, for LLMs)
  - ${base}/.well-known/agent-card.json — A2A v0.3.0 agent card (JSON)
  - ${base}/api/a2a — A2A JSON-RPC endpoint
`;
}

// ── getAgentCardJSON ────────────────────────────────────────────────────────

export interface AgentCard {
  type: string;
  name: string;
  description: string;
  image: string;
  services: { name: string; endpoint: string; version?: string }[];
  version: string;
  url: string;
  provider: { name: string; url: string };
  capabilities: {
    streaming: boolean;
    pushNotifications: boolean;
    stateTransitionHistory: boolean;
    extendedAgentCard: boolean;
  };
  supportedInterfaces: {
    url: string;
    protocolBinding: string;
    protocolVersion: string;
  }[];
  defaultInputModes: string[];
  defaultOutputModes: string[];
  skills: {
    id: string;
    name: string;
    description: string;
    tags: string[];
    examples: string[];
    inputModes: string[];
    outputModes: string[];
  }[];
}

export function getAgentCardJSON(): AgentCard {
  const base = appUrl();

  return {
    type: "https://eips.ethereum.org/EIPS/eip-8004#registration-v1",
    name: "Self Agent ID Registry",
    description:
      "On-chain AI agent identity registry with proof-of-human verification powered by Self Protocol.",
    image: `${base}/icon.png`,
    services: [
      { name: "web", endpoint: base },
      { name: "A2A", endpoint: `${base}/api/a2a`, version: "0.3.0" },
    ],
    version: "1.0.0",
    url: `${base}/api/a2a`,
    provider: { name: "Self", url: "https://self.xyz" },
    capabilities: {
      streaming: false,
      pushNotifications: true,
      stateTransitionHistory: false,
      extendedAgentCard: false,
    },
    supportedInterfaces: [
      {
        url: `${base}/api/a2a`,
        protocolBinding: "JSONRPC",
        protocolVersion: "0.3.0",
      },
    ],
    defaultInputModes: ["text/plain", "application/json"],
    defaultOutputModes: ["text/plain", "application/json"],
    skills: [
      {
        id: "agent-registration",
        name: "Agent Registration",
        description:
          "Register a new AI agent on-chain with proof-of-human verification via Self Protocol. Returns a QR code for a human to scan with the Self app.",
        tags: ["identity", "registration", "proof-of-human"],
        examples: [
          "Register a new agent",
          "Register agent with address 0x1234...",
          '{ "intent": "register", "humanAddress": "0x...", "network": "testnet" }',
        ],
        inputModes: ["text/plain", "application/json"],
        outputModes: ["text/plain", "application/json"],
      },
      {
        id: "registration-status",
        name: "Registration Status",
        description: "Check the progress of an in-flight agent registration.",
        tags: ["identity", "registration", "status"],
        examples: [
          '{ "intent": "register-status", "sessionToken": "<token>" }',
        ],
        inputModes: ["application/json"],
        outputModes: ["text/plain", "application/json"],
      },
      {
        id: "agent-lookup",
        name: "Agent Lookup",
        description:
          "Look up a registered agent by ID and return its full on-chain metadata, verification status, and credentials.",
        tags: ["identity", "registry", "lookup"],
        examples: [
          "Look up agent #1",
          "Get details for agent 42",
          '{ "intent": "lookup", "agentId": 1, "chainId": 42220 }',
        ],
        inputModes: ["text/plain", "application/json"],
        outputModes: ["text/plain", "application/json"],
      },
      {
        id: "human-proof-check",
        name: "Human Proof Check",
        description:
          "Check whether an agent has a valid, fresh proof-of-human on-chain.",
        tags: ["identity", "proof-of-human", "verification"],
        examples: [
          "Verify agent #1",
          "Does agent 42 have a human proof?",
          '{ "intent": "verify", "agentId": 1 }',
        ],
        inputModes: ["text/plain", "application/json"],
        outputModes: ["text/plain", "application/json"],
      },
    ],
  };
}

// ── getJsonLd ───────────────────────────────────────────────────────────────

export interface JsonLd {
  "@context": string;
  "@type": string;
  name: string;
  description: string;
  url: string;
  potentialAction: { "@type": string; target: string };
  documentation: { llmsTxt: string; agentCard: string; a2a: string };
}

export function getJsonLd(): JsonLd {
  const base = appUrl();

  return {
    "@context": "https://schema.org",
    "@type": "WebApplication",
    name: "Self Agent ID",
    description:
      "On-chain AI agent identity registry with proof-of-human verification",
    url: base,
    potentialAction: {
      "@type": "RegisterAction",
      target: `${base}/api/a2a`,
    },
    documentation: {
      llmsTxt: "/llms.txt",
      agentCard: "/.well-known/agent-card.json",
      a2a: "/api/a2a",
    },
  };
}
