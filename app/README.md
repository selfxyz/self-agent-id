# Self Agent ID API

The Next.js service behind [agent-api.self.xyz](https://agent-api.self.xyz): REST, A2A, MCP and discovery. No UI; `/` redirects to the docs.

```bash
cp .env.example .env.local   # set SESSION_SECRET: openssl rand -hex 32
npm install && npm run dev   # http://localhost:3000
npm test
```

Routes and schemas: [openapi.yaml](../openapi.yaml) · [REST API docs](https://docs.self.xyz/docs/agent-id/rest-api/).

## Conventions

- Path params take a chain ID (`42220` or `11142220`); bodies take `"network": "mainnet" | "testnet"`.
- Errors are `{ "error": "..." }`: 404 unknown agent, 429 + `Retry-After`, 502 RPC failure.
- Verified always means `hasHumanProof && isProofFresh`.
- Session tokens go in `Authorization: Bearer`; 30 min, rotated on every poll.
- Contract addresses live in [`lib/network.ts`](lib/network.ts).

## Limits (per IP)

10/min session starts · 120/min polls, reads, MCP · 60/min QR, A2A, visa batch · 20/min wallet/nullifier scans · 20/h visa writes. Shared across instances only when Upstash Redis is set. Set `RATE_LIMIT_MULTIPLIER` (e.g. `5`) to scale them for an event; visa write caps stay fixed.

## Environment

Source of truth: [`.env.example`](.env.example).

| Variable                                                   | Purpose                                                               |
| ---------------------------------------------------------- | --------------------------------------------------------------------- |
| `SESSION_SECRET`                                           | **Required.** Encrypts session tokens                                 |
| `NEXT_PUBLIC_APP_URL`                                      | Public base URL in links (default `https://agent-api.self.xyz`)       |
| `NEXT_PUBLIC_DEFAULT_NETWORK`                              | `celo-mainnet` (default) or `celo-sepolia`                            |
| `NEXT_PUBLIC_SELF_APP_NAME`, `NEXT_PUBLIC_SELF_SCOPE_SEED` | Must match the registry (`Self Agent ID` / `self-agent-id`)           |
| `RPC_CELO`, `RPC_CELO_SEPOLIA`                             | Server-only RPC URLs (keyed is fine; never published). Default: Forno |
| `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN`       | Shared rate-limit and replay store. Set in production                 |
| `RELAYER_PRIVATE_KEY`                                      | Visa relayer. Unset → visa writes 503                                 |
| `MCP_PRIVILEGED_API_KEYS` / `MCP_PRIVILEGED_API_KEY`       | Bearer key(s) for privileged MCP tools                                |
| `SELF_AGENT_PRIVATE_KEY`, `SELF_AGENT_NETWORK`             | Agent for privileged MCP tools. Leave unset on shared deployments     |
| `MCP_AUTH_FETCH_*`, `MCP_VERIFY_REQUEST_REPLAY_PROTECTION` | Same as [`@selfxyz/mcp-server`](../mcp/README.md#config)              |
