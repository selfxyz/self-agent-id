# Self Agent ID API

API-only service for Self Agent ID. It exposes the registry over HTTP (REST, A2A JSON-RPC, MCP, agent-card discovery) plus the registration and visa flows. There is no web interface. Registration minting and verification happen on-chain; this service renders the QR, tracks sessions, proxies gasless ops, and serves on-chain reads as JSON.

Most reads are thin wrappers over registry contract calls, so you can also reproduce them directly with the SDK or a plain RPC call. The recommended way to integrate is the SDK.

## Networks

| Network                | Chain ID   | Registry                                     |
| ---------------------- | ---------- | -------------------------------------------- |
| Celo Mainnet           | `42220`    | `0xaC3DF9ABf80d0F5c020C06B04Cced27763355944` |
| Celo Sepolia (testnet) | `11142220` | `0x043DaCac8b0771DD5b444bCC88f2f8BBDBEdd379` |

Endpoints that take a `chainId` accept either. Use `?network=celo-sepolia` (or `testnet`) where a query param is supported.

## Run locally

```bash
cp .env.example .env.local   # see Environment below
npm install
npm run dev                  # http://localhost:3000
npm run build && npm start   # production
npm test                     # vitest
```

Feature endpoints degrade gracefully if their secret is unset (for example visa claim returns "relayer not configured" without `RELAYER_PRIVATE_KEY`). Read and discovery endpoints work with no secrets.

## How to consume

### Option 1: SDK (recommended)

```ts
import { SelfAgent, SelfAgentVerifier } from "@selfxyz/agent-sdk";

// Sign outbound requests as a registered agent
const agent = new SelfAgent({ privateKey, registryAddress, rpcUrl });
await agent.fetch("https://service.example.com/api/protected", {
  method: "POST",
});

// Verify inbound agent requests in your service (100% on-chain, no API needed)
const verifier = new SelfAgentVerifier({ registryAddress, rpcUrl });
app.use("/api", verifier.auth());
```

To register, render the QR in your own frontend with `@selfxyz/qrcode`, or drive the REST flow below. See the docs for the full registration walkthrough.

### Option 2: Raw HTTP

```bash
BASE=http://localhost:3000   # or your deployed host

# Read an agent (no auth)
curl -s "$BASE/api/agent/info/11142220/1"

# Service discovery (machine-readable)
curl -s -H "Accept: application/json" "$BASE/"        # -> /api/agent-discovery
curl -s "$BASE/.well-known/self-agent-id.json"

# Start a registration session, then render the returned QR
curl -s -X POST "$BASE/api/agent/register" \
  -H "Content-Type: application/json" \
  -d '{"mode":"linked","network":"testnet","humanAddress":"0xYourWallet","disclosures":{"minimumAge":18}}'
# take the sessionToken from the response:
curl -s "$BASE/api/qr/<sessionToken>" --output qr.png
# poll until complete:
curl -s "$BASE/api/agent/register/status?token=<sessionToken>"
```

## Routes

`:param` is a path segment. All paths are relative to the base URL.

### Discovery and metadata — no auth

| Method    | Path                              | Purpose                                                                                                 |
| --------- | --------------------------------- | ------------------------------------------------------------------------------------------------------- |
| GET       | `/`                               | Content-negotiated root. `Accept: application/json` returns discovery; `text/plain` returns `llms.txt`. |
| GET       | `/api/health`                     | Health check.                                                                                           |
| GET       | `/api/agent-discovery`            | Full machine-readable service descriptor (networks, modes, endpoints).                                  |
| GET, POST | `/api/agent/bootstrap`            | Agent bootstrap descriptor for autonomous clients.                                                      |
| GET       | `/.well-known/self-agent-id.json` | Service discovery document.                                                                             |
| GET       | `/.well-known/agent-card.json`    | A2A agent card.                                                                                         |
| GET       | `/.well-known/agent-registration` | ERC-8004 registration descriptor.                                                                       |
| GET       | `/.well-known/a2a/:agentId`       | A2A discovery; resolves to the agent card.                                                              |
| GET       | `/agents.json`                    | Index of registered agents.                                                                             |
| GET       | `/llms.txt`                       | LLM-readable usage guide.                                                                               |

### Reads / queries — no auth (on-chain wrappers)

| Method | Path                                                 | Purpose                                                       |
| ------ | ---------------------------------------------------- | ------------------------------------------------------------- |
| GET    | `/api/agent/info/:chainId/:agentId`                  | Agent registration details, verification status, credentials. |
| GET    | `/api/agent/agents/:chainId/:address`                | Agent IDs owned by a wallet.                                  |
| GET    | `/api/agent/agents-by-nullifier/:chainId/:nullifier` | Agents for a human nullifier (sybil view).                    |
| GET    | `/api/agent/verify/:chainId/:agentId`                | Proof-of-human status, provider, strength, sybil metrics.     |
| GET    | `/api/cards/:chainId/:agentId`                       | A2A-compatible agent card.                                    |
| GET    | `/api/reputation/:chainId/:agentId`                  | Verification strength score.                                  |
| GET    | `/api/verify-status/:chainId/:agentId`               | Real-time proof status and freshness.                         |
| GET    | `/api/visa/:chainId/:agentId`                        | Visa tier, metrics, eligibility.                              |
| GET    | `/api/visa/:chainId/batch`                           | Visa status for many agents at once.                          |
| GET    | `/api/visa/agents`                                   | Visa-holding agents for a wallet (`?wallet=&chainId=`).       |

### A2A — no auth

| Method | Path       | Purpose                                                                                                 |
| ------ | ---------- | ------------------------------------------------------------------------------------------------------- |
| POST   | `/api/a2a` | A2A JSON-RPC 2.0. Intents: `register`, `status`, `lookup`, `verify`, `deregister`, `freshness`, `help`. |

### Registration and lifecycle — session-token auth

Each flow starts with a POST that returns an encrypted `sessionToken` (30 min TTL); subsequent calls pass it as `?token=` (or in the body for `export`). The mint itself happens on-chain via the Self app.

| Method | Path                                    | Purpose                                                                                     |
| ------ | --------------------------------------- | ------------------------------------------------------------------------------------------- |
| POST   | `/api/agent/register`                   | Start a registration session; returns `sessionToken`, `deepLink`, `qrData`, `agentAddress`. |
| GET    | `/api/agent/register/status`            | Poll registration (`qr-ready` → `proof-received` → `completed`).                            |
| GET    | `/api/agent/register/qr`                | QR payload / deep link for the session.                                                     |
| POST   | `/api/agent/register/callback`          | Self-app webhook after passport scan (updates session stage).                               |
| POST   | `/api/agent/register/export`            | Export the generated agent key (token in body).                                             |
| POST   | `/api/agent/register/ed25519-challenge` | Get the Ed25519 registration challenge.                                                     |
| GET    | `/api/agent/register/ed25519-check`     | Check an Ed25519 signature/key.                                                             |
| GET    | `/api/agent/register/ed25519-poll`      | Poll an Ed25519 registration.                                                               |
| POST   | `/api/agent/deregister`                 | Start deregistration (burns the NFT after re-proof).                                        |
| GET    | `/api/agent/deregister/status`          | Poll deregistration.                                                                        |
| POST   | `/api/agent/deregister/callback`        | Self-app webhook for deregistration.                                                        |
| POST   | `/api/agent/identify`                   | Start an identify session (find agents for a human).                                        |
| GET    | `/api/agent/identify/status`            | Poll identify; returns nullifier and agent count.                                           |
| POST   | `/api/agent/refresh`                    | Start a proof refresh for an existing agent.                                                |
| GET    | `/api/agent/refresh/status`             | Poll refresh.                                                                               |
| GET    | `/api/qr/:sessionToken`                 | Server-rendered QR PNG for a session (no SDK needed).                                       |

### Account-abstraction proxy — origin + proxy-token auth

Backs the gasless smart-wallet mode. Origin-restricted (`AA_PROXY_ALLOWED_ORIGINS`); bundler/paymaster require the `x-aa-proxy-token` header from `/api/aa/token`.

| Method | Path                | Purpose                                           |
| ------ | ------------------- | ------------------------------------------------- |
| POST   | `/api/aa/token`     | Issue a short-lived proxy token (origin-checked). |
| POST   | `/api/aa/bundler`   | Proxy ERC-4337 bundler JSON-RPC to Pimlico.       |
| POST   | `/api/aa/paymaster` | Proxy ERC-4337 paymaster JSON-RPC to Pimlico.     |

### Visa writes — relayer-backed, rate-limited

The server signs and submits with `RELAYER_PRIVATE_KEY` so the user pays no gas.

| Method | Path                       | Purpose                         |
| ------ | -------------------------- | ------------------------------- |
| POST   | `/api/visa/claim`          | Gasless mint/upgrade of a visa. |
| POST   | `/api/visa/migrate`        | Migrate a visa.                 |
| POST   | `/api/visa/request-review` | Request manual tier review.     |

### MCP — signed agent headers (optional)

| Method                 | Path       | Purpose                                                                                               |
| ---------------------- | ---------- | ----------------------------------------------------------------------------------------------------- |
| GET, POST, PUT, DELETE | `/api/mcp` | MCP server. Accepts `x-self-agent-*` signed headers for authenticated tools; query-only without them. |

### Fallback

| Method | Path     | Purpose                                           |
| ------ | -------- | ------------------------------------------------- |
| any    | `/api/*` | Unknown API paths return a structured JSON error. |

## Authentication

- **No auth** — discovery, metadata, all reads, and A2A. Open to anyone.
- **Session token** — registration/deregistration/identify/refresh flows and `/api/qr/:sessionToken`. The token is an encrypted, 30-minute, single-flow credential issued by the opening POST. Not an API key.
- **Origin + proxy token** — the `/api/aa/*` proxy. Requires an allowlisted `Origin` and the `x-aa-proxy-token` from `/api/aa/token`.
- **Relayer** — the visa write endpoints submit on-chain using a server-held key; rate-limited per human.
- **Signed agent headers** — `/api/mcp` accepts `x-self-agent-*` headers (produced by `SelfAgent`) for authenticated tools.

Verification of agent requests in your own service is fully on-chain via `SelfAgentVerifier` and needs none of this.

## Environment

Use `.env.example` as the source of truth. Common variables:

- `NEXT_PUBLIC_APP_URL` — public base URL of this deployment.
- `RPC_URL` — Celo RPC (defaults to public Forno endpoints per network).
- `RELAYER_PRIVATE_KEY` — funds gasless visa writes (required for `/api/visa/claim|migrate|request-review`).
- `PIMLICO_API_KEY` — required for the AA proxy (`/api/aa/*`).
- `AA_PROXY_ALLOWED_ORIGINS` — comma-separated origins allowed to call the AA proxy.
