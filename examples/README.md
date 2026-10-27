# Self Agent ID — Examples

Runnable TypeScript examples for `@selfxyz/agent-sdk` 0.3.0. MIT licensed.

```bash
cd minimal-ts && npm install && npm run service   # then, in another terminal: AGENT_PRIVATE_KEY=0x... npm run agent
```

Until 0.3.0 is on npm, install the SDK from this repo: `cd ../typescript-sdk && npm run build`, then `npm install ../../typescript-sdk` in the example.

| Example                         | Key     | Shows                                                     | Status           |
| ------------------------------- | ------- | --------------------------------------------------------- | ---------------- |
| [minimal-ts](minimal-ts/)       | ECDSA   | `SelfAgent` signing + Express `verifier.auth()` service   | Runtime tested   |
| [standalone-ts](standalone-ts/) | Ed25519 | Keygen, `ed25519` registration over REST, signed requests | Runtime tested   |
| [eliza](eliza/)                 | Ed25519 | Eliza plugin that reuses the agent's Solana key           | Doc-quality code |

## Ed25519 or ECDSA?

| Aspect              | ECDSA (`SelfAgent`)                             | Ed25519 (`Ed25519Agent`)    |
| ------------------- | ----------------------------------------------- | --------------------------- |
| Fits                | Ethereum / EVM agents                           | Solana, SSH, Eliza, non-EVM |
| Key format          | `0x` + 64 hex                                   | 64 hex (32-byte seed)       |
| Registration modes  | `linked`, `wallet-free`, `privy`, `smartwallet` | `ed25519`, `ed25519-linked` |
| Who holds the key   | API generates it; you export it once            | You; nothing to export      |
| On-chain verify gas | ~3K                                             | ~456K                       |

Both send the same signed headers (Ed25519 adds `x-self-agent-keytype` and `x-self-agent-key`); `SelfAgentVerifier` checks both.

## Gotchas

- `isRegistered()` only means a proof was recorded. Use `getInfo().isVerified` (`hasHumanProof && isProofFresh`), which is what verifiers require. Renew with `requestProofRefresh()`.
- `verifier.auth()` verifies the exact body bytes: keep them as `req.rawBody` via `express.json({ verify })` (see `minimal-ts/service.ts`). Without them, requests with a body get a 500.
- Use the same network (`testnet` / `mainnet`) on the agent and the verifier.
