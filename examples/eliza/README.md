# Eliza (ai16z) example

[`plugin.ts`](plugin.ts) gives an [Eliza](https://github.com/ai16z/eliza) agent a human-verified identity by registering its existing Ed25519 (Solana) key. Doc-quality code: adapt the plugin interface to your Eliza version.

```ts
import { createSelfIdentityPlugin } from "./plugin";

const plugin = createSelfIdentityPlugin(runtime); // reads settings via runtime.getSetting()
```

Install `@selfxyz/agent-sdk@^0.3.0` (until it's on npm: `npm install ../../typescript-sdk`).

| Setting              | Meaning                                                                   | Default   |
| -------------------- | ------------------------------------------------------------------------- | --------- |
| `SELF_ED25519_SEED`  | 32-byte Ed25519 seed as 64 hex chars                                      | —         |
| `SOLANA_PRIVATE_KEY` | Fallback seed (convert a base58 keypair to the hex of its first 32 bytes) | —         |
| `SELF_NETWORK`       | `testnet` or `mainnet`                                                    | `testnet` |

**Register the key once** (a human scans a QR with the Self app): `ED25519_SEED=<seed> npx tsx agent.ts --register` in [`../standalone-ts`](../standalone-ts/).

| Action               | Does                                             |
| -------------------- | ------------------------------------------------ |
| `checkIdentity`      | Registration status of this agent                |
| `signRequest`        | Signed headers for an HTTP request               |
| `authenticatedFetch` | Signed HTTP request                              |
| `verifyAgent`        | Verify another agent's request (sybil limit off) |
