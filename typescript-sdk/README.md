# @selfxyz/agent-sdk

TypeScript SDK for [Self Agent ID](https://agent-api.self.xyz): give an AI agent a human-backed on-chain identity, sign its HTTP requests, and verify those requests in your service. Includes the `self-agent` CLI.

```bash
npm install @selfxyz/agent-sdk
```

Version 0.3.0 (breaking changes: [CHANGELOG.md](CHANGELOG.md)). Default network is `mainnet` (Celo, 42220); pass `network: "testnet"` for Celo Sepolia (11142220).

## Agent side: sign requests

```ts
import { SelfAgent, Ed25519Agent } from "@selfxyz/agent-sdk";

const agent = new SelfAgent({ privateKey: "0x...", network: "testnet" });
// or: new Ed25519Agent({ privateKey: "<64 hex chars>", network: "testnet" })

const res = await agent.fetch("https://api.example.com/data", {
  method: "POST",
  body: JSON.stringify({ q: "test" }), // string bodies default to application/json
});
const headers = await agent.signRequest("GET", "https://api.example.com/x"); // just the headers

const info = await agent.getInfo();
// info.isVerified === info.hasHumanProof && info.isProofFresh
```

| Method (`SelfAgent`)                                               | Returns                                                                                                                                                       |
| ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `address`, `agentKey`                                              | EVM address; bytes32 registry key (`zeroPad(address, 32)`)                                                                                                    |
| `fetch(url, init?)` / `signRequest(method, url, body?)`            | Signed `Response` / the `x-self-agent-*` headers                                                                                                              |
| `isRegistered()`                                                   | A human proof was recorded (stays `true` after it expires)                                                                                                    |
| `getInfo()`                                                        | `agentId`, `isVerified`, `hasHumanProof`, `isProofFresh`, `proofExpiresAt`, `daysUntilExpiry`, `isExpiringSoon`, `nullifier`, `agentCount`, `siblingAgentIds` |
| `getCredentials()` / `getCredentialsFromApi()`                     | ZK-attested credentials (nationality, `olderThan`, `ofac`, …), on-chain / via the API                                                                         |
| `getVerificationStrength()`                                        | 0–100 (100 = passport)                                                                                                                                        |
| `getAgentCard()` / `setAgentCard(fields)` / `toAgentCardDataURI()` | Read / write (tx, NFT owner only, needs CELO) / data URI of the A2A card                                                                                      |
| `requestDeregistration({ disclosures? })`                          | Deregistration session for this agent                                                                                                                         |

`Ed25519Agent` has `address`, `agentKey` (the raw pubkey), `fetch`, `signRequest`, `isRegistered`, `getInfo` and `Ed25519Agent.deriveAddress(pubkey)`. `setAgentCard` throws unless the agent key owns its NFT (wallet-free agents); for linked agents the human's wallet calls `updateAgentMetadata`.

## Service side: verify requests

```ts
import express from "express";
import { SelfAgentVerifier } from "@selfxyz/agent-sdk";

const verifier = SelfAgentVerifier.create()
  .network("testnet")
  .requireAge(18)
  .requireOFAC()
  .sybilLimit(3)
  .build();

const app = express();
// Signatures cover the exact body bytes: keep them as req.rawBody.
// A request with a body but no raw body gets a 500; an RPC failure gets a 503.
app.use(
  express.json({
    verify: (req, _res, buf) => {
      (req as { rawBody?: Buffer }).rawBody = buf;
    },
  }),
);
app.post("/api/data", verifier.auth(), (req, res) => {
  res.json({ agentId: req.agent!.agentId.toString() }); // req.agent: VerifiedAgent
});
```

Without Express, call `verifier.verify({ signature, timestamp, method, url, body, keytype?, agentKey? })` with the raw header values, `url` as path + query and `body` as the raw string. It returns `{ valid, agentAddress, agentId, error?, credentials?, … }`.

| Builder method                                     | Effect                                                | Default       |
| -------------------------------------------------- | ----------------------------------------------------- | ------------- |
| `.network(name)` / `.registry(addr)` / `.rpc(url)` | Chain to read                                         | `mainnet`     |
| `.requireAge(n)` / `.requireOFAC()`                | Credential policy (auto-fetches credentials)          | off           |
| `.requireNationality(...codes)`                    | ISO alpha-3 as on the passport, e.g. `"USA"`, `"GBR"` | off           |
| `.requireSelfProvider(enabled?)`                   | Proof must come from Self's provider                  | on            |
| `.sybilLimit(n)`                                   | Max agents per human (`0` = unlimited)                | `1`           |
| `.rateLimit({ perMinute?, perHour? })`             | Per-agent in-memory sliding window                    | off           |
| `.replayProtection(enabled?)`                      | Reject reused signatures (10k-entry cache)            | on            |
| `.includeCredentials()`                            | Attach credentials to the result                      | off           |
| `.maxAge(ms)` / `.cacheTtl(ms)`                    | Timestamp window / on-chain cache TTL                 | 5 min / 1 min |

Same options as a flat object: `SelfAgentVerifier.fromConfig({ network, requireAge, requireOFAC, requireNationality, sybilLimit, rateLimit, … })`, or `new SelfAgentVerifier(config)`.

Check order: timestamp → signature → replay → on-chain `isVerifiedAgent` + `isProofFresh` → provider → sybil → credentials (age, OFAC, nationality) → rate limit. Typical errors: `Timestamp expired or invalid`, `Invalid signature`, `Agent not verified on-chain`, `Agent's human proof has expired`.

`verifyAgent(agentKey, { network })` (or `{ chainId, registryAddress }` for a custom deployment) is a signature-free on-chain check returning `{ verified, agentId, expiresAt }` or `{ verified: false, reason: "NOT_REGISTERED" | "NO_HUMAN_PROOF" | "PROOF_EXPIRED", reauthUrl? }`. Like everywhere else, verified = `hasHumanProof && isProofFresh` (the registry's view, not the local clock).

## Registration, refresh, deregistration (REST)

```ts
import { requestRegistration, requestProofRefresh } from "@selfxyz/agent-sdk";

const session = await requestRegistration({
  mode: "wallet-free", // see modes below
  network: "testnet",
  disclosures: { minimumAge: 18, ofac: true },
});
console.log(session.scanUrl, session.humanInstructions); // show to the human
const { agentId, agentAddress } = await session.waitForCompletion(); // { timeoutMs?, pollIntervalMs? }
const privateKey = await session.exportKey(); // EVM modes only

const refresh = await requestProofRefresh({ agentId, network: "testnet" }); // same disclosures as registration
const { proofExpiresAt } = await refresh.waitForCompletion();
```

- **Modes** (`RegistrationMode`): `linked`, `wallet-free`, `privy`, `smartwallet` (server generates an exportable key; all but `wallet-free` need `humanAddress`) and `ed25519`, `ed25519-linked` (your own key: pass `ed25519Pubkey` + `ed25519Signature` over the challenge; nothing to export). Details: [mode table](../README.md#registration-modes).
- **Deregister**: `agent.requestDeregistration()` or `requestDeregistration({ network, agentAddress, disclosures? })`, then `waitForCompletion()`.
- **Lookups**: `getAgentInfo(agentId, { network })`, `getAgentsForHuman(address, { network })` (also static on `SelfAgent`).
- **Sessions**: tokens go in `Authorization: Bearer` and rotate on each poll; the SDK tracks the latest. Defaults: 30 min timeout, 5 s polling.
- **Errors**: failed calls throw `RegistrationError` (with HTTP `status`, e.g. 404); an expired session throws `ExpiredSessionError`.

## CLI

Supports `linked` and `wallet-free`; the agent key is generated locally and completion is read from the chain. Spec: [docs/CLI_REGISTRATION.md](../docs/CLI_REGISTRATION.md).

**The CLI defaults to `--network testnet`** (Celo Sepolia), while the SDK classes default to `mainnet`. Pass `--network mainnet` for production agents.

```bash
npx self-agent register init --mode linked --human-address 0x... --network testnet --out .self/session.json
npx self-agent register open   --session .self/session.json   # prints the QR URL
npx self-agent register wait   --session .self/session.json   # --timeout-seconds 1800
npx self-agent register export --session .self/session.json --unsafe --print-private-key   # or --out-key FILE
npx self-agent deregister init --mode linked --human-address 0x... --agent-address 0x... --out .self/dereg.json
```

`register status` / `deregister open|wait|status` work the same way. Init flags include `--minimum-age 0|18|21`, `--ofac`, `--ttl-minutes` (30), `--chain`/`--registry`/`--rpc` for custom chains. Session files are written with mode 0600.

`wait` exits `0` on success, `2` when `--timeout-seconds` elapses (the session is not marked expired; run `wait` again until its `expiresAt`), and `1` on other errors, including an expired session.

## Public API

| Area              | Exports                                                                                                                                                                                                             |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Agents            | `SelfAgent`, `Ed25519Agent`                                                                                                                                                                                         |
| Verification      | `SelfAgentVerifier`, `VerifierBuilder`, `verifyAgent`, `isProofExpiringSoon`, `EXPIRY_WARNING_THRESHOLD_SECS`, `computeSigningMessage`                                                                              |
| REST flows        | `requestRegistration`, `requestDeregistration`, `requestProofRefresh`, `getAgentInfo`, `getAgentsForHuman`, `RegistrationError`, `ExpiredSessionError`                                                              |
| `userDefinedData` | `getRegistrationConfigIndex`, `computeRegistrationChallengeHash`, `signRegistrationChallenge`, `build{Simple,Advanced}{Register,Deregister}UserData{Ascii,Binary}`, `buildWalletFreeRegisterUserData{Ascii,Binary}` |
| Agent cards       | `buildAgentCard`, `generateRegistrationJSON`, `getProviderLabel`, `getStrengthColor`, `PROVIDER_LABELS`, `A2A_PROTOCOL_VERSION`                                                                                     |
| A2A (v0.3)        | `A2AClient`, `A2AServer` (`{ maxStoredTasks }`, default 1000, oldest evicted), `A2AError`, `A2AErrorCodes`                                                                                                          |
| Constants         | `HEADERS`, `NETWORKS`, `DEFAULT_NETWORK`, `DEFAULT_REGISTRY_ADDRESS`, `DEFAULT_RPC_URL`, `REGISTRY_ABI`, `PROVIDER_ABI`, `typedRegistry`, `typedProvider`                                                           |

Types are exported alongside (`AgentInfo`, `VerificationResult`, `VerifiedAgent`, `RegistrationRequest`, `RegistrationSession`, `NetworkName`, …).

## Configuration

| Variable                                  | Default                          | Used by                                                    |
| ----------------------------------------- | -------------------------------- | ---------------------------------------------------------- |
| `SELF_AGENT_API_BASE`                     | `https://agent-api.self.xyz`     | REST flows (or pass `apiBase`)                             |
| `SELF_AGENT_APP_URL`                      | `https://agent-api.self.xyz`     | CLI: API that renders the `/cli/register` QR (`--app-url`) |
| `SELF_AGENT_APP_NAME`, `SELF_AGENT_SCOPE` | `Self Agent ID`, `self-agent-id` | CLI overrides (`--app-name`, `--scope`)                    |

Explicit option > env var > default. `registryAddress` / `rpcUrl` options override the network on agents and verifiers.

## Other languages

There is only this SDK. To verify without it: recompute `keccak256(timestamp + METHOD + pathWithQuery + keccak256(body))` (`keccak256("")` for no body), recover the EIP-191 signer of that 32-byte digest from `x-self-agent-signature`, reject timestamps older than 5 min, then require `isVerifiedAgent(zeroPad(signer, 32))` and `isProofFresh(getAgentId(...))` on the registry. To register, call the [REST API](../docs/api-docs.md).

## License

[BUSL-1.1](../LICENSE).
