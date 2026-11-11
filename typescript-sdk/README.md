# @selfxyz/agent-sdk

Give an AI agent a human-backed on-chain identity, sign its requests, verify them in your service. Includes the `self-agent` CLI.

```bash
npm install @selfxyz/agent-sdk
```

Full reference: [SDK docs](https://docs.self.xyz/docs/agent-id/sdk-integration/) · [CLI docs](https://docs.self.xyz/docs/agent-id/cli/)

## 1. Register (a human scans a QR once)

```ts
import { requestRegistration } from "@selfxyz/agent-sdk";

const session = await requestRegistration({
  mode: "wallet-free", // or linked, privy, smartwallet, ed25519, ed25519-linked
  network: "testnet",
  disclosures: { minimumAge: 18, ofac: true },
});
console.log(session.deepLink); // open on the phone with the Self app
const { agentId } = await session.waitForCompletion();
const privateKey = await session.exportKey(); // EVM modes only, once
```

## 2. Sign requests (agent side)

```ts
import { SelfAgent } from "@selfxyz/agent-sdk";

const agent = new SelfAgent({ privateKey, network: "testnet" }); // Ed25519: new Ed25519Agent(...)
await agent.fetch("https://api.example.com/data", {
  method: "POST",
  body: JSON.stringify({ q: 1 }),
});
```

## 3. Verify requests (service side)

```ts
import express from "express";
import { SelfAgentVerifier } from "@selfxyz/agent-sdk";

const verifier = SelfAgentVerifier.create()
  .network("testnet")
  .requireAge(18)
  .sybilLimit(0) // default is 1 agent per human; 0 = no limit
  .build();

const app = express();
// The signature covers the exact body bytes: keep them as req.rawBody (missing → 500).
app.use(
  express.json({
    verify: (req, _res, buf) => ((req as { rawBody?: Buffer }).rawBody = buf),
  }),
);
app.post("/api/data", verifier.auth(), (req, res) =>
  res.json({ agentId: String(req.agent!.agentId) }),
);
```

No Express? `verifier.verify({ signature, timestamp, method, url, body })` with the raw header values.

## CLI

Defaults to **testnet** (the SDK classes default to **mainnet**). Supports `linked` and `wallet-free`.

```bash
npx -p @selfxyz/agent-sdk self-agent register init --mode wallet-free --minimum-age 18 --out .self/session.json
npx -p @selfxyz/agent-sdk self-agent register open --session .self/session.json   # prints the QR URL
npx -p @selfxyz/agent-sdk self-agent register wait --session .self/session.json   # exit 0 done, 2 timeout
npx -p @selfxyz/agent-sdk self-agent register export --session .self/session.json --unsafe --print-private-key
```

## Gotchas

| Symptom                                | Fix                                                              |
| -------------------------------------- | ---------------------------------------------------------------- |
| `Human has N agents (max 1)`           | `.sybilLimit(0)` or a higher number                              |
| `Agent not verified on-chain` on POSTs | Body bytes changed: verify `req.rawBody`, not re-serialized JSON |
| `does not meet minimum age (got: 0)`   | Register with the same disclosures the verifier requires         |
| `Timestamp expired or invalid`         | Clock skew over 5 min                                            |

Env: `SELF_AGENT_API_BASE` (default `https://agent-api.self.xyz`). License: [BUSL-1.1](../LICENSE).
