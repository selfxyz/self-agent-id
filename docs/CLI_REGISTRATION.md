# CLI Registration

Status: implemented
Last updated: 2026-10-26

This document defines the CLI contract for agent registration and deregistration shipped with the TypeScript SDK (`@selfxyz/agent-sdk`, binaries `self-agent` and `self-agent-cli`), along with step-by-step usage guides and integration patterns.

## Registration Modes

The REST API (`POST /api/agent/register`) accepts six modes: `linked`, `wallet-free`, `ed25519`, `ed25519-linked`, `privy` and `smartwallet`. The CLI supports the two EVM modes whose key it can generate locally:

| Mode          | Keys                      | NFT owner                        | Use when                                     |
| ------------- | ------------------------- | -------------------------------- | -------------------------------------------- |
| `linked`      | CLI-generated EVM keypair | Human wallet (`--human-address`) | You want agent keys linked to a human wallet |
| `wallet-free` | CLI-generated EVM keypair | Agent address (self-owned)       | The human has no wallet                      |

For `ed25519` / `ed25519-linked` (agent keeps its own Ed25519 key) and `privy` / `smartwallet` (same as `linked`, with the human's Privy or passkey smart wallet as `humanAddress`), use `requestRegistration({ mode, ... })` from the SDK or the REST API. The CLI rejects those modes with a pointer to the SDK.

## 1. Overview

1. `linked` — default for autonomous agents and API signing.
2. `wallet-free` — use when the human should not need a wallet at registration time.

The CLI keeps the agent key on the local machine. `open` prints a URL on the API (`/cli/register?payload=…`) that renders the Self app QR code as a PNG; the human scans it, the Self app submits the proof to the registry on-chain, and `wait` polls the registry contract until the agent appears (or disappears, for deregistration). There is no browser page, passkey step or local callback server.

### Prerequisites

1. The TypeScript SDK: `npm install @selfxyz/agent-sdk`, then run `npx self-agent ...`.
2. A Self Agent ID API to render the QR (default `https://agent-api.self.xyz`; override with `--app-url` or `SELF_AGENT_APP_URL`).
3. Access to a supported chain RPC and registry, or use `--network testnet|mainnet`.
4. Self mobile app for passport proof.
5. To test service verification, use an agent key that is already registered on the same network as your verifier.

## 2. Canonical Challenge Domain

`linked` and `wallet-free` challenge signatures use:

1. Prefix: `"self-agent-id:register:"`
2. `humanIdentifier` (`address`; the agent's own address for `wallet-free`)
3. `chainId` (`uint256`)
4. `registryAddress` (`address`)
5. `nonce` (`uint256`; `0` for a freshly generated key)

The hash is signed with EIP-191 and split into (`r`, `s`, `v`) for the `userDefinedData` payload (`'K'` for `linked`, `'W'` for `wallet-free`).

## 3. CLI Command Surface

### `register init`

Generates the agent keypair and writes a local session file.

Required:

1. `--mode <linked|wallet-free>`

Mode-specific:

1. `--human-address` is required for `linked`

Network selection:

1. `--network <mainnet|testnet>` (default `testnet`), or
2. explicit chain config with `--chain --registry --rpc`

Optional:

1. `--out`
2. `--ttl-minutes` (default 30)
3. disclosure flags (`--minimum-age`, `--ofac`, `--nationality`, `--name`, `--date-of-birth`, `--gender`, `--issuing-state`)
4. app metadata (`--app-url`, `--app-name`, `--scope`)

### `register open`

Prints the QR code URL (`/cli/register?payload=…`) for the session.

Required:

1. `--session`

### `register wait`

Polls the registry (`isVerifiedAgent` / `getAgentId` for the agent key) until the agent is verified on-chain.

Required:

1. `--session`

Optional:

1. `--open` (prints the QR code URL at start)
2. `--timeout-seconds` (default 1800)
3. `--poll-ms` (default 4000)

### `register status`

Reads current session state.

Required:

1. `--session`

### `register export`

Exports generated agent private key material.

Required:

1. `--session`
2. `--unsafe`

Output selection (at least one):

1. `--out-key <path>`
2. `--print-private-key`

### `deregister init`

Creates a local session file for proof-based revocation.

Required:

1. `--mode <linked|wallet-free>`
2. `--agent-address`

Mode-specific:

1. `--human-address` is required for `linked`

Network selection and optional flags are the same as `register init`.

### `deregister open`

Prints the QR code URL for the session.

Required:

1. `--session`

### `deregister wait`

Polls the registry until the agent is no longer registered.

Required:

1. `--session`

Optional:

1. `--open` (prints the QR code URL at start)
2. `--timeout-seconds`
3. `--poll-ms`

### `deregister status`

Reads current session state.

Required:

1. `--session`

## 4. Step-by-Step Flows

### Human Registration Flow

#### Step 1: Create session

Example (`linked`):

```bash
npx self-agent register init \
  --mode linked \
  --human-address 0x... \
  --network testnet \
  --out .self/session.json
```

Example (`wallet-free`):

```bash
npx self-agent register init \
  --mode wallet-free \
  --network testnet \
  --out .self/session.json
```

#### Step 2: Show the QR code

```bash
npx self-agent register open --session .self/session.json
```

Open the returned `url` (a PNG QR code) or send it to the human.

#### Step 3: Complete proof in the Self app

Scan the QR code in the Self app and complete the disclosure proof. The Self app submits the proof on-chain.

#### Step 4: Wait for completion in terminal

```bash
npx self-agent register wait --session .self/session.json --timeout-seconds 1800
```

Expected output includes:

1. `stage: "onchain_verified"`
2. `agentAddress`
3. `agentId`

#### Step 5: Export key only when needed

```bash
npx self-agent register export --session .self/session.json --unsafe --out-key .self/agent.key
```

### Human Deregistration Flow

#### Step 1: Create deregistration session

Example (`linked`):

```bash
npx self-agent deregister init \
  --mode linked \
  --human-address 0x... \
  --agent-address 0x... \
  --network testnet \
  --out .self/session-deregister.json
```

Example (`wallet-free`):

```bash
npx self-agent deregister init \
  --mode wallet-free \
  --agent-address 0x... \
  --network testnet \
  --out .self/session-deregister.json
```

#### Step 2: Show the QR code

```bash
npx self-agent deregister open --session .self/session-deregister.json
```

#### Step 3: Complete proof in the Self app

Scan the QR code in the Self app and complete the disclosure proof (use the same disclosure flags as the original registration).

#### Step 4: Wait for on-chain deregistration

```bash
npx self-agent deregister wait --session .self/session-deregister.json --timeout-seconds 1800
```

Expected output includes:

1. `stage: "onchain_deregistered"`
2. `agentAddress`
3. `agentId: null`

## 5. Agent-Guided Orchestration

Agent products can orchestrate CLI calls instead of asking users to run commands manually.

### Recommended orchestration contract

1. Agent backend calls `{register|deregister} init` and stores `sessionPath` metadata.
2. Agent backend calls `{register|deregister} open` and sends the returned QR code URL to the user.
3. User scans the QR code with the Self app.
4. Agent backend runs `{register|deregister} wait` until `onchain_verified` or `onchain_deregistered`.
5. Agent backend stores resulting identity lifecycle metadata and (if applicable) encrypted private key.

Backends that would rather not shell out can use the REST API instead (`POST /api/agent/register`, then poll `GET /api/agent/register/status` with `Authorization: Bearer <sessionToken>`), which also supports every mode.

## 6. Proof Expiry & Refresh

Human proofs set `proofExpiresAt = min(passport_document_expiry, block.timestamp + maxProofAge)` at registration time (`maxProofAge` defaults to 365 days). After expiry, `isProofFresh(agentId)` returns `false` and verifiers reject the agent.

The CLI has no refresh command. Refresh in place (same agent ID and key) with the SDK or the REST API:

```bash
curl -s -X POST https://agent-api.self.xyz/api/agent/refresh \
  -H 'Content-Type: application/json' \
  -d '{"agentId":5,"network":"testnet"}'
# → session-start response with scanUrl / deepLink; the same human scans it,
#   then poll GET /api/agent/refresh/status with Authorization: Bearer <sessionToken>
```

or `requestProofRefresh({ agentId, network })` in the TypeScript SDK.

Refresh returns 422 for agent IDs whose 32-byte big-endian encoding contains a byte ≥ `0x80` (e.g. 128–255, 384–511), because the Self app passes `userDefinedData` as UTF-8. For those agents, deregister and register again with the CLI flows above; that mints a **new agentId** (the old one is burned), so update any stored agentId references.

### Detecting Expiry

```bash
curl -s https://agent-api.self.xyz/api/agent/verify/11142220/1
# Response includes isVerified, hasHumanProof, isProofFresh and proofExpiresAt (ISO-8601)
```

### Proactive Monitoring

The SDK includes a 30-day warning threshold (`getInfo().isExpiringSoon`). Monitor `proofExpiresAt` in automated agents and refresh before expiry to avoid service disruption.

## 7. Session Schema (v1)

Top-level:

1. `version`
2. `operation` (`register` or `deregister`)
3. `sessionId`
4. `createdAt` (ISO-8601)
5. `expiresAt` (ISO-8601)
6. `mode` (`linked` or `wallet-free`)
7. `disclosures`
8. `network`
9. `registration`
10. `state`
11. `secrets` (optional; registration sessions only)

`network`:

1. `chainId`
2. `rpcUrl`
3. `registryAddress`
4. `endpointType`
5. `appUrl`
6. `appName`
7. `scope`

`registration`:

1. `humanIdentifier`
2. `agentAddress`
3. `userDefinedData`
4. `challengeHash` (registration only)
5. `signature` (`{ r, s, v }`, registration only)

`state`:

1. `stage`:
   `initialized`, `handoff_opened`, `onchain_verified`, `onchain_deregistered`, `expired`
2. `updatedAt`
3. optional `lastError`, `agentId`

`secrets`:

1. `agentPrivateKey`

## 8. QR Handoff Payload

The CLI encodes `payload=<base64url(json)>` for `GET /cli/register`, which returns the Self app QR code as a PNG. The payload holds only public data — never the agent key.

Fields:

1. `version` (`1`)
2. `operation` (`register` or `deregister`)
3. `mode` (`linked` or `wallet-free`)
4. `chainId` (`42220` or `11142220`)
5. `registryAddress` (must be the registry for that chain)
6. `endpointType` (`celo` or `staging_celo`)
7. `appName` (must be `Self Agent ID`)
8. `scope` (must be `self-agent-id`)
9. `humanIdentifier`
10. `userDefinedData`
11. `disclosures` (optional; snake_case keys plus `minimumAge`)
12. `expiresAt` (Unix ms)

The server only renders requests for its own registry, app name and scope, and returns 410 once `expiresAt` has passed.

## 9. Security Requirements

1. Export of agent private key is blocked unless `--unsafe` is explicit.
2. Session and key files must use restricted file permissions (0600).
3. The agent key never leaves the machine; completion is read from the chain.
4. Session expiry is enforced before handoff/wait operations.
5. Treat session files as sensitive local state.
6. Rotate or delete old session files after successful registration.

## 10. Troubleshooting

1. Protected API call fails with `Agent not verified on-chain`:
   confirm the agent key is registered on that network and that verifier network matches.
2. `Agent's human proof has expired`:
   refresh the proof (section 6).
3. `Session expired`:
   run `register init` or `deregister init` again.
4. `wait` times out although the human scanned:
   check the Self app finished successfully and that `--network` matches the network the QR was generated for.
5. `--mode ... is not supported by the CLI`:
   use `requestRegistration` or `POST /api/agent/register` for `ed25519`, `ed25519-linked`, `privy` and `smartwallet`.
6. Custom environments:
   pass `--chain`, `--registry`, and `--rpc` explicitly.

## 11. End-to-End Test Commands

The TypeScript SDK includes live CLI tests that run against a local Anvil harness:

```bash
cd typescript-sdk && SELF_AGENT_LIVE_TEST=1 npm test
```

These tests use real CLI commands, real local JSON-RPC and a real contract deployment (see `scripts/local-registry-harness.sh`).
