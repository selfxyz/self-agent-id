# Self Agent ID

[![npm](https://img.shields.io/npm/v/@selfxyz/agent-sdk?label=npm)](https://www.npmjs.com/package/@selfxyz/agent-sdk)
[![MCP](https://img.shields.io/badge/MCP-remote-blue)](https://agent-api.self.xyz/api/mcp)
[![License: BUSL--1.1](https://img.shields.io/badge/license-BUSL--1.1-blue.svg)](LICENSE)

Proof-of-human identity for AI agents on Celo. A human scans their passport once with the Self app; the agent gets a soulbound ERC-8004 NFT and signs every request with its own key. Services verify the signature and the on-chain proof — no API key, no central server in the verification path.

- **API**: [agent-api.self.xyz](https://agent-api.self.xyz) (REST, A2A, MCP)
- **Clients**: TypeScript SDK [`@selfxyz/agent-sdk`](https://www.npmjs.com/package/@selfxyz/agent-sdk), or plain HTTP from any language
- **Docs**: [docs.self.xyz/agent-id](https://docs.self.xyz/agent-id) · **Standard**: [ERC-8004](https://eips.ethereum.org/EIPS/eip-8004) + [Proof-of-Human extension](docs/EIP_DRAFT_PROOF_OF_HUMAN.md)

## Quick start

```bash
npm install @selfxyz/agent-sdk
```

**1. Register** (the human scans `scanUrl` with the Self app):

```ts
import { requestRegistration } from "@selfxyz/agent-sdk";

const session = await requestRegistration({
  mode: "linked", // or "wallet-free" (no human wallet needed)
  network: "testnet",
  humanAddress: "0xYourWallet",
  disclosures: { minimumAge: 18, ofac: true },
});
console.log(session.scanUrl); // PNG of the QR code; session.deepLink opens the app
const { agentId } = await session.waitForCompletion(); // polls, default 30 min
const privateKey = await session.exportKey(); // EVM modes only, once
```

**2. Sign requests** (agent side):

```ts
import { SelfAgent } from "@selfxyz/agent-sdk";

const agent = new SelfAgent({ privateKey, network: "testnet" });
await agent.fetch("https://api.example.com/data", {
  method: "POST",
  body: JSON.stringify({ q: "hi" }),
});
```

**3. Verify requests** (service side, Express):

```ts
import { SelfAgentVerifier } from "@selfxyz/agent-sdk";

const verifier = SelfAgentVerifier.create()
  .network("testnet")
  .requireAge(18)
  .build();
// The signature covers the exact body bytes: keep them as req.rawBody
// (a request with a body but no raw body gets a 500).
app.use(
  express.json({
    verify: (req, _res, buf) => {
      (req as { rawBody?: Buffer }).rawBody = buf;
    },
  }),
);
app.use("/api", verifier.auth()); // sets req.agent (VerifiedAgent)
```

Guides: [agent builder](https://docs.self.xyz/agent-id/guides/agent-builder) · [service operator](https://docs.self.xyz/agent-id/guides/service-operator) · [contract developer](https://docs.self.xyz/agent-id/guides/contract-developer) · [MCP user](https://docs.self.xyz/agent-id/guides/mcp-user).

Prefer a shell? `npx self-agent register init --mode linked --human-address 0x... --network testnet`, then `register open` / `wait` / `export` ([CLI spec](docs/CLI_REGISTRATION.md)). Prefer raw HTTP? See [docs/api-docs.md](docs/api-docs.md#quick-start).

## What's in this repo

| Path                                          | What                                                                                                                                                           |
| --------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`app/`](app/README.md)                       | API service (Next.js route handlers, no UI): REST, A2A, MCP, discovery                                                                                         |
| [`typescript-sdk/`](typescript-sdk/README.md) | `@selfxyz/agent-sdk`: signing, verification, registration, `self-agent` CLI                                                                                    |
| [`mcp/`](mcp/README.md)                       | `@selfxyz/mcp-server`: local stdio MCP server that signs with your own agent key                                                                               |
| [`contracts/`](contracts/README.md)           | Solidity registry and helpers (Foundry); deployed addresses                                                                                                    |
| [`docs/api-docs.md`](docs/api-docs.md)        | Full REST reference (machine-readable: [`openapi.yaml`](openapi.yaml))                                                                                         |
| [`plugin/`](plugin/README.md)                 | Claude Code plugin: 6 skills + the hosted MCP server                                                                                                           |
| [`examples/`](examples/README.md)             | Minimal ECDSA agent + verifier, Ed25519 reference, Eliza plugin                                                                                                |
| [`docs/`](docs/)                              | [Integration guide](docs/integration.md), [Self Protocol integration](docs/SELF_PROTOCOL_INTEGRATION.md), [registration JSON](docs/AGENT_REGISTRATION_JSON.md) |

## Registration modes

`POST /api/agent/register` and `requestRegistration` take one of six modes. Legacy aliases: `walletfree` → `wallet-free`, `smart-wallet` → `smartwallet`.

| Mode             | Agent key                         | NFT owner                     | `humanAddress` | Guardian     | Action byte |
| ---------------- | --------------------------------- | ----------------------------- | :------------: | ------------ | :---------: |
| `linked`         | Server-generated EVM key (export) | Human wallet                  |    required    | —            |     `K`     |
| `wallet-free`    | Server-generated EVM key (export) | Agent address (self-owned)    |       —        | —            |     `W`     |
| `privy`          | Same as `linked`                  | Human's Privy embedded wallet |    required    | —            |     `K`     |
| `smartwallet`    | Same as `linked`                  | Human's passkey smart wallet  |    required    | —            |     `K`     |
| `ed25519`        | Agent's own Ed25519 key           | Address derived from pubkey   |       —        | —            |     `E`     |
| `ed25519-linked` | Agent's own Ed25519 key           | Address derived from pubkey   |    required    | Human wallet |     `E`     |

- **`linked`** is the default choice when the human has a wallet; **`wallet-free`** is the quickest start.
- **`privy` / `smartwallet`** behave exactly like `linked`; the server only needs the address.
- **Ed25519 modes** keep the agent's key: get `challengeHash` from `POST /api/agent/register/ed25519-challenge`, sign its raw 32 bytes, send `ed25519Pubkey` + `ed25519Signature`. Nothing to export. Deregister on-chain via the guardian (`guardianRevoke`), not the API.
- The CLI supports `linked` and `wallet-free` only.

Disclosures pick one of six on-chain verification configs (minimum age 0/18/21 × OFAC off/on). Other disclosure flags: `nationality`, `name`, `date_of_birth`, `gender`, `issuing_state`.

## How verification works

Every signed request carries these headers ([`HEADERS`](typescript-sdk/src/constants.ts)):

| Header                   | Value                                                                                                         |
| ------------------------ | ------------------------------------------------------------------------------------------------------------- |
| `x-self-agent-address`   | Agent's EVM address (for Ed25519, derived from the pubkey)                                                    |
| `x-self-agent-signature` | EIP-191 `personal_sign` over the 32 bytes of `keccak256(timestamp + METHOD + pathAndQuery + keccak256(body))` |
| `x-self-agent-timestamp` | Unix milliseconds; rejected when older than 5 min                                                             |
| `x-self-agent-keytype`   | Ed25519 agents only: `ed25519`                                                                                |
| `x-self-agent-key`       | Ed25519 agents only: public key hex                                                                           |

The verifier recovers the signer, then checks the registry: **verified = `hasHumanProof && isProofFresh`** (the same rule everywhere: SDK, API, contracts). Then it applies policy: Self provider, sybil limit, age, OFAC, nationality, rate limit.

**Proof expiry.** `proofExpiresAt = min(document expiry, registration time + 365 days)`. Renew in place with `requestProofRefresh({ agentId, network })` or `POST /api/agent/refresh`: the same human re-scans, the agent ID and key stay the same. Agent IDs whose 32-byte form contains a byte ≥ `0x80` (e.g. 128–255) can't be refreshed (422); deregister and register again.

**On-chain gating** (Solidity):

```solidity
bytes32 agentKey = bytes32(uint256(uint160(msg.sender)));
require(registry.isVerifiedAgent(agentKey) && registry.isProofFresh(registry.getAgentId(agentKey)), "Agent not human-verified");
```

## Networks

| Network      | Chain ID   | Registry                                     | RPC                                           |
| ------------ | ---------- | -------------------------------------------- | --------------------------------------------- |
| Celo Mainnet | `42220`    | `0xaC3DF9ABf80d0F5c020C06B04Cced27763355944` | `https://forno.celo.org`                      |
| Celo Sepolia | `11142220` | `0x043DaCac8b0771DD5b444bCC88f2f8BBDBEdd379` | `https://forno.celo-sepolia.celo-testnet.org` |

Celo Sepolia is `11142220`, not 44787 (Alfajores). All other addresses (provider, reputation, validation, visa, demo contracts, Hub V2): [contracts/README.md](contracts/README.md#deployed-addresses).

## API at a glance

Base URL `https://agent-api.self.xyz`. Full route table: [app/README.md](app/README.md#routes). Full reference: [docs/api-docs.md](docs/api-docs.md).

| Group           | Paths                                                                                                              | Auth                                 |
| --------------- | ------------------------------------------------------------------------------------------------------------------ | ------------------------------------ |
| Registration    | `/api/agent/register` (+ `/status`, `/qr`, `/export`, `/ed25519-challenge`, `/ed25519-check`)                      | Session token (Bearer)               |
| Lifecycle       | `/api/agent/deregister`, `/api/agent/refresh`, `/api/agent/identify` (+ `/status`)                                 | Session token (Bearer)               |
| Reads           | `/api/agent/info`, `/api/agent/agents`, `/api/agent/verify`, `/api/cards`, `/api/reputation`, `/api/verify-status` | None                                 |
| Celo Agent Visa | `/api/visa/*` reads; `/api/visa/claim`, `/migrate`, `/request-review` writes                                       | Reads none; writes signed            |
| Agent protocols | `/api/a2a` (A2A v0.3.0 JSON-RPC), `/api/mcp` (MCP Streamable HTTP)                                                 | None (MCP privileged tools: API key) |
| Discovery       | `/api/agent-discovery`, `/api/agent/bootstrap`, `/.well-known/*`, `/agents.json`, `/llms.txt`                      | None                                 |

**MCP** (Claude Code, Cursor, Windsurf, Codex, …): add `{ "mcpServers": { "self-agent-id": { "url": "https://agent-api.self.xyz/api/mcp" } } }`. Tool list: [plugin/README.md](plugin/README.md#mcp-tools). To sign as your own agent, run [`@selfxyz/mcp-server`](mcp/README.md) locally instead.

## Security

- **Session tokens**: AES-256-GCM encrypted, 30 min, rotated on every status poll, sent only as `Authorization: Bearer`. `scanUrl` uses a separate QR-only token that unlocks nothing else. A generated key can be exported once the human completes the scan, within 30 minutes.
- **Signed visa writes**: EIP-191 signature by the NFT owner or agent key, timestamp within ±5 min, each signature single-use. Limits: 20 signed attempts/IP/hour; relayed txs 2/signer, 5/IP, 50 global per hour. Message format: [docs/api-docs.md](docs/api-docs.md#writes).
- **Rate limits** (per IP, `429` + `Retry-After`): session starts 10/min; polls, reads and MCP 120/min; QR images, A2A and visa batch 60/min; wallet/nullifier scans 20/min. Shared across instances when Upstash Redis is configured.
- **Request signing**: verify the exact raw body bytes; the SDK verifier rejects stale timestamps (5 min) and replayed signatures.
- **Sybil resistance**: one nullifier per human; `maxAgentsPerHuman` defaults to 1 on-chain and in the verifier (`.sybilLimit(n)`). NFTs are soulbound (mint and burn only).

## Development

```bash
git submodule update --init --recursive                                 # contracts/lib
(cd contracts && forge build --evm-version cancun && ./scripts/test.sh)
(cd typescript-sdk && npm install && npm test)
(cd app && cp .env.example .env.local && npm install && npm run dev)   # set SESSION_SECRET first
npm install && npm run format:check && npm run lint                     # repo-wide
```

Environment variables: [app/README.md](app/README.md#environment) (service) and [typescript-sdk/README.md](typescript-sdk/README.md#configuration) (SDK/CLI).

License headers: `python3 scripts/lint-headers.py` checks, `python3 scripts/check-license-headers.py --fix` fixes, `./scripts/install-git-hooks.sh` installs the pre-commit hook.

## License

[Business Source License 1.1](LICENSE) (`BUSL-1.1`): non-commercial use is allowed; commercial use needs a license from Social Connect Labs, Inc. Converts to Apache-2.0 on 2029-06-11. Files under `contracts/` and `examples/` are MIT (per their SPDX headers).
