# Standalone TypeScript example (Ed25519)

Full Ed25519 agent lifecycle with `Ed25519Agent`: keygen, registration, signed requests, then a `SelfAgentVerifier` check of its own signature. Testnet.

```bash
npm install                                         # SDK 0.3.0; until it's on npm: npm install ../../typescript-sdk
npx tsx agent.ts                                    # new random seed; prints address and registration status
ED25519_SEED=<seed> npx tsx agent.ts --register     # prints a QR URL for the Self app, waits on-chain
SERVICE_URL=http://localhost:3000/api/data ED25519_SEED=<seed> npx tsx agent.ts   # signed request
```

`SERVICE_URL` can point at the [minimal-ts](../minimal-ts/) verifier service.

| Variable              | Meaning                                 | Default                      |
| --------------------- | --------------------------------------- | ---------------------------- |
| `ED25519_SEED`        | 64-hex Ed25519 seed                     | Random                       |
| `SERVICE_URL`         | Protected endpoint for a signed request | Unset: skipped               |
| `SELF_AGENT_API_BASE` | Self Agent ID API base                  | `https://agent-api.self.xyz` |

**Registration flow** (`--register`): `POST /api/agent/register/ed25519-challenge` → sign the raw 32 bytes of `challengeHash` → `POST /api/agent/register` with `mode: "ed25519"`, `ed25519Pubkey`, `ed25519Signature` → show `scanUrl` → poll `isRegistered()` until it lands or the session expires.
