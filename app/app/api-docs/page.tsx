"use client";

import { useState } from "react";
import Link from "next/link";
import MatrixText from "@/components/MatrixText";
import { Card } from "@/components/Card";
import CodeBlock from "@/components/CodeBlock";
import { Badge } from "@/components/Badge";

/* ── Endpoint data ─────────────────────────────────────────────────── */

interface Param {
  name: string;
  in: "query" | "path" | "body";
  type: string;
  required: boolean;
  description: string;
}

interface ResponseDef {
  status: number;
  description: string;
  example?: string;
}

interface EndpointDef {
  method: "GET" | "POST";
  path: string;
  summary: string;
  description: string;
  parameters: Param[];
  requestBody?: { description?: string; example: string };
  responses: ResponseDef[];
}

interface GroupDef {
  name: string;
  description: string;
  endpoints: EndpointDef[];
}

const ENDPOINT_GROUPS: GroupDef[] = [
  {
    name: "Registration",
    description:
      "Create and manage agent registration sessions. Returns session tokens, QR data, and deep links for the Self app.",
    endpoints: [
      {
        method: "POST",
        path: "/api/agent/register",
        summary: "Initiate agent registration",
        description:
          "Creates a new registration session. Returns session token, QR code data, deep link, and the generated agent address. The user must scan the QR with the Self app to submit a passport proof.",
        parameters: [],
        requestBody: {
          example: `{
  "mode": "agent-identity",
  "network": "testnet",
  "humanAddress": "0x...",
  "disclosures": {
    "minimumAge": 18,
    "ofac": true,
    "nationality": false,
    "name": false
  }
}`,
          description:
            'Modes: "verified-wallet", "agent-identity", "wallet-free". Networks: "mainnet", "testnet".',
        },
        responses: [
          {
            status: 200,
            description: "Session created successfully",
            example: `{
  "sessionToken": "enc_...",
  "deepLink": "selfapp://verify?scope=...",
  "qrData": "selfapp://verify?scope=...",
  "agentAddress": "0x83fa...ff00",
  "mode": "agent-identity",
  "network": "testnet"
}`,
          },
          {
            status: 400,
            description: "Invalid parameters or missing fields",
            example: `{ "error": "humanAddress is required for agent-identity mode" }`,
          },
        ],
      },
      {
        method: "GET",
        path: "/api/agent/register/status",
        summary: "Poll registration status",
        description:
          'Returns current registration stage: "qr-ready", "proof-received", "completed", or "failed". Once completed, includes on-chain agent ID and transaction hash.',
        parameters: [
          {
            name: "token",
            in: "query",
            type: "string",
            required: true,
            description: "Encrypted session token from POST /register",
          },
        ],
        responses: [
          {
            status: 200,
            description: "Current session status",
            example: `{
  "stage": "completed",
  "agentId": 42,
  "agentAddress": "0x83fa...ff00",
  "txHash": "0xabc...",
  "sessionToken": "enc_..."
}`,
          },
          { status: 410, description: "Session expired (30-minute TTL)" },
        ],
      },
      {
        method: "POST",
        path: "/api/agent/register/callback",
        summary: "Receive Self app callback",
        description:
          "Webhook endpoint called by the Self app after the user scans the QR and submits a passport proof. Updates session stage to proof-received and triggers on-chain registration.",
        parameters: [
          {
            name: "token",
            in: "query",
            type: "string",
            required: true,
            description: "Encrypted session token",
          },
        ],
        responses: [
          { status: 200, description: "Callback processed" },
          { status: 401, description: "Invalid or tampered token" },
        ],
      },
      {
        method: "GET",
        path: "/api/agent/register/qr",
        summary: "Get QR code and deep link",
        description:
          "Returns the QR code image URL and deep link for the current session. Use this if you need to re-render the QR.",
        parameters: [
          {
            name: "token",
            in: "query",
            type: "string",
            required: true,
            description: "Encrypted session token",
          },
        ],
        responses: [
          {
            status: 200,
            description: "QR data returned",
            example: `{
  "qrData": "selfapp://verify?scope=...",
  "deepLink": "selfapp://verify?scope=..."
}`,
          },
        ],
      },
      {
        method: "GET",
        path: "/api/agent/register/export",
        summary: "Export agent private key",
        description:
          'After registration completes, export the agent\'s private key. Only available for "agent-identity" and "wallet-free" modes.',
        parameters: [
          {
            name: "token",
            in: "query",
            type: "string",
            required: true,
            description: "Encrypted session token",
          },
        ],
        responses: [
          {
            status: 200,
            description: "Private key exported",
            example: `{
  "privateKey": "0xdeadbeef...",
  "agentAddress": "0x83fa...ff00",
  "agentId": 42
}`,
          },
          {
            status: 409,
            description: "Session not in completed stage",
          },
        ],
      },
    ],
  },
  {
    name: "Deregistration",
    description:
      "Remove an agent from the on-chain registry. Requires the same passport proof flow as registration.",
    endpoints: [
      {
        method: "POST",
        path: "/api/agent/deregister",
        summary: "Initiate agent deregistration",
        description:
          "Verifies the agent exists on-chain, then creates a deregistration session with QR data. The human must re-prove identity to burn the agent NFT.",
        parameters: [],
        requestBody: {
          example: `{
  "network": "testnet",
  "agentAddress": "0x...",
  "disclosures": {
    "minimumAge": 18,
    "ofac": true
  }
}`,
        },
        responses: [
          {
            status: 200,
            description: "Deregistration session created",
            example: `{
  "sessionToken": "enc_...",
  "deepLink": "selfapp://verify?scope=...",
  "qrData": "selfapp://verify?scope=..."
}`,
          },
          { status: 404, description: "Agent not found on-chain" },
        ],
      },
      {
        method: "GET",
        path: "/api/agent/deregister/status",
        summary: "Poll deregistration status",
        description:
          "Returns current deregistration stage. Once completed, the agent NFT has been burned.",
        parameters: [
          {
            name: "token",
            in: "query",
            type: "string",
            required: true,
            description: "Encrypted session token from POST /deregister",
          },
        ],
        responses: [
          {
            status: 200,
            description: "Current deregistration status",
            example: `{
  "stage": "completed",
  "txHash": "0xdef..."
}`,
          },
        ],
      },
      {
        method: "POST",
        path: "/api/agent/deregister/callback",
        summary: "Receive deregistration callback",
        description:
          "Webhook endpoint for the Self app after the user confirms deregistration.",
        parameters: [
          {
            name: "token",
            in: "query",
            type: "string",
            required: true,
            description: "Encrypted session token",
          },
        ],
        responses: [
          { status: 200, description: "Callback processed" },
          { status: 401, description: "Invalid or tampered token" },
        ],
      },
    ],
  },
  {
    name: "Query",
    description:
      "Read-only endpoints for querying on-chain agent data. No session token required. Use chain ID 42220 for mainnet or 44787 for Celo Sepolia testnet.",
    endpoints: [
      {
        method: "GET",
        path: "/api/agent/info/{chainId}/{agentId}",
        summary: "Get agent details",
        description:
          "Returns full agent information: address, verification status, proof provider, credentials, and registration timestamp.",
        parameters: [
          {
            name: "chainId",
            in: "path",
            type: "number",
            required: true,
            description: "42220 (mainnet) or 44787 (testnet)",
          },
          {
            name: "agentId",
            in: "path",
            type: "number",
            required: true,
            description: "On-chain agent token ID",
          },
        ],
        responses: [
          {
            status: 200,
            description: "Agent details",
            example: `{
  "agentId": 5,
  "chainId": 44787,
  "agentAddress": "0x83fa...ff00",
  "isVerified": true,
  "proofProvider": "0x69Da...9b80c",
  "verificationStrength": 2,
  "strengthLabel": "Standard",
  "credentials": {
    "nationality": "GBR",
    "olderThan": 18,
    "ofac": [false, false, false]
  },
  "registeredAt": 1740000000,
  "network": "testnet"
}`,
          },
          { status: 404, description: "Agent not found" },
        ],
      },
      {
        method: "GET",
        path: "/api/agent/agents/{chainId}/{address}",
        summary: "List agents by human address",
        description:
          "Returns all agent IDs registered by a specific human wallet address.",
        parameters: [
          {
            name: "chainId",
            in: "path",
            type: "number",
            required: true,
            description: "42220 (mainnet) or 44787 (testnet)",
          },
          {
            name: "address",
            in: "path",
            type: "string",
            required: true,
            description: "Human wallet address (0x...)",
          },
        ],
        responses: [
          {
            status: 200,
            description: "List of agent IDs",
            example: `{
  "agents": [5, 12, 37],
  "chainId": 44787,
  "humanAddress": "0xabc..."
}`,
          },
        ],
      },
      {
        method: "GET",
        path: "/api/agent/verify/{chainId}/{agentId}",
        summary: "Verify agent proof-of-human",
        description:
          "Checks whether an agent has valid proof-of-human verification, the proof provider address, verification strength label, and Sybil metrics.",
        parameters: [
          {
            name: "chainId",
            in: "path",
            type: "number",
            required: true,
            description: "42220 (mainnet) or 44787 (testnet)",
          },
          {
            name: "agentId",
            in: "path",
            type: "number",
            required: true,
            description: "On-chain agent token ID",
          },
        ],
        responses: [
          {
            status: 200,
            description: "Verification result",
            example: `{
  "agentId": 5,
  "isVerified": true,
  "proofProvider": "0x69Da...9b80c",
  "strengthLabel": "Standard",
  "humanAgentCount": 1,
  "maxAgentsPerHuman": 1
}`,
          },
          { status: 404, description: "Agent not found" },
        ],
      },
    ],
  },
  {
    name: "Discovery",
    description:
      "Well-known endpoint for service discovery and capability advertisement.",
    endpoints: [
      {
        method: "GET",
        path: "/.well-known/self-agent-id.json",
        summary: "Service discovery document",
        description:
          "Returns the service discovery document with API base URL, supported networks, registration modes, and capabilities.",
        parameters: [],
        responses: [
          {
            status: 200,
            description: "Discovery document",
            example: `{
  "api": "https://selfagentid.xyz/api/agent",
  "networks": ["mainnet", "testnet"],
  "modes": ["verified-wallet", "agent-identity", "wallet-free"],
  "capabilities": ["register", "deregister", "query", "verify"]
}`,
          },
        ],
      },
    ],
  },
];

/* ── Chevron icon ──────────────────────────────────────────────────── */

function ChevronIcon({ open }: { open: boolean }) {
  return (
    <svg
      className={`w-4 h-4 text-muted transition-transform duration-200 ${
        open ? "rotate-90" : ""
      }`}
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={2}
    >
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
    </svg>
  );
}

/* ── Method badge with Swagger-style colors ────────────────────────── */

const METHOD_COLORS = {
  GET: {
    bg: "bg-emerald-500/10",
    border: "border-emerald-500",
    text: "text-emerald-400",
    expandBg: "bg-emerald-500/5",
  },
  POST: {
    bg: "bg-blue-500/10",
    border: "border-blue-500",
    text: "text-blue-400",
    expandBg: "bg-blue-500/5",
  },
} as const;

function MethodBadge({ method }: { method: "GET" | "POST" }) {
  const c = METHOD_COLORS[method];
  return (
    <span
      className={`inline-flex items-center justify-center w-16 px-2 py-0.5 rounded text-xs font-bold uppercase tracking-wide ${c.bg} ${c.text} border ${c.border}`}
    >
      {method}
    </span>
  );
}

/* ── Parameter table ───────────────────────────────────────────────── */

function ParameterTable({ params }: { params: Param[] }) {
  if (params.length === 0) return null;
  return (
    <div className="mt-4">
      <h4 className="text-sm font-semibold text-foreground mb-2">Parameters</h4>
      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-surface-2/50 border-b border-border">
              <th className="text-left px-3 py-2 text-muted font-medium">Name</th>
              <th className="text-left px-3 py-2 text-muted font-medium">In</th>
              <th className="text-left px-3 py-2 text-muted font-medium">Type</th>
              <th className="text-left px-3 py-2 text-muted font-medium">Required</th>
              <th className="text-left px-3 py-2 text-muted font-medium">Description</th>
            </tr>
          </thead>
          <tbody>
            {params.map((p) => (
              <tr key={p.name} className="border-b border-border/30">
                <td className="px-3 py-2 font-mono text-accent-2 text-xs">
                  {p.name}
                </td>
                <td className="px-3 py-2 text-muted text-xs">{p.in}</td>
                <td className="px-3 py-2 text-muted text-xs">{p.type}</td>
                <td className="px-3 py-2">
                  {p.required ? (
                    <span className="text-accent-error text-xs font-medium">required</span>
                  ) : (
                    <span className="text-muted text-xs">optional</span>
                  )}
                </td>
                <td className="px-3 py-2 text-muted text-xs">{p.description}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* ── Response block ────────────────────────────────────────────────── */

function ResponseBlock({ responses }: { responses: ResponseDef[] }) {
  const [openStatus, setOpenStatus] = useState<number | null>(null);

  const statusVariant = (s: number) => {
    if (s >= 200 && s < 300) return "success";
    if (s >= 400 && s < 500) return "warn";
    return "error";
  };

  return (
    <div className="mt-4">
      <h4 className="text-sm font-semibold text-foreground mb-2">Responses</h4>
      <div className="space-y-1">
        {responses.map((r) => (
          <div key={r.status} className="rounded-lg border border-border overflow-hidden">
            <button
              onClick={() =>
                setOpenStatus(openStatus === r.status ? null : r.status)
              }
              className="w-full flex items-center gap-3 px-3 py-2 hover:bg-surface-2/30 transition-colors"
            >
              <ChevronIcon open={openStatus === r.status} />
              <Badge variant={statusVariant(r.status)}>{r.status}</Badge>
              <span className="text-sm text-muted">{r.description}</span>
            </button>
            {openStatus === r.status && r.example && (
              <div className="px-3 pb-3">
                <CodeBlock
                  tabs={[{ label: "Response", language: "json", code: r.example }]}
                />
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

/* ── Endpoint row ──────────────────────────────────────────────────── */

function EndpointRow({ endpoint }: { endpoint: EndpointDef }) {
  const [open, setOpen] = useState(false);
  const c = METHOD_COLORS[endpoint.method];

  return (
    <div className={`rounded-lg border-l-4 ${c.border} overflow-hidden`}>
      {/* Collapsed bar */}
      <button
        onClick={() => setOpen(!open)}
        className={`w-full flex items-center gap-3 px-4 py-3 ${c.bg} hover:brightness-125 transition-all cursor-pointer`}
      >
        <MethodBadge method={endpoint.method} />
        <code className="text-sm text-foreground font-mono">{endpoint.path}</code>
        <span className="text-sm text-muted hidden sm:inline ml-2">
          {endpoint.summary}
        </span>
        <span className="ml-auto">
          <ChevronIcon open={open} />
        </span>
      </button>

      {/* Expanded detail */}
      {open && (
        <div className={`px-4 py-4 bg-surface-1 border-t border-border space-y-3`}>
          <p className="text-sm text-muted">{endpoint.description}</p>

          <ParameterTable params={endpoint.parameters} />

          {endpoint.requestBody && (
            <div className="mt-4">
              <h4 className="text-sm font-semibold text-foreground mb-1">
                Request Body
              </h4>
              {endpoint.requestBody.description && (
                <p className="text-xs text-muted mb-2">
                  {endpoint.requestBody.description}
                </p>
              )}
              <CodeBlock
                tabs={[
                  {
                    label: "JSON",
                    language: "json",
                    code: endpoint.requestBody.example,
                  },
                ]}
              />
            </div>
          )}

          <ResponseBlock responses={endpoint.responses} />
        </div>
      )}
    </div>
  );
}

/* ── Endpoint group ────────────────────────────────────────────────── */

function EndpointGroup({ group }: { group: GroupDef }) {
  const [open, setOpen] = useState(true);

  return (
    <div className="rounded-xl border border-border overflow-hidden">
      {/* Group header */}
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center gap-3 px-5 py-3 bg-surface-1 hover:bg-surface-2/50 transition-colors cursor-pointer"
      >
        <ChevronIcon open={open} />
        <h3 className="text-base font-bold text-foreground">{group.name}</h3>
        <Badge variant="muted">{group.endpoints.length}</Badge>
        <span className="text-sm text-muted hidden sm:inline ml-2">
          {group.description}
        </span>
      </button>

      {/* Endpoints */}
      {open && (
        <div className="px-4 pb-4 pt-2 space-y-2 bg-surface-2/20">
          {group.endpoints.map((ep) => (
            <EndpointRow key={ep.method + ep.path} endpoint={ep} />
          ))}
        </div>
      )}
    </div>
  );
}

/* ── Page ───────────────────────────────────────────────────────────── */

export default function ApiDocsPage() {
  return (
    <main className="min-h-screen max-w-4xl mx-auto px-6 pt-24 pb-12">
      {/* Hero */}
      <div className="flex justify-center mb-8">
        <MatrixText text="REST API" fontSize={44} />
      </div>

      <div className="space-y-6">
        {/* Overview */}
        <Card>
          <h2 className="text-lg font-bold mb-2">Overview</h2>
          <p className="text-sm text-muted mb-4">
            The Self Agent ID REST API lets you programmatically register,
            deregister, and query AI agents with on-chain proof-of-human
            verification. No API keys required — sessions use encrypted tokens
            with a 30-minute TTL.
          </p>
          <div className="text-sm text-muted space-y-1">
            <p>
              <span className="text-foreground font-medium">Base URL:</span>{" "}
              <code className="bg-surface-2 px-1 rounded text-accent-2">
                https://selfagentid.xyz/api/agent
              </code>
            </p>
            <p>
              <span className="text-foreground font-medium">Discovery:</span>{" "}
              <code className="bg-surface-2 px-1 rounded text-accent-2">
                GET /.well-known/self-agent-id.json
              </code>
            </p>
          </div>
          <div className="mt-4 rounded-lg bg-surface-2 p-4 font-mono text-xs text-muted leading-relaxed">
            <p className="text-foreground mb-1">Session lifecycle:</p>
            <p>
              POST /register →{" "}
              <span className="text-accent">session token</span>
            </p>
            <p>↳ User scans QR with Self app → proof submitted on-chain</p>
            <p>
              GET /register/status?token= → poll until{" "}
              <span className="text-accent-success">completed</span>
            </p>
            <p>GET /register/export?token= → retrieve agent private key</p>
          </div>
        </Card>

        {/* Quick Start */}
        <Card>
          <h2 className="text-lg font-bold mb-2">Quick Start</h2>
          <p className="text-sm text-muted mb-3">
            Register an agent in 3 steps using curl:
          </p>
          <CodeBlock
            tabs={[
              {
                label: "curl",
                language: "bash",
                code: `# 1. Initiate registration
curl -X POST https://selfagentid.xyz/api/agent/register \\
  -H "Content-Type: application/json" \\
  -d '{
    "mode": "agent-identity",
    "network": "testnet",
    "humanAddress": "0xYourWalletAddress"
  }'
# → { sessionToken, deepLink, agentAddress, ... }

# 2. Show deepLink to user (or render QR)
#    User scans QR with Self app → passport proof submitted

# 3. Poll for completion
curl "https://selfagentid.xyz/api/agent/register/status?token=SESSION_TOKEN"
# → { stage: "completed", agentId: 42, ... }

# 4. (Optional) Export agent private key
curl "https://selfagentid.xyz/api/agent/register/export?token=SESSION_TOKEN"
# → { privateKey, agentAddress, agentId }`,
              },
            ]}
          />
        </Card>

        {/* ── Interactive Endpoint Groups ── */}
        <div className="space-y-4">
          <h2 className="text-lg font-bold">Endpoints</h2>
          {ENDPOINT_GROUPS.map((g) => (
            <EndpointGroup key={g.name} group={g} />
          ))}
        </div>

        {/* SDK Integration */}
        <Card>
          <h2 className="text-lg font-bold mb-2">SDK Integration</h2>
          <p className="text-sm text-muted mb-3">
            SDKs wrap the REST API and provide typed helpers for registration,
            verification, and signed requests.
          </p>
          <CodeBlock
            tabs={[
              {
                label: "TypeScript",
                language: "typescript",
                code: `import { SelfAgent } from "@selfxyz/agent-sdk";

const agent = new SelfAgent({
  endpoint: "https://selfagentid.xyz",
  network: "testnet",
});

// Request registration — returns session with QR link
const session = await agent.requestRegistration({
  mode: "agent-identity",
  humanAddress: "0xYourWallet",
  disclosures: { minimumAge: 18, ofac: true },
});

console.log(session.deepLink); // show to user
console.log(session.sessionToken); // save for polling

// Poll until complete
const result = await agent.waitForRegistration(session.sessionToken);
console.log(result.agentId); // on-chain agent ID`,
              },
              {
                label: "Python",
                language: "python",
                code: `from self_agent_sdk import SelfAgent

agent = SelfAgent(
    endpoint="https://selfagentid.xyz",
    network="testnet",
)

# Request registration
session = agent.request_registration(
    mode="agent-identity",
    human_address="0xYourWallet",
    disclosures={"minimum_age": 18, "ofac": True},
)

print(session.deep_link)  # show to user
print(session.session_token)  # save for polling

# Poll until complete
result = agent.wait_for_registration(session.session_token)
print(result.agent_id)  # on-chain agent ID`,
              },
              {
                label: "Rust",
                language: "typescript",
                code: `use self_agent_sdk::SelfAgent;

let agent = SelfAgent::new(
    "https://selfagentid.xyz",
    "testnet",
);

// Request registration
let session = agent.request_registration(
    "agent-identity",
    "0xYourWallet",
    Disclosures { minimum_age: 18, ofac: true, ..Default::default() },
).await?;

println!("{}", session.deep_link); // show to user

// Poll until complete
let result = agent.wait_for_registration(&session.session_token).await?;
println!("Agent ID: {}", result.agent_id);`,
              },
            ]}
          />
        </Card>

        {/* Authentication */}
        <Card>
          <h2 className="text-lg font-bold mb-2">Authentication</h2>
          <p className="text-sm text-muted mb-3">
            The API uses encrypted session tokens instead of API keys. Tokens are
            returned by{" "}
            <code className="bg-surface-2 px-1 rounded text-accent-2">
              POST /register
            </code>{" "}
            and{" "}
            <code className="bg-surface-2 px-1 rounded text-accent-2">
              POST /deregister
            </code>{" "}
            and must be passed as a{" "}
            <code className="bg-surface-2 px-1 rounded text-accent-2">token</code>{" "}
            query parameter to all subsequent endpoints.
          </p>
          <ul className="list-disc list-inside text-sm text-muted space-y-1">
            <li>
              Tokens expire after{" "}
              <span className="text-foreground font-medium">30 minutes</span>
            </li>
            <li>
              Each token is scoped to a single registration or deregistration
              session
            </li>
            <li>
              Updated tokens are returned in each response — always use the
              latest one
            </li>
            <li>
              Query endpoints (
              <code className="bg-surface-2 px-1 rounded text-accent-2">
                /info
              </code>
              ,{" "}
              <code className="bg-surface-2 px-1 rounded text-accent-2">
                /agents
              </code>
              ,{" "}
              <code className="bg-surface-2 px-1 rounded text-accent-2">
                /verify
              </code>
              ) require no authentication
            </li>
          </ul>
        </Card>

        {/* Errors */}
        <Card>
          <h2 className="text-lg font-bold mb-2">Error Codes</h2>
          <p className="text-sm text-muted mb-3">
            All errors return{" "}
            <code className="bg-surface-2 px-1 rounded text-accent-2">
              {`{ "error": "message" }`}
            </code>{" "}
            with the appropriate HTTP status.
          </p>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left">
                  <th className="pb-2 pr-4 text-foreground font-medium">Code</th>
                  <th className="pb-2 text-foreground font-medium">Meaning</th>
                </tr>
              </thead>
              <tbody className="text-muted">
                {[
                  ["400", "Bad request — invalid parameters, missing fields, or wrong mode"],
                  ["401", "Invalid or tampered session token"],
                  ["404", "Agent not found on-chain"],
                  ["409", "Operation not available at current session stage"],
                  ["410", "Session expired (30-minute TTL)"],
                  ["500", "Server error — RPC failure or configuration issue"],
                ].map(([code, meaning], i, arr) => (
                  <tr
                    key={code}
                    className={i < arr.length - 1 ? "border-b border-border/50" : ""}
                  >
                    <td className="py-2 pr-4 font-mono">{code}</td>
                    <td className="py-2">{meaning}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>

        {/* Footer */}
        <Card>
          <p className="text-sm text-muted">
            Full source code and SDK packages are available on{" "}
            <Link
              href="https://github.com/selfxyz/self-agent-id"
              target="_blank"
              rel="noopener noreferrer"
              className="text-accent hover:text-accent-2 underline underline-offset-2"
            >
              GitHub
            </Link>
            . See the{" "}
            <Link
              href="/cli"
              className="text-accent hover:text-accent-2 underline underline-offset-2"
            >
              CLI Quickstart
            </Link>{" "}
            for command-line usage.
          </p>
        </Card>
      </div>
    </main>
  );
}
