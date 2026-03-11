# Standalone TypeScript Ed25519 Agent

Reference implementation demonstrating the full Ed25519 agent lifecycle with `@selfxyz/agent-sdk`.

## Quick Start

```bash
npm install
# Generate a new keypair and check registration
npx tsx agent.ts
# Run E2E demo tests against Sepolia
ED25519_SEED=<your-seed> npx tsx e2e-demo-test.ts
```

## What This Demonstrates

1. **Keygen** — Generate an Ed25519 keypair from a 32-byte seed
2. **Register** — Check registration status, guide user through QR flow
3. **Authenticate** — Sign HTTP requests with Ed25519 via `agent.fetch()`
4. **Verify** — Service-side verification using `SelfAgentVerifier`

## Environment Variables

| Variable        | Description                      | Default                                 |
| --------------- | -------------------------------- | --------------------------------------- |
| `ED25519_SEED`  | 64-char hex Ed25519 seed         | Random (generated)                      |
| `SERVICE_URL`   | Target service URL               | `http://localhost:3000/api/demo/verify` |
| `DEMO_BASE_URL` | Demo API base URL (for E2E test) | `https://app.ai.self.xyz`               |

## Ed25519 vs ECDSA

Ed25519 agents are ideal for non-Ethereum environments (Python, Rust, embedded systems). The signing protocol is identical — only the cryptographic primitive changes. Services verify both types transparently via `SelfAgentVerifier`.
