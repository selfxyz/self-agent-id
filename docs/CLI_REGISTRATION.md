# CLI Registration

Status: implemented
Last updated: 2026-02-22

This document defines the shared CLI contract for agent registration and deregistration used by TypeScript, Python, and Rust implementations, along with step-by-step usage guides and integration patterns.

## Registration Modes

### Off-chain (no human wallet needed)

| Mode | Keys | Use when |
|---|---|---|
| `wallet-free` | Server-generated EVM | You have no keys and don't need any |
| `ed25519` | Your Ed25519 keypair | You're an OpenClaw/Eliza/IronClaw agent |

### On-chain (human wallet required)

| Mode | Keys | Use when |
|---|---|---|
| `self-custody` | Human's wallet = agent | You ARE the agent (human-operated) |
| `linked` | Separate EVM keypair | You want agent keys linked to a human wallet |
| `ed25519-linked` | Your Ed25519 keypair | You want Ed25519 keys linked to a human wallet |

## 1. Overview & Supported Modes

1. `self-custody` — use when human wallet itself is the on-chain identity.
2. `linked` — default for autonomous agents and API signing.
3. `wallet-free` — use when user should not need a wallet at registration time.
4. `smartwallet` — passkey guardian UX plus dedicated agent API key.

### Prerequisites

1. A running Self Agent ID web app host (default handoff target is `https://self-agent-id.vercel.app`).
2. One CLI implementation:
   1. TypeScript: `self-agent` / `self-agent-cli`
   2. Python: `self-agent` / `self-agent-python` / `python -m self_agent_sdk.cli`
   3. Rust: `self-agent-cli`
3. Access to a supported chain RPC and registry, or use `--network testnet|mainnet`.
4. Self mobile app for passport proof.
5. For `smartwallet` mode: browser/device with passkey support.
6. For service verification demos, use an agent key that is already registered on the same network as your verifier.

## 2. Canonical Challenge Domain

All advanced/wallet-free/smartwallet challenge signatures use:

1. Prefix: `"self-agent-id:register:"`
2. `humanIdentifier` (`address`)
3. `chainId` (`uint256`)
4. `registryAddress` (`address`)

Hashing and signature split (`r`,`s`,`v`) must match across all SDKs.

## 3. CLI Command Surface

### `register init`

Creates a local session file and mode-specific payload material.

Required:

1. `--mode <self-custody|linked|wallet-free|smartwallet>`

Mode-specific:

1. `--human-address` is required for `self-custody` and `linked`

Network selection:

1. `--network <mainnet|testnet>` (default `testnet`), or
2. explicit chain config with `--chain --registry --rpc`

Optional:

1. `--out`
2. `--callback-port`
3. `--ttl-minutes`
4. disclosure flags (`--minimum-age`, `--ofac`, `--nationality`, `--name`, `--date-of-birth`, `--gender`, `--issuing-state`)
5. app metadata (`--app-url`, `--app-name`, `--scope`)

### `register open`

Outputs the browser handoff URL for the session.

Required:

1. `--session`

Optional:

1. `--launch` (currently prints guidance; does not auto-open browser)

### `register wait`

Waits for callback and/or on-chain verification.

Required:

1. `--session`

Optional:

1. `--open` (prints handoff URL at start)
2. `--timeout-seconds`
3. `--poll-ms`
4. `--no-listener` (poll chain only)

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

1. `--mode <self-custody|linked|wallet-free|smartwallet>`

Mode-specific:

1. `--human-address` is required for `self-custody` and `linked`
2. `--agent-address` is required for:
   `linked`, `wallet-free`, `smartwallet`

Network selection:

1. `--network <mainnet|testnet>` (default `testnet`), or
2. explicit chain config with `--chain --registry --rpc`

Optional:

1. `--out`
2. `--callback-port`
3. `--ttl-minutes`
4. disclosure flags (`--minimum-age`, `--ofac`, `--nationality`, `--name`, `--date-of-birth`, `--gender`, `--issuing-state`)
5. app metadata (`--app-url`, `--app-name`, `--scope`)

### `deregister open`

Outputs the browser handoff URL for the session.

Required:

1. `--session`

Optional:

1. `--launch` (currently prints guidance; does not auto-open browser)

### `deregister wait`

Waits for callback and/or on-chain deregistration.

Required:

1. `--session`

Optional:

1. `--open` (prints handoff URL at start)
2. `--timeout-seconds`
3. `--poll-ms`
4. `--no-listener` (poll chain only)

### `deregister status`

Reads current session state.

Required:

1. `--session`

## 4. Step-by-Step Flows

### Human Registration Flow

#### Step 1: Create session

Example (`linked`):

```bash
self-agent register init \
  --mode linked \
  --human-address 0x... \
  --network testnet \
  --out .self/session.json
```

Example (`smartwallet`):

```bash
self-agent register init \
  --mode smartwallet \
  --network testnet \
  --out .self/session.json
```

#### Step 2: Open browser handoff

```bash
self-agent register open --session .self/session.json
```

Copy the returned `url` into your browser.

#### Step 3: Complete proof in browser

1. Scan QR in Self app and complete disclosure proof.
2. If mode is `smartwallet`, create passkey wallet first in browser flow, then complete Self proof.

#### Step 4: Wait for completion in terminal

```bash
self-agent register wait --session .self/session.json --timeout-seconds 1800
```

Expected output includes:

1. `stage: "onchain_verified"`
2. `agentAddress`
3. `agentId`
4. `callbackReceived`

#### Step 5: Export key only when needed

Generated-key modes (`linked`, `wallet-free`, `smartwallet`) may export:

```bash
self-agent register export --session .self/session.json --unsafe --out-key .self/agent.key
```

`self-custody` mode has no generated agent private key to export.

### Human Deregistration Flow

#### Step 1: Create deregistration session

Example (`self-custody`):

```bash
self-agent deregister init \
  --mode self-custody \
  --human-address 0x... \
  --network testnet \
  --out .self/session-deregister.json
```

Example (`linked`):

```bash
self-agent deregister init \
  --mode linked \
  --human-address 0x... \
  --agent-address 0x... \
  --network testnet \
  --out .self/session-deregister.json
```

#### Step 2: Open browser handoff

```bash
self-agent deregister open --session .self/session-deregister.json
```

#### Step 3: Complete proof in browser

Scan QR in Self app and complete disclosure proof.

#### Step 4: Wait for on-chain deregistration

```bash
self-agent deregister wait --session .self/session-deregister.json --timeout-seconds 1800
```

Expected output includes:

1. `stage: "onchain_deregistered"`
2. `agentAddress`
3. `agentId: null`
4. `callbackReceived`

## 5. Agent-Guided Orchestration

Agent products can orchestrate CLI calls instead of asking users to run commands manually.

### Recommended orchestration contract

1. Agent backend calls `{register|deregister} init` and stores `sessionPath` metadata.
2. Agent backend calls `{register|deregister} open` and sends the returned handoff URL to user.
3. User completes browser flow (Self proof and optional passkey setup).
4. Agent backend runs `{register|deregister} wait` until `onchain_verified` or `onchain_deregistered`.
5. Agent backend stores resulting identity lifecycle metadata and (if applicable) encrypted private key.

### Why this is the right starting point

1. Keeps passkey/WebAuthn in browser where platform support is strongest.
2. Keeps deterministic CLI behavior for automation and fleet workflows.
3. Allows future migration to richer in-product embedded browser handoff without changing core registration protocol.

## 6. Proof Expiry & Refreshing Registration

Human proofs set `proofExpiresAt = min(passport_document_expiry, block.timestamp + maxProofAge)` at registration time (`maxProofAge` defaults to 365 days). After expiry, `isProofFresh(agentId)` returns `false`.

To refresh an expired proof, the CLI user must run the full deregister flow followed by a new register flow. This produces a new agentId. There is no in-place refresh or renewal command.

CLIs should surface `proofExpiresAt` in `register status` output and warn when expiry is within 30 days.

### Detecting Expiry

Use the SDK or on-chain query to check whether a proof is still fresh:

```bash
# Check via REST API
curl https://self-agent-id.vercel.app/api/agent/verify/{chainId}/{agentId}
# Response includes proofExpiresAt and isProofFresh fields
```

### Refresh Flow via CLI

To refresh an expired proof, deregister then re-register:

```bash
# Step 1: Deregister the expired agent
self-agent deregister init \
  --mode linked \
  --human-address 0x... \
  --agent-address 0x... \
  --network mainnet \
  --out .self/session-deregister.json

self-agent deregister open --session .self/session-deregister.json
# Complete Self app proof flow
self-agent deregister wait --session .self/session-deregister.json

# Step 2: Re-register with the same mode
self-agent register init \
  --mode linked \
  --human-address 0x... \
  --network mainnet \
  --out .self/session-refresh.json

self-agent register open --session .self/session-refresh.json
# Complete Self app proof flow
self-agent register wait --session .self/session-refresh.json
```

The new registration produces a **new agentId** (the old one is burned). Update any stored agentId references after refresh.

### Proactive Monitoring

SDKs include a 30-day warning threshold. Monitor `proofExpiresAt` in automated agents and trigger re-registration before expiry to avoid service disruption.

## 7. Session Schema (v1)

Top-level:

1. `version`
2. `operation` (`register` or `deregister`)
3. `sessionId`
4. `createdAt`
5. `expiresAt`
6. `mode`
7. `disclosures`
8. `network`
9. `registration`
10. `callback`
11. `state`
12. `secrets` (optional; registration-generated-key modes only)

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
3. `userDefinedData` (except smartwallet template pre-step)
4. `challengeHash` (non-self-custody modes)
5. `signature` (non-self-custody modes)
6. `smartWalletTemplate` (smartwallet mode only before browser passkey step)

`callback`:

1. `listenHost` (`127.0.0.1`)
2. `listenPort`
3. `path` (`/callback`)
4. `stateToken`
5. `used`
6. optional `lastStatus`, `lastError`

`state`:

1. `stage`:
   `initialized`, `handoff_opened`, `callback_received`, `onchain_verified`, `onchain_deregistered`, `failed`, `expired`
2. `updatedAt`
3. optional `lastError`, `agentId`, `guardianAddress`

`secrets`:

1. `agentPrivateKey` (generated modes only)

## 8. Browser Handoff Payload

CLI encodes payload in `payload=<base64url(json)>` for `/cli/register`.

Required fields:

1. `version`
2. `operation` (`register` or `deregister`)
3. `sessionId`
4. `stateToken`
5. `callbackUrl`
6. `mode`
7. `chainId`
8. `registryAddress`
9. `endpointType`
10. `appName`
11. `scope`
12. `humanIdentifier`
13. `expectedAgentAddress`
14. `expiresAt`

Optional:

1. `disclosures`
2. `userDefinedData`
3. `smartWalletTemplate`

## 9. Callback Payload Contract

Browser posts JSON to local callback URL:

1. `sessionId`
2. `stateToken`
3. `status` (`success` or `error`)
4. `timestamp`
5. optional `operation`
6. optional `error`
7. optional `guardianAddress`

CLI must reject mismatched `sessionId` / `stateToken` and replay callbacks.

## 10. Security Requirements

1. Export of agent private key is blocked unless `--unsafe` is explicit.
2. Session and key files must use restricted file permissions.
3. Callback listener binds to loopback host only.
4. Session expiry is enforced before handoff/wait operations.
5. Treat session files as sensitive local state.
6. Rotate or delete old session files after successful registration.

## 11. Troubleshooting

1. Protected API call fails with `Agent not verified on-chain`:
   confirm the agent key is registered on that network and that verifier network matches.
2. `Session expired`:
   run `register init` or `deregister init` again.
3. Callback never arrives:
   keep `register wait` / `deregister wait` running and ensure browser flow reaches success screen.
4. Need polling-only mode:
   run `register wait --no-listener` or `deregister wait --no-listener`.
5. Custom environments:
   pass `--chain`, `--registry`, and `--rpc` explicitly.

## 12. End-to-End Test Commands

The repo includes live CLI tests for TS/Python/Rust using a local Anvil harness:

```bash
SELF_AGENT_LIVE_TEST=1 SELF_AGENT_CALLBACK_TEST=1 npm --prefix sdk test
cd python-sdk && SELF_AGENT_LIVE_TEST=1 SELF_AGENT_CALLBACK_TEST=1 .venv/bin/python -m pytest -q --slow tests/test_cli.py
cd rust-sdk && cargo test -q --test cli -- --ignored
```

These tests use real CLI commands, real local JSON-RPC, real contract deployment, and real callback listeners.
