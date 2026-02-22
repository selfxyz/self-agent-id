import Link from "next/link";
import MatrixText from "@/components/MatrixText";
import { Card } from "@/components/Card";
import CodeBlock from "@/components/CodeBlock";
import { Badge } from "@/components/Badge";

function MethodBadge({ method }: { method: string }) {
  const variant =
    method === "GET" ? "success" : method === "POST" ? "info" : "muted";
  return <Badge variant={variant}>{method}</Badge>;
}

function Endpoint({
  method,
  path,
  description,
}: {
  method: string;
  path: string;
  description: string;
}) {
  return (
    <div className="flex items-start gap-3 py-2">
      <MethodBadge method={method} />
      <div className="min-w-0">
        <code className="bg-surface-2 px-1 rounded text-accent-2 text-sm break-all">
          {path}
        </code>
        <p className="text-xs text-muted mt-0.5">{description}</p>
      </div>
    </div>
  );
}

export default function ApiDocsPage() {
  return (
    <main className="min-h-screen max-w-4xl mx-auto px-6 pt-24 pb-12">
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
            verification. No API keys required — sessions use encrypted
            tokens with a 30-minute TTL.
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
              POST /register → <span className="text-accent">session token</span>
            </p>
            <p>
              ↳ User scans QR with Self app → proof submitted on-chain
            </p>
            <p>
              GET /register/status?token= → poll until{" "}
              <span className="text-accent-success">completed</span>
            </p>
            <p>
              GET /register/export?token= → retrieve agent private key
            </p>
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

        {/* Registration Endpoints */}
        <Card>
          <h2 className="text-lg font-bold mb-4">Registration Endpoints</h2>

          <Endpoint
            method="POST"
            path="/api/agent/register"
            description="Initiate agent registration. Returns session token, QR data, and deep link."
          />
          <div className="ml-8 mb-4">
            <p className="text-xs text-muted mb-2">Request body:</p>
            <CodeBlock
              tabs={[
                {
                  label: "JSON",
                  language: "json",
                  code: `{
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
                },
              ]}
            />
            <p className="text-xs text-muted mt-2">
              <span className="text-foreground">Modes:</span>{" "}
              <code className="bg-surface-2 px-1 rounded text-accent-2">verified-wallet</code>{" "}
              <code className="bg-surface-2 px-1 rounded text-accent-2">agent-identity</code>{" "}
              <code className="bg-surface-2 px-1 rounded text-accent-2">wallet-free</code>
            </p>
            <p className="text-xs text-muted">
              <span className="text-foreground">Networks:</span>{" "}
              <code className="bg-surface-2 px-1 rounded text-accent-2">mainnet</code>{" "}
              <code className="bg-surface-2 px-1 rounded text-accent-2">testnet</code>
            </p>
          </div>

          <Endpoint
            method="GET"
            path="/api/agent/register/status?token=TOKEN"
            description="Poll registration status. Returns stage (qr-ready, proof-received, completed, failed) and on-chain data."
          />

          <Endpoint
            method="POST"
            path="/api/agent/register/callback?token=TOKEN"
            description="Receives callback from Self app after passport scan. Updates session stage."
          />

          <Endpoint
            method="GET"
            path="/api/agent/register/qr?token=TOKEN"
            description="Returns QR code image URL and deep link for the Self app."
          />

          <Endpoint
            method="GET"
            path="/api/agent/register/export?token=TOKEN"
            description="Export agent private key after registration completes. Only for agent-identity and wallet-free modes."
          />
        </Card>

        {/* Deregistration Endpoints */}
        <Card>
          <h2 className="text-lg font-bold mb-4">Deregistration Endpoints</h2>

          <Endpoint
            method="POST"
            path="/api/agent/deregister"
            description="Initiate agent deregistration. Verifies agent exists on-chain, then returns session token and QR."
          />
          <div className="ml-8 mb-4">
            <p className="text-xs text-muted mb-2">Request body:</p>
            <CodeBlock
              tabs={[
                {
                  label: "JSON",
                  language: "json",
                  code: `{
  "network": "testnet",
  "agentAddress": "0x...",
  "disclosures": {
    "minimumAge": 18,
    "ofac": true
  }
}`,
                },
              ]}
            />
          </div>

          <Endpoint
            method="GET"
            path="/api/agent/deregister/status?token=TOKEN"
            description="Poll deregistration status until agent NFT is burned."
          />

          <Endpoint
            method="POST"
            path="/api/agent/deregister/callback?token=TOKEN"
            description="Receives callback from Self app after deregistration proof."
          />
        </Card>

        {/* Query Endpoints */}
        <Card>
          <h2 className="text-lg font-bold mb-4">Query Endpoints</h2>
          <p className="text-sm text-muted mb-3">
            Read-only endpoints for querying agent data. No session token required.
            Use chain ID{" "}
            <code className="bg-surface-2 px-1 rounded text-accent-2">42220</code>{" "}
            for mainnet or{" "}
            <code className="bg-surface-2 px-1 rounded text-accent-2">44787</code>{" "}
            for Celo Sepolia testnet.
          </p>

          <Endpoint
            method="GET"
            path="/api/agent/info/:chainId/:agentId"
            description="Get full agent details: address, verification status, provider, credentials, registration timestamp."
          />
          <div className="ml-8 mb-4">
            <p className="text-xs text-muted mb-2">Example response:</p>
            <CodeBlock
              tabs={[
                {
                  label: "JSON",
                  language: "json",
                  code: `{
  "agentId": 5,
  "chainId": 44787,
  "agentAddress": "0x83fa..ff00",
  "isVerified": true,
  "proofProvider": "0x69Da..9b80c",
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
              ]}
            />
          </div>

          <Endpoint
            method="GET"
            path="/api/agent/agents/:chainId/:address"
            description="List agents registered by a human wallet address."
          />

          <Endpoint
            method="GET"
            path="/api/agent/verify/:chainId/:agentId"
            description="Verify an agent's proof-of-human status, provider, strength label, and Sybil metrics."
          />
        </Card>

        {/* Discovery */}
        <Card>
          <h2 className="text-lg font-bold mb-4">Discovery</h2>
          <Endpoint
            method="GET"
            path="/.well-known/self-agent-id.json"
            description="Service discovery document with API base URL, supported networks, modes, and capabilities."
          />
        </Card>

        {/* SDK Integration */}
        <Card>
          <h2 className="text-lg font-bold mb-2">SDK Integration</h2>
          <p className="text-sm text-muted mb-3">
            SDKs wrap the REST API and provide typed helpers for registration, verification, and signed requests.
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
            The API uses encrypted session tokens instead of API keys. Tokens are returned by{" "}
            <code className="bg-surface-2 px-1 rounded text-accent-2">POST /register</code>{" "}
            and{" "}
            <code className="bg-surface-2 px-1 rounded text-accent-2">POST /deregister</code>{" "}
            and must be passed as a{" "}
            <code className="bg-surface-2 px-1 rounded text-accent-2">token</code> query parameter
            to all subsequent endpoints.
          </p>
          <ul className="list-disc list-inside text-sm text-muted space-y-1">
            <li>Tokens expire after <span className="text-foreground font-medium">30 minutes</span></li>
            <li>Each token is scoped to a single registration or deregistration session</li>
            <li>Updated tokens are returned in each response — always use the latest one</li>
            <li>Query endpoints (<code className="bg-surface-2 px-1 rounded text-accent-2">/info</code>, <code className="bg-surface-2 px-1 rounded text-accent-2">/agents</code>, <code className="bg-surface-2 px-1 rounded text-accent-2">/verify</code>) require no authentication</li>
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
                <tr className="border-b border-border/50">
                  <td className="py-2 pr-4 font-mono">400</td>
                  <td className="py-2">Bad request — invalid parameters, missing fields, or wrong mode</td>
                </tr>
                <tr className="border-b border-border/50">
                  <td className="py-2 pr-4 font-mono">401</td>
                  <td className="py-2">Invalid or tampered session token</td>
                </tr>
                <tr className="border-b border-border/50">
                  <td className="py-2 pr-4 font-mono">404</td>
                  <td className="py-2">Agent not found on-chain</td>
                </tr>
                <tr className="border-b border-border/50">
                  <td className="py-2 pr-4 font-mono">409</td>
                  <td className="py-2">Operation not available at current session stage</td>
                </tr>
                <tr className="border-b border-border/50">
                  <td className="py-2 pr-4 font-mono">410</td>
                  <td className="py-2">Session expired (30-minute TTL)</td>
                </tr>
                <tr>
                  <td className="py-2 pr-4 font-mono">500</td>
                  <td className="py-2">Server error — RPC failure or configuration issue</td>
                </tr>
              </tbody>
            </table>
          </div>
        </Card>

        {/* Footer link */}
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
