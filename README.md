<p align="center">
  <img src=".github/banner.svg" alt="Self Agent ID: proof-of-human identity for AI agents" width="100%">
</p>

<p align="center">
  <a href="#quick-start-5-min"><b>Quick start</b></a> ·
  <a href="https://docs.self.xyz/docs/agent-id/overview/"><b>Docs</b></a> ·
  <a href="docs/EIP_DRAFT_PROOF_OF_HUMAN.md"><b>EIP</b></a> ·
  <a href="openapi.yaml"><b>API</b></a> ·
  <a href="https://www.npmjs.com/package/@selfxyz/agent-sdk"><b>npm</b></a>
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@selfxyz/agent-sdk"><img src="https://img.shields.io/npm/v/@selfxyz/agent-sdk?label=agent-sdk&color=0A0A0A&labelColor=EFEFEF&style=flat-square" alt="npm @selfxyz/agent-sdk"></a>
  <a href="https://www.npmjs.com/package/@selfxyz/mcp-server"><img src="https://img.shields.io/npm/v/@selfxyz/mcp-server?label=mcp-server&color=0A0A0A&labelColor=EFEFEF&style=flat-square" alt="npm @selfxyz/mcp-server"></a>
  <a href="https://agent-api.self.xyz/api/health"><img src="https://img.shields.io/badge/API-agent--api.self.xyz-0A0A0A?labelColor=EFEFEF&style=flat-square" alt="API"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-BUSL--1.1-0A0A0A?labelColor=EFEFEF&style=flat-square" alt="License BUSL-1.1"></a>
</p>

A human scans their passport once with the Self app. Their AI agent gets a soulbound ERC-8004 NFT on Celo and signs every request with its own key. Services check the signature plus the on-chain proof. No API keys.

## Quick start (~5 min)

Needs Node 20+ and the Self app with a passport or ID card.

**1. Register** (~3 min, mostly the scan):

```ts
import { requestRegistration } from "@selfxyz/agent-sdk";

const session = await requestRegistration({
  mode: "wallet-free", // or "linked" with humanAddress: "0xYourWallet"
  network: "testnet",
  disclosures: { minimumAge: 18, ofac: true },
});
console.log(session.deepLink); // open on your phone
const { agentId } = await session.waitForCompletion();
const privateKey = await session.exportKey(); // once
```

**2. Sign** (agent side):

```ts
import { SelfAgent } from "@selfxyz/agent-sdk";

const agent = new SelfAgent({ privateKey, network: "testnet" });
await agent.fetch("https://api.example.com/data", {
  method: "POST",
  body: JSON.stringify({ q: "hi" }),
});
```

**3. Verify** (service side, Express):

```ts
import { SelfAgentVerifier } from "@selfxyz/agent-sdk";

const verifier = SelfAgentVerifier.create()
  .network("testnet")
  .requireAge(18)
  .sybilLimit(0)
  .build();
// The signature covers the exact body bytes: keep them as req.rawBody.
app.use(
  express.json({
    verify: (req, _res, buf) => ((req as { rawBody?: Buffer }).rawBody = buf),
  }),
);
app.use("/api", verifier.auth()); // sets req.agent
```

Done when your service answers `200` with `req.agent.agentId` set.

**No code?** CLI: `npx -p @selfxyz/agent-sdk self-agent register init --mode wallet-free --minimum-age 18 --out s.json`, then `register open`, `wait`, `export` ([CLI docs](https://docs.self.xyz/docs/agent-id/cli/)). Or import [openapi.yaml](openapi.yaml) into Postman / Insomnia / Hoppscotch and try agent `5` on chain `11142220`.

## Common errors

| Error                                | Fix                                                                |
| ------------------------------------ | ------------------------------------------------------------------ |
| `Human has N agents (max 1)`         | Verifier default is 1 agent per human: `.sybilLimit(0)` = no limit |
| `Agent not verified on-chain`        | Wrong network, or body changed after signing: verify `req.rawBody` |
| `does not meet minimum age (got: 0)` | Register with the disclosures the verifier requires                |
| `429` + `Retry-After`                | Per-IP limit (10 session starts/min, shared on the same Wi-Fi)     |

More: [troubleshooting](https://docs.self.xyz/docs/agent-id/troubleshooting/).

## Networks

| Network      | Chain ID   | Registry                                     | RPC                                           |
| ------------ | ---------- | -------------------------------------------- | --------------------------------------------- |
| Celo Mainnet | `42220`    | `0xaC3DF9ABf80d0F5c020C06B04Cced27763355944` | `https://forno.celo.org`                      |
| Celo Sepolia | `11142220` | `0x043DaCac8b0771DD5b444bCC88f2f8BBDBEdd379` | `https://forno.celo-sepolia.celo-testnet.org` |

Other addresses: [contracts/README.md](contracts/README.md#deployed-addresses). On-chain cap: 10 agents per human on mainnet, unlimited on Sepolia.

**Gate a contract:**

```solidity
bytes32 key = bytes32(uint256(uint160(msg.sender)));
require(registry.isVerifiedAgent(key) && registry.isProofFresh(registry.getAgentId(key)), "Not human-verified");
```

## MCP

Add to `.mcp.json` (Claude Code, Cursor, Windsurf, Codex):

```json
{
  "mcpServers": {
    "self-agent-id": { "url": "https://agent-api.self.xyz/api/mcp" }
  }
}
```

To sign as your own agent, run [`@selfxyz/mcp-server`](mcp/README.md) locally.

## Repo

| Path                                          | What                                                        |
| --------------------------------------------- | ----------------------------------------------------------- |
| [`app/`](app/README.md)                       | API service: REST, A2A, MCP, discovery                      |
| [`typescript-sdk/`](typescript-sdk/README.md) | `@selfxyz/agent-sdk` + `self-agent` CLI                     |
| [`mcp/`](mcp/README.md)                       | `@selfxyz/mcp-server`, local MCP server with your agent key |
| [`contracts/`](contracts/README.md)           | Solidity registry (Foundry), deployed addresses             |
| [`plugin/`](plugin/README.md)                 | Claude Code plugin: 6 skills + hosted MCP                   |
| [`docs/`](docs/)                              | EIP draft for the proof-of-human extension                  |

## Development

1. `git submodule update --init --recursive`
2. `(cd contracts && forge build && ./scripts/test.sh)`
3. `(cd typescript-sdk && npm install && npm test)`
4. `(cd app && cp .env.example .env.local && npm install && npm run dev)` (set `SESSION_SECRET`)
5. `npm install && npm run format:check && npm run lint`

## License

[BUSL-1.1](LICENSE): non-commercial use allowed; commercial use needs a license from Social Connect Labs, Inc. Converts to Apache-2.0 on 2029-06-11. `contracts/` and `mcp/` are MIT.
