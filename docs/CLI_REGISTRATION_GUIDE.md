# CLI Registration Guide

Last updated: 2026-02-22

This guide covers:

1. Human-driven CLI registration flow (works today).
2. Human-driven CLI deregistration flow (works today).
3. Agent-guided orchestration flow (recommended integration pattern).

## Prerequisites

1. A running Self Agent ID web app host (default handoff target is `https://self-agent-id.vercel.app`).
2. One CLI implementation:
   1. TypeScript: `self-agent` / `self-agent-cli`
   2. Python: `self-agent` / `self-agent-python` / `python -m self_agent_sdk.cli`
   3. Rust: `self-agent-cli`
3. Access to a supported chain RPC and registry, or use `--network testnet|mainnet`.
4. Self mobile app for passport proof.
5. For `smart-wallet` mode: browser/device with passkey support.
6. For service verification demos, use an agent key that is already registered on the same network as your verifier.

## Human Registration Flow (today)

### Step 1: Create session

Example (`agent-identity`):

```bash
self-agent register init \
  --mode agent-identity \
  --human-address 0x... \
  --network testnet \
  --out .self/session.json
```

Example (`smart-wallet`):

```bash
self-agent register init \
  --mode smart-wallet \
  --network testnet \
  --out .self/session.json
```

### Step 2: Open browser handoff

```bash
self-agent register open --session .self/session.json
```

Copy the returned `url` into your browser.

### Step 3: Complete proof in browser

1. Scan QR in Self app and complete disclosure proof.
2. If mode is `smart-wallet`, create passkey wallet first in browser flow, then complete Self proof.

### Step 4: Wait for completion in terminal

```bash
self-agent register wait --session .self/session.json --timeout-seconds 1800
```

Expected output includes:

1. `stage: "onchain_verified"`
2. `agentAddress`
3. `agentId`
4. `callbackReceived`

### Step 5: Export key only when needed

Generated-key modes (`agent-identity`, `wallet-free`, `smart-wallet`) may export:

```bash
self-agent register export --session .self/session.json --unsafe --out-key .self/agent.key
```

`verified-wallet` mode has no generated agent private key to export.

## Human Deregistration Flow (today)

### Step 1: Create deregistration session

Example (`verified-wallet`):

```bash
self-agent deregister init \
  --mode verified-wallet \
  --human-address 0x... \
  --network testnet \
  --out .self/session-deregister.json
```

Example (`agent-identity`):

```bash
self-agent deregister init \
  --mode agent-identity \
  --human-address 0x... \
  --agent-address 0x... \
  --network testnet \
  --out .self/session-deregister.json
```

### Step 2: Open browser handoff

```bash
self-agent deregister open --session .self/session-deregister.json
```

### Step 3: Complete proof in browser

Scan QR in Self app and complete disclosure proof.

### Step 4: Wait for on-chain deregistration

```bash
self-agent deregister wait --session .self/session-deregister.json --timeout-seconds 1800
```

Expected output includes:

1. `stage: "onchain_deregistered"`
2. `agentAddress`
3. `agentId: null`
4. `callbackReceived`

## Mode Selection Guidance

1. `agent-identity`:
   default for autonomous agents and API signing.
2. `verified-wallet`:
   use when human wallet itself is the on-chain identity.
3. `wallet-free`:
   use when user should not need a wallet at registration time.
4. `smart-wallet`:
   use passkey guardian UX plus dedicated agent API key.

## Future Agent-Guided Registration Flow (recommended)

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

## Security Guidelines

1. Treat session files as sensitive local state.
2. Do not print private keys by default.
3. Require explicit operator intent for exports (`--unsafe`).
4. Restrict exported key file permissions.
5. Keep callback endpoint loopback-only (`127.0.0.1`).
6. Rotate or delete old session files after successful registration.

## Troubleshooting

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

## Real End-to-End Test Commands

The repo includes live CLI tests for TS/Python/Rust using a local Anvil harness:

```bash
SELF_AGENT_LIVE_TEST=1 SELF_AGENT_CALLBACK_TEST=1 npm --prefix sdk test
cd python-sdk && SELF_AGENT_LIVE_TEST=1 SELF_AGENT_CALLBACK_TEST=1 .venv/bin/python -m pytest -q --slow tests/test_cli.py
cd rust-sdk && cargo test -q --test cli -- --ignored
```

These tests use real CLI commands, real local JSON-RPC, real contract deployment, and real callback listeners.
