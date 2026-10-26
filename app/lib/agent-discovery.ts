// SPDX-FileCopyrightText: 2025-2026 Social Connect Labs, Inc.
// SPDX-License-Identifier: BUSL-1.1
// NOTE: Converts to Apache-2.0 on 2029-06-11 per LICENSE.

/**
 * Agent-facing discovery documents.
 *
 * Content of /llms.txt, /api/agent-discovery (also /.well-known/self-agent-id.json
 * and "/" via Accept negotiation) and the registry's A2A card. The OpenAPI spec
 * (/api/agent/bootstrap) and per-agent cards are built elsewhere.
 */

import { getAppBaseUrl } from "@/lib/agent-api-helpers";
import { NETWORKS, type NetworkId } from "@/lib/network";
import { MODE_ALIASES, MODE_INFO, type Mode } from "@/lib/registration-modes";

const DOCS_URL = "https://docs.self.xyz/agent-id";

/** One-line guide to picking a registration mode. */
const MODE_DECISION_TREE =
  "Ed25519 keys? → yes → guardian wallet? → yes: ed25519-linked, no: ed25519. " +
  "No Ed25519 keys → human has a wallet? → yes: linked (or smartwallet / privy for passkey or Privy wallets), no: wallet-free.";

/** Every public endpoint, for both the JSON and the text discovery documents. */
const API_ENDPOINTS: { method: string; path: string; description: string }[] = [
  // Registration
  {
    method: "POST",
    path: "/api/agent/register",
    description:
      "Start a registration session (JSON body: mode, network, humanAddress?, ed25519Pubkey?, ed25519Signature?, disclosures?). Returns sessionToken, deepLink, scanUrl, qrImageBase64.",
  },
  {
    method: "POST",
    path: "/api/agent/register/ed25519-challenge",
    description:
      "Get the challenge hash an Ed25519 agent must sign (JSON body: pubkey (64 hex), network, humanAddress?).",
  },
  {
    method: "GET",
    path: "/api/agent/register/ed25519-check?pubkey=&network=",
    description:
      "Whether an Ed25519 public key (64 hex) is registered (has a human proof, which may have expired); returns agentId when it is.",
  },
  {
    method: "GET",
    path: "/api/agent/register/status",
    description:
      "Poll a registration (Authorization: Bearer <sessionToken>). Stage is qr-ready until completed; an expired session answers HTTP 410.",
  },
  {
    method: "GET",
    path: "/api/agent/register/qr",
    description:
      "Re-fetch the QR / deep link of a session (Authorization: Bearer <sessionToken>).",
  },
  {
    method: "POST",
    path: "/api/agent/register/export",
    description:
      "Export a server-generated agent private key within 30 minutes of completion (Authorization: Bearer <sessionToken>, or JSON body { token }).",
  },
  {
    method: "GET",
    path: "/api/qr/:qrToken",
    description:
      "QR code PNG behind a session's scanUrl (public; unlocks nothing).",
  },
  {
    method: "GET",
    path: "/api/agent/bootstrap",
    description: "OpenAPI 3.1 spec of the registration endpoints.",
  },
  {
    method: "GET",
    path: "/cli/register?payload=",
    description:
      "QR PNG for the self-agent CLI's browser handoff (payload from `register open`).",
  },
  // Lifecycle (human confirms each with the Self app)
  {
    method: "POST",
    path: "/api/agent/deregister",
    description:
      "Start deregistration — burns the agent NFT (JSON body: network, agentId or agentAddress, disclosures?).",
  },
  {
    method: "GET",
    path: "/api/agent/deregister/status",
    description: "Poll deregistration (Authorization: Bearer <sessionToken>).",
  },
  {
    method: "POST",
    path: "/api/agent/refresh",
    description:
      "Start a proof-of-human refresh (JSON body: network, agentId, disclosures? — defaults to the agent's on-chain config).",
  },
  {
    method: "GET",
    path: "/api/agent/refresh/status",
    description:
      "Poll a refresh (Authorization: Bearer <sessionToken>). Stage qr-ready → completed, or failed if the agent was deregistered meanwhile.",
  },
  {
    method: "GET",
    path: "/api/agent/refresh?agentId=&network=",
    description:
      "Shareable refresh link: redirects (302) a human straight to the Self app request (chainId= also accepted).",
  },
  {
    method: "POST",
    path: "/api/agent/identify",
    description:
      "Human scans a QR to learn their nullifier and active agent count (JSON body: network).",
  },
  {
    method: "GET",
    path: "/api/agent/identify/status",
    description:
      "Poll identification (Authorization: Bearer <sessionToken>); returns nullifier (decimal string) and agentCount when completed.",
  },
  // Public queries
  {
    method: "GET",
    path: "/api/agent/info/:chainId/:agentId",
    description:
      "Agent details: key, address, verification (isVerified = hasHumanProof && isProofFresh), proofExpiresAt, registeredAtBlock, credentials.",
  },
  {
    method: "GET",
    path: "/api/agent/verify/:chainId/:agentId",
    description:
      "Proof-of-human status, provider, strength, nullifier and agent count for the human.",
  },
  {
    method: "GET",
    path: "/api/agent/agents/:chainId/:address",
    description:
      "Agents a wallet owns plus the agent whose key is that address (complete flag included).",
  },
  {
    method: "GET",
    path: "/api/agent/agents-by-nullifier/:chainId/:nullifier",
    description:
      "Active agents registered by one human (complete flag included).",
  },
  {
    method: "GET",
    path: "/api/cards/:chainId/:agentId",
    description:
      "ERC-8004 / A2A card for an agent (agent-declared metadata + live on-chain proof data).",
  },
  {
    method: "GET",
    path: "/api/reputation/:chainId/:agentId",
    description: "Verification-strength score and proof type.",
  },
  {
    method: "GET",
    path: "/api/verify-status/:chainId/:agentId",
    description: "Compact verification summary.",
  },
  // Visas (agent ids are decimal strings; see "Visas" in llms.txt)
  {
    method: "GET",
    path: "/api/visa/:chainId/:agentId",
    description:
      "Visa tier, metrics, per-tier eligibility and thresholds (404 when the id has no visa and is not a registry agent).",
  },
  {
    method: "GET",
    path: "/api/visa/:chainId/batch?agents=1,2,3",
    description: "Visa tiers of up to 100 agent ids.",
  },
  {
    method: "GET",
    path: "/api/visa/agents?wallet=&chainId=",
    description:
      "Agent ids of a wallet: registry agents it owns or is the key of, plus its wallet-based visa id.",
  },
  {
    method: "POST",
    path: "/api/visa/claim",
    description:
      "Signed: mint a visa or upgrade its tier, relayed (JSON body: chainId, agentId, targetTier, agentWallet?, signature, timestamp).",
  },
  {
    method: "POST",
    path: "/api/visa/request-review",
    description:
      "Signed: request manual review for tier 2 or 3 (JSON body: chainId, agentId, targetTier, signature, timestamp).",
  },
  {
    method: "POST",
    path: "/api/visa/migrate",
    description:
      "Signed: move a wallet-based visa to a registry agent (JSON body: chainId, oldAgentId, newAgentId, connectedWallet, targetTier?, signature, timestamp).",
  },
  // Discovery
  {
    method: "GET",
    path: "/llms.txt",
    description: "This API in plain text, for LLMs.",
  },
  {
    method: "GET",
    path: "/api/agent-discovery",
    description:
      "The same as JSON (also served at / with Accept: application/json).",
  },
  {
    method: "GET",
    path: "/.well-known/self-agent-id.json",
    description: "Alias of /api/agent-discovery.",
  },
  {
    method: "GET",
    path: "/agents.json",
    description: "Index of the discovery URLs.",
  },
  {
    method: "GET",
    path: "/.well-known/agent-registration",
    description: "Redirects to /api/agent/bootstrap.",
  },
  {
    method: "GET",
    path: "/.well-known/agent-card.json",
    description:
      "A2A card of this registry; ?agentId=&chainId= for an agent's card.",
  },
  {
    method: "GET",
    path: "/.well-known/a2a/:agentId",
    description:
      "Redirects to /api/cards/:chainId/:agentId (?chain= selects the chain).",
  },
  // Protocols
  {
    method: "POST",
    path: "/api/a2a",
    description:
      "A2A v0.3.0 JSON-RPC endpoint (message/send, tasks/get, tasks/cancel).",
  },
  {
    method: "POST",
    path: "/api/mcp",
    description:
      "MCP server (Streamable HTTP): lookup, register, verify and request-signing tools.",
  },
  {
    method: "GET",
    path: "/api/health",
    description: "Liveness check.",
  },
];

// ── Types ───────────────────────────────────────────────────────────────────

/** Shape of the /api/agent-discovery JSON document. */
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
  modeAliases: Record<string, Mode>;
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
  sdkPackages: { npm: string };
  documentation: {
    docs: string;
    llmsTxt: string;
    agentCard: string;
    a2a: string;
    openApi: string;
  };
}

// ── getAgentDiscoveryJSON ───────────────────────────────────────────────────

/**
 * Build the JSON discovery document.
 *
 * @param base - Public base URL (default getAppBaseUrl()).
 * @returns Service info, registration modes, endpoints, networks and doc links.
 */
export function getAgentDiscoveryJSON(
  base = getAppBaseUrl(),
): AgentDiscoveryJSON {
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
    modeAliases: MODE_ALIASES,
    modeDecisionTree: MODE_DECISION_TREE,
    apiEndpoints: API_ENDPOINTS,
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
      "A human must scan a QR code with the Self app (iOS/Android) to complete registration, deregistration, refresh or identification. The agent CANNOT complete this step. The human's passport/ID is scanned once, when they set up the Self app.",
    sdkPackages: {
      npm: "@selfxyz/agent-sdk",
    },
    documentation: {
      docs: DOCS_URL,
      llmsTxt: "/llms.txt",
      agentCard: "/.well-known/agent-card.json",
      a2a: "/api/a2a",
      openApi: "/api/agent/bootstrap",
    },
  };
}

// ── getAgentDiscoveryText ───────────────────────────────────────────────────

/**
 * Build the plain-text discovery document served as /llms.txt.
 *
 * @param base - Public base URL used in every example URL (default
 *   getAppBaseUrl()).
 * @returns Markdown-flavoured text covering modes, sessions, registration,
 *   queries, visas and request signing.
 */
export function getAgentDiscoveryText(base = getAppBaseUrl()): string {
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
  const aliasLines = Object.entries(MODE_ALIASES)
    .map(([alias, mode]) => `"${alias}" → "${mode}"`)
    .join(", ");
  const endpointLines = API_ENDPOINTS.map(
    (e) => `  - ${e.method.padEnd(4)} ${base}${e.path} — ${e.description}`,
  ).join("\n");

  return `# Self Agent ID
> On-chain AI agent identity registry with proof-of-human verification

Docs: ${DOCS_URL}

## Privacy
Self app generates ZK proofs on-device. No personal data is ever uploaded, stored, or shared. Only a cryptographic proof is stored on-chain.

## Human Requirement
A human must use the Self app (iOS/Android) to complete registration by scanning a QR code. The agent CANNOT complete this step. Note: the human's passport/ID is scanned ONCE when they first set up the Self app — after that, they only need to scan QR codes shown by the agent.

## Registration Modes
${modeLines}

Use these exact mode names. Older spellings still accepted: ${aliasLines}.

## Mode Decision Tree
${MODE_DECISION_TREE}

## ERC-8004
ERC-8004 is an Ethereum standard for on-chain AI agent identity registries. Self Agent ID implements the IERC8004ProofOfHuman extension, adding biometric proof-of-human verification to agent identities.

Verification strength scale:
  - 100: Biometric passport (NFC)
  - 100: Biometric ID card (NFC)
  -  80: Aadhaar (QR)
  -  50: Third-party identity check

## Networks
Use "network": "mainnet" or "testnet" in request bodies; use the chain ID in query URLs.

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

On testnet the Self app can generate a mock passport, so no real document is needed.

## API Endpoints
${endpointLines}

## Sessions
Every flow that needs the human (register, deregister, refresh, identify) works the same way:
  1. POST the start endpoint. The response has sessionToken, stage ("qr-ready"), deepLink, scanUrl, qrImageBase64 (PNG, base64), expiresAt, timeRemainingMs and humanInstructions.
  2. Show the human the QR: open/share scanUrl (a PNG), render qrImageBase64, or, on the phone that has the Self app, open deepLink.
  3. Poll the matching /status endpoint every few seconds with the header Authorization: Bearer <sessionToken>. Each response returns a rotated sessionToken — use the newest one for the next call. Session tokens are never accepted in the query string.
  4. Stop when stage is "completed" (a refresh can also end "failed" if the agent was deregistered meanwhile). An expired session answers HTTP 410 {"error":"Session expired"}: start a new one.

## How to Register (for AI agents)

**You do NOT need to install any SDK.** Everything below is plain HTTPS + JSON (curl, fetch, requests, ...).

### Option 1: Wallet-Free (simplest — no keys or wallet needed)

\`\`\`bash
curl -s -X POST ${base}/api/agent/register \\
  -H 'Content-Type: application/json' \\
  -d '{"mode":"wallet-free","network":"testnet"}'
\`\`\`

The server generates the agent key. Show the human the QR (scanUrl), then poll:

\`\`\`bash
curl -s ${base}/api/agent/register/status -H 'Authorization: Bearer <sessionToken>'
\`\`\`

When stage is "completed" the response includes agentId and agentAddress. Within 30 minutes, export the generated private key (keep it secret; it is the agent's identity):

\`\`\`bash
curl -s -X POST ${base}/api/agent/register/export -H 'Authorization: Bearer <latest sessionToken>'
\`\`\`

### Option 2: Linked (the human's wallet owns the agent)

Same as Option 1 with "mode":"linked" and "humanAddress":"0x<human wallet>". smartwallet and privy work the same way, with humanAddress set to the human's smart wallet or Privy wallet.

### Option 3: Ed25519 (bring your own Ed25519 key)

Step 1 — get the challenge (pubkey: your 32-byte Ed25519 public key as 64 hex chars, no 0x):

\`\`\`bash
curl -s -X POST ${base}/api/agent/register/ed25519-challenge \\
  -H 'Content-Type: application/json' \\
  -d '{"pubkey":"<64-hex-pubkey>","network":"testnet"}'
# → {"challengeHash":"0x…","nonce":"0"}
\`\`\`

Step 2 — sign the 32 raw bytes of challengeHash (hex-decode it, do not sign the hex string) with your Ed25519 private key. Encode the 64-byte signature as 128 hex chars, no 0x.

Step 3 — start the session:

\`\`\`bash
curl -s -X POST ${base}/api/agent/register \\
  -H 'Content-Type: application/json' \\
  -d '{"mode":"ed25519","network":"testnet","ed25519Pubkey":"<64-hex-pubkey>","ed25519Signature":"<128-hex-signature>"}'
\`\`\`

For ed25519-linked, pass the same "humanAddress" (the guardian wallet) to both the challenge and the register call, with "mode":"ed25519-linked". Then show the QR and poll status as above (there is no key to export: you already hold it).

### Optional disclosures
Add to any register body: "disclosures": {"minimumAge": 18, "ofac": true, "nationality": true}. minimumAge is 0, 18 or 21; the other fields (ofac, nationality, name, date_of_birth, gender, issuing_state) must be JSON booleans.

### Option 4: A2A JSON-RPC (for agents with A2A protocol support)

\`\`\`bash
curl -s -X POST ${base}/api/a2a \\
  -H 'Content-Type: application/json' \\
  -d '{"jsonrpc":"2.0","id":1,"method":"message/send","params":{"message":{"kind":"message","messageId":"msg-1","role":"user","parts":[{"kind":"data","data":{"intent":"register","mode":"wallet-free","network":"testnet"}}]}}}'
\`\`\`

The result is a Task (state "input-required") whose message carries the QR as a file part and a data part with sessionToken, scanUrl and deepLink. Poll by sending another message with {"intent":"status","sessionToken":"<sessionToken>"} — always the newest sessionToken from the previous reply — until the task state is "completed". The same works for deregister and refresh-proof sessions. (Polling by taskId only works while you hit the same server instance; use sessionToken.) Other intents: lookup, verify, freshness, deregister, refresh-proof, help (e.g. {"intent":"lookup","agentId":1,"chainId":${sepolia.chainId}}). A rate-limited call answers a JSON-RPC error (HTTP 429) with error.data.retryAfterMs.

## Agent Lifecycle Endpoints

All take a JSON body (no signed headers) and start a session the human confirms in the Self app; poll the matching /status endpoint with Authorization: Bearer <sessionToken>.

### Deregister (irreversible — burns the agent NFT)
POST ${base}/api/agent/deregister (identify the agent by agentId or agentAddress)
\`\`\`json
{ "network": "testnet", "agentId": 5 }
\`\`\`
Poll: GET ${base}/api/agent/deregister/status

### Refresh Proof-of-Human (renews proofExpiresAt without re-registering)
POST ${base}/api/agent/refresh
\`\`\`json
{ "network": "testnet", "agentId": 5 }
\`\`\`
Poll: GET ${base}/api/agent/refresh/status

### Identify (which human am I?)
POST ${base}/api/agent/identify
\`\`\`json
{ "network": "testnet" }
\`\`\`
The human scans the QR; when GET ${base}/api/agent/identify/status reaches "completed" it returns their nullifier (decimal string) and active agentCount. List their agents with GET ${base}/api/agent/agents-by-nullifier/:chainId/:nullifier.

## Querying Agents
No auth; limited to 120 requests per minute per IP (agents-by-wallet / agents-by-nullifier: 20, as they scan every agent id), over which they answer HTTP 429 with Retry-After. Per-agent routes return 404 {"error":"Agent not found"} for ids that were never registered or were deregistered, and 502 {"error":"RPC error"} if the chain cannot be read. "Verified" always means hasHumanProof && isProofFresh; proofExpiresAt is ISO-8601; registeredAtBlock is a block number, not a timestamp.

\`\`\`bash
curl -s ${base}/api/agent/info/${sepolia.chainId}/1
curl -s ${base}/api/agent/agents/${sepolia.chainId}/0x<wallet>
\`\`\`

## Visas

Celo agent visas: tier 1 Tourist, 2 Work, 3 Citizenship. Visa agent ids are decimal strings: either a registry agentId or a wallet-based id (the wallet address as a uint160, e.g. BigInt("0x82D8…")), which can claim a Tourist visa without a registry agent.

Reads (no auth): GET ${base}/api/visa/${sepolia.chainId}/<agentId>, GET ${base}/api/visa/${sepolia.chainId}/batch?agents=1,2,3, GET ${base}/api/visa/agents?wallet=0x<wallet>&chainId=${sepolia.chainId}.

Writes are sent on-chain by the server's relayer, so each is signed by someone allowed to act for the agent. Sign this exact text (lines joined by "\\n", no trailing newline, ids and chainId in decimal) with EIP-191 personal_sign:

\`\`\`
Self Agent ID visa request
action: <claim | request-review | migrate>
chainId: <chainId>
agentId: <agentId; for migrate the old wallet-based id>
newAgentId: <migrate only: the registry agentId>
targetTier: <1-3; migrate defaults to 1>
timestamp: <unix ms, the same number as in the body>
\`\`\`

Send "signature" (0x + 130 hex) and "timestamp" (a JSON number) in the JSON body next to the signed fields. The timestamp must be within 5 minutes of the server clock and each signed message is accepted once (sign a new timestamp to retry). The signer must be the agent NFT owner, the agent's own EVM key, or, for a wallet-based id, that wallet. migrate is signed by the wallet behind oldAgentId (connectedWallet = that wallet), which must also own or be the key of newAgentId; claim's optional agentWallet must be the signer.

\`\`\`bash
curl -s -X POST ${base}/api/visa/claim -H 'Content-Type: application/json' \\
  -d '{"chainId":"${sepolia.chainId}","agentId":"5","targetTier":1,"timestamp":1767225600000,"signature":"0x…"}'
\`\`\`

Errors: 401 bad, expired or reused signature; 403 signer not authorized; 404 unknown agent; 409 already at tier / review already requested; 422 not eligible (code NOT_ELIGIBLE with metrics and required thresholds, or REVIEW_REQUIRED); 503 relayer not configured. Limits: 20 signed requests per IP per hour; relayed transactions: 5 per IP, 2 per signer and 50 overall per hour (429 with Retry-After).

## Authenticating as an Agent (signed requests to third-party services)

After registration an agent proves its identity to other services by signing each HTTP request. The SDKs do this for you (agent.fetch() / agent.signRequest()); the protocol is:

  1. timestamp = current Unix time in milliseconds, as a decimal string (e.g. "1767225600000")
  2. bodyHash = keccak256(UTF-8 body), or keccak256("") when there is no body
  3. digest = keccak256(UTF-8 of timestamp + METHOD + pathAndQuery + bodyHash), where METHOD is upper-case, pathAndQuery is e.g. "/api/data?x=1" and bodyHash is 0x-prefixed lower-case hex
  4. signature:
     - ECDSA agents: EIP-191 personal_sign of the 32 digest bytes (ethers: wallet.signMessage(getBytes(digest)))
     - Ed25519 agents: Ed25519 signature of the 32 digest bytes, 0x-prefixed hex

Headers:
  - x-self-agent-signature: the signature
  - x-self-agent-timestamp: the timestamp from step 1 (verifiers reject stale timestamps)
  - x-self-agent-address: agent's Ethereum address (ECDSA agents; informational, the verifier recovers it)
  - x-self-agent-keytype: "ed25519" for Ed25519 agents (omit for ECDSA)
  - x-self-agent-key: 0x-prefixed 32-byte Ed25519 public key (Ed25519 agents)

The verifier recovers the signer, looks up the agent on-chain and checks it has a fresh human proof.

### Using the SDK (TypeScript)
\`\`\`typescript
import { SelfAgent, Ed25519Agent } from "@selfxyz/agent-sdk";

// ECDSA agent
const agent = new SelfAgent({ privateKey: "0x...", network: "testnet" });

// Ed25519 agent
const edAgent = new Ed25519Agent({ privateKey: "<64-hex-seed>", network: "testnet" });

// Automatic signing — recommended
const res = await agent.fetch("https://example.com/api/protected", {
  method: "POST",
  body: JSON.stringify({ data: "hello" }),
});

// Manual signing — for custom HTTP clients
const headers = await agent.signRequest("POST", "https://example.com/api/protected", body);
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

## SDK Package (for post-registration use — NOT needed for registration)
  - npm: @selfxyz/agent-sdk (TypeScript). Other languages: call the REST API above directly.

## Discovery Endpoints
  - ${base}/llms.txt — This file (plain text, for LLMs)
  - ${base}/api/agent-discovery — The same information as JSON
  - ${base}/api/agent/bootstrap — OpenAPI 3.1 spec of the registration API
  - ${base}/.well-known/agent-card.json — A2A v0.3.0 agent card (JSON)
  - ${base}/api/a2a — A2A JSON-RPC endpoint
  - ${base}/api/mcp — MCP server (Streamable HTTP)
  - ${base}/agents.json — Index of these URLs
`;
}

// ── getAgentCardJSON ────────────────────────────────────────────────────────

/** Shape of the registry's own A2A agent card. */
export interface AgentCard {
  type: string;
  protocolVersion: string;
  name: string;
  description: string;
  services: { name: string; endpoint: string; version?: string }[];
  version: string;
  url: string;
  preferredTransport: string;
  documentationUrl: string;
  provider: { name: string; url: string };
  capabilities: {
    streaming: boolean;
    pushNotifications: boolean;
    stateTransitionHistory: boolean;
  };
  supportsAuthenticatedExtendedCard: boolean;
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

/**
 * Build the registry's own A2A / ERC-8004 agent card.
 *
 * @param base - Public base URL for the A2A endpoint (default getAppBaseUrl()).
 * @returns The agent card served at /.well-known/agent-card.json.
 */
export function getAgentCardJSON(base = getAppBaseUrl()): AgentCard {
  return {
    type: "https://eips.ethereum.org/EIPS/eip-8004#registration-v1",
    protocolVersion: "0.3.0",
    name: "Self Agent ID Registry",
    description:
      "On-chain AI agent identity registry with proof-of-human verification powered by Self Protocol.",
    services: [
      { name: "web", endpoint: DOCS_URL },
      { name: "A2A", endpoint: `${base}/api/a2a`, version: "0.3.0" },
    ],
    version: "1.0.0",
    url: `${base}/api/a2a`,
    preferredTransport: "JSONRPC",
    documentationUrl: DOCS_URL,
    provider: { name: "Self", url: "https://self.xyz" },
    capabilities: {
      streaming: false,
      pushNotifications: false,
      stateTransitionHistory: false,
    },
    supportsAuthenticatedExtendedCard: false,
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
        name: "Session Status",
        description:
          "Check the progress of an in-flight registration, deregistration or proof refresh. Send the newest sessionToken from the previous reply.",
        tags: ["identity", "registration", "status"],
        examples: ['{ "intent": "status", "sessionToken": "<sessionToken>" }'],
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
