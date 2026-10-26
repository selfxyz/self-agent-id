# Self Agent ID API

API-only Next.js service behind [agent-api.self.xyz](https://agent-api.self.xyz): REST, A2A, MCP and discovery over the on-chain registry. It renders registration QR codes, tracks sessions, relays signed visa writes and serves chain reads as JSON. There is no UI: `/` and old UI pages redirect (308) to [docs.self.xyz](https://docs.self.xyz).

```bash
cp .env.example .env.local   # set SESSION_SECRET (openssl rand -hex 32)
npm install && npm run dev   # http://localhost:3000
npm test                     # vitest
npm run build && npm start   # production
```

Only `SESSION_SECRET` is required (session routes return 500 without it). Reads and discovery need no secrets; visa writes return 503 without `RELAYER_PRIVATE_KEY`. Full request/response reference: [docs/api-docs.md](../docs/api-docs.md) and [openapi.yaml](../openapi.yaml).

## Conventions

- Path params take a chain ID (`42220` mainnet, `11142220` testnet; others are 400). Bodies take `"network": "mainnet" | "testnet"`.
- Errors are `{ "error": "..." }`. 404 for never-minted or burned agents, 429 with `Retry-After`, 500 `Failed to render QR code` whenever a QR image can't be rendered, 502 `RPC error` when the chain can't be read.
- Every response carries CORS headers (`Access-Control-Allow-Origin: *`), including the `GET /api/agent/refresh` 302 and the MCP route's own errors; `/api/mcp` also allows the MCP transport headers (`Mcp-Protocol-Version`, `Mcp-Session-Id`, `Last-Event-ID`) and answers `OPTIONS`.
- Routes and A2A intents with no network/chain use `NEXT_PUBLIC_DEFAULT_NETWORK` (mainnet by default).
- **Verified** always means `hasHumanProof && isProofFresh`.
- Contract addresses are hardcoded in [`lib/network.ts`](lib/network.ts) (listed in [contracts/README.md](../contracts/README.md#deployed-addresses)).

## Auth

| Kind           | Used by                                 | How                                                                                                                                                  |
| -------------- | --------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| None           | Discovery, reads, A2A, public MCP tools | —                                                                                                                                                    |
| Session token  | Register, deregister, refresh, identify | Issued by the opening POST; 30 min, AES-256-GCM, rotated on every poll. `Authorization: Bearer` only (`export` also takes `{ "token" }` in the body) |
| QR token       | `/api/qr/:qrToken` (the `scanUrl`)      | Renders the QR only; unlocks nothing else                                                                                                            |
| Signed request | Visa writes                             | EIP-191 signature by the NFT owner / agent key, `timestamp` ±5 min, single use ([format](../docs/api-docs.md#writes))                                |
| MCP key        | Privileged MCP tools                    | `Authorization: Bearer <key>` from `MCP_PRIVILEGED_API_KEY(S)`                                                                                       |

Rate limits are per IP and shared across instances only when Upstash Redis is set.

## Routes

| Method | Path                                                      | Purpose                                                                             | Limit/min |
| ------ | --------------------------------------------------------- | ----------------------------------------------------------------------------------- | :-------: |
| GET    | `/`                                                       | `Accept: application/json` → discovery; `text/plain` → `llms.txt`; else 308 to docs |     —     |
| GET    | `/api/health`                                             | Health check                                                                        |     —     |
| GET    | `/api/agent-discovery`, `/.well-known/self-agent-id.json` | Service descriptor (modes, aliases, networks, endpoints)                            |     —     |
| GET    | `/api/agent/bootstrap`                                    | OpenAPI 3.1 subset for registration (`/.well-known/agent-registration` 307s here)   |     —     |
| GET    | `/.well-known/agent-card.json`                            | Registry A2A card; `?agentId=&chainId=` → that agent's card                         |    120    |
| GET    | `/.well-known/a2a/:agentId`                               | 307 to `/api/cards/:chainId/:agentId` (`?chain=`, default 42220)                    |     —     |
| GET    | `/agents.json`, `/llms.txt`                               | Entry-point index; LLM-readable guide                                               |     —     |
| GET    | `/api/agent/info/:chainId/:agentId`                       | Key, address, verification, expiry, strength, credentials                           |    120    |
| GET    | `/api/agent/verify/:chainId/:agentId`                     | Proof status, provider, nullifier, agent count                                      |    120    |
| GET    | `/api/agent/agents/:chainId/:address`                     | Agents a wallet owns or keys (`complete` flag)                                      |    20     |
| GET    | `/api/agent/agents-by-nullifier/:chainId/:nullifier`      | Active agents of one human                                                          |    20     |
| GET    | `/api/cards/:chainId/:agentId`                            | ERC-8004 card with a live `selfProtocol` block                                      |    120    |
| GET    | `/api/reputation/:chainId/:agentId`                       | Verification-strength score (0–100)                                                 |    120    |
| GET    | `/api/verify-status/:chainId/:agentId`                    | Compact proof status and freshness                                                  |    120    |
| POST   | `/api/agent/register`                                     | Start registration → `sessionToken`, `scanUrl`, `deepLink`, `agentAddress`          |    10     |
| GET    | `/api/agent/register/status`                              | Poll `qr-ready` → `completed` (410 once expired)                                    |    120    |
| GET    | `/api/agent/register/qr`                                  | Re-fetch `deepLink`, `qrData`, `scanUrl`                                            |    120    |
| POST   | `/api/agent/register/export`                              | Generated private key, after completion (not Ed25519); always `no-store`            |    120    |
| POST   | `/api/agent/register/ed25519-challenge`                   | `{ pubkey, network }` → `challengeHash` to sign                                     |    10     |
| GET    | `/api/agent/register/ed25519-check`                       | Is this pubkey registered? (`?pubkey=&network=`)                                    |    120    |
| POST   | `/api/agent/deregister`                                   | Start deregistration (`agentAddress` or `agentId`; not Ed25519)                     |    10     |
| POST   | `/api/agent/refresh`                                      | Start a proof refresh (`agentId`, `network`, `disclosures?`)                        |    10     |
| GET    | `/api/agent/refresh`                                      | Shareable refresh link: 302 to the Self app (`?agentId=&network=`)                  |    20     |
| POST   | `/api/agent/identify`                                     | Start identify (find a human's nullifier)                                           |    10     |
| GET    | `/api/agent/{deregister,refresh,identify}/status`         | Poll the session                                                                    |    120    |
| GET    | `/api/qr/:qrToken`                                        | QR PNG behind `scanUrl`                                                             |    60     |
| GET    | `/cli/register?payload=`                                  | QR PNG for the CLI handoff                                                          |    60     |
| GET    | `/api/visa/:chainId/:agentId`                             | Visa tier, metrics, eligibility                                                     |    120    |
| GET    | `/api/visa/:chainId/batch?agents=`                        | Tiers for up to 100 agents (duplicates collapsed)                                   |    60     |
| GET    | `/api/visa/agents?wallet=&chainId=`                       | Visa agent IDs of a wallet                                                          |    20     |
| POST   | `/api/visa/{claim,migrate,request-review}`                | Signed, relayed visa writes (server pays gas)                                       | per hour  |
| POST   | `/api/a2a`                                                | A2A v0.3.0 JSON-RPC (`message/send`, `tasks/get`, `tasks/cancel`)                   |    60     |
| POST   | `/api/mcp`                                                | Stateless MCP over Streamable HTTP (GET/DELETE → 405; OPTIONS → 204)                |    120    |
| any    | `/api/*`, `/.well-known/*` (unknown)                      | JSON 404 with links to discovery                                                    |     —     |

Session lifecycle: the status poll that first observes completion resets the session's expiry to 30 min from then, for `export` (only that poll returns `credentials`); a pending EVM-mode session can still be polled for 24 h after expiry to catch a late scan. Identify polls only scan blocks added since the previous poll (the rotated token records the last block scanned).

Visa writes: 20 attempts/h per IP (counted before the signature is checked); relayed transactions 5/h per IP, 2/h per signer, 50/h global. A signature is single-use once it verifies, so re-sign after any later error, including a 5xx. A 502 with `txHash` means the relayer broadcast that transaction but could not confirm it; it may still mine.

A2A: `message/send` 60/min per IP; `lookup`, `verify`, `freshness`, `deregister` and the `X-Agent-Id` check also spend the 120/min read budget. `message/stream` → 400 `UNSUPPORTED_OPERATION`.

MCP tools are listed in [plugin/README.md](../plugin/README.md#mcp-tools); they call these handlers in-process, so they count against the same limits. `self_verify_request` handles ECDSA (secp256k1) signed requests only; use the SDK's `SelfAgentVerifier` for Ed25519.

## Environment

Source of truth: [`.env.example`](.env.example).

| Variable                                                   | Purpose                                                                                    |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| `SESSION_SECRET`                                           | **Required.** Encrypts session tokens. `openssl rand -hex 32`                              |
| `NEXT_PUBLIC_APP_URL`                                      | Public base URL in every link (`scanUrl`, discovery). Default `https://agent-api.self.xyz` |
| `NEXT_PUBLIC_DEFAULT_NETWORK`                              | `celo-mainnet` (default) or `celo-sepolia`, for routes without a network                   |
| `NEXT_PUBLIC_SELF_APP_NAME`, `NEXT_PUBLIC_SELF_SCOPE_SEED` | Must match the registry config (`Self Agent ID` / `self-agent-id`)                         |
| `NEXT_PUBLIC_RPC_CELO`, `NEXT_PUBLIC_RPC_CELO_SEPOLIA`     | Private RPCs (default: Forno)                                                              |
| `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN`       | Shared rate-limit and visa replay store. Recommended in production                         |
| `RELAYER_PRIVATE_KEY`                                      | Visa relayer (MINTER_ROLE / METRICS_UPDATER_ROLE). Unset → visa writes 503                 |
| `MCP_PRIVILEGED_API_KEYS`, `MCP_PRIVILEGED_API_KEY`        | Bearer key(s) for privileged MCP tools (comma list or one key)                             |
| `SELF_AGENT_PRIVATE_KEY`                                   | Agent key for privileged MCP tools. Leave unset on shared deployments                      |
| `SELF_AGENT_NETWORK`, `SELF_RPC_URL`                       | That agent's network (`testnet`, else mainnet) and RPC override                            |
| `SELF_AGENT_API_BASE`                                      | Point MCP tools at another deployment over HTTP (default: in-process)                      |
| `MCP_AUTH_FETCH_ALLOWED_HOSTS`                             | Host allowlist for `self_authenticated_fetch` (supports `*.example.com`)                   |
| `MCP_AUTH_FETCH_ALLOW_PRIVATE_NETWORKS`                    | `true` allows private targets (dev only; default `false`)                                  |
| `MCP_VERIFY_REQUEST_REPLAY_PROTECTION`                     | Replay protection for `self_verify_request` (default `true`)                               |
