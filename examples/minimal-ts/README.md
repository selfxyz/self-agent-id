# Minimal TypeScript example (ECDSA)

A `SelfAgent` that signs a request, and an Express service that verifies it with `SelfAgentVerifier`. Testnet.

```bash
npm install                                  # SDK 0.3.0; until it's on npm: npm install ../../typescript-sdk
npm run service                              # verifier on http://localhost:3000
AGENT_PRIVATE_KEY=0x... npm run agent        # in another terminal; a registered testnet agent key
```

No key yet? Register one with `requestRegistration` or the `self-agent` CLI ([SDK README](../../typescript-sdk/README.md#registration-refresh-deregistration-rest)) and export it.

| File         | Does                                                                                                                                       |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `agent.ts`   | Prints `isRegistered()` and `getInfo()`; if `isVerified` (fresh proof), POSTs a signed request to `/api/data`                              |
| `service.ts` | Keeps `req.rawBody`, mounts `verifier.auth()` on `/api` with age ≥ 18, OFAC and a sybil limit of 3; `/api/data` echoes `req.agent.address` |

If the proof has expired, `agent.ts` says so and skips the request: refresh it with `requestProofRefresh()`.
