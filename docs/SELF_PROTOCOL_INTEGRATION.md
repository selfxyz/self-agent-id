# Self Protocol Integration Guide

Status: active  
Last updated: 2026-02-22

## What this project gives you

Self Agent ID lets you:

1. Register an agent identity backed by a Self Protocol human proof.
2. Deregister and rotate agent identity using the same proof flow.
3. Sign outbound agent API requests with a dedicated agent key.
4. Verify inbound agent requests in your service with policy controls.

## Who should use which part

1. Agent builders:
   Use registration flow (`/register` or CLI), then sign requests with `SelfAgent`.
2. Service/API teams:
   Use `SelfAgentVerifier` middleware to enforce proof policy.
3. Infra/protocol teams:
   Read on-chain state from registry-compatible contracts and resolver APIs.

## Supported registration modes

1. `agent-identity`:
   Dedicated generated agent keypair. Recommended for autonomous agents.
2. `verified-wallet`:
   Wallet address is the verified identity. Best for human-operated on-chain gating.
3. `wallet-free`:
   No user wallet required. Agent keypair is generated locally.
4. `smart-wallet`:
   Passkey smart wallet guardian + generated agent keypair.

## SDKs

1. TypeScript package: `@selfxyz/agent-sdk`
2. Python package: `selfxyz-agent-sdk` (import path `self_agent_sdk`)
3. Rust crate: `self-agent-sdk`

## Service-side verification defaults

`SelfAgentVerifier` defaults are strict:

1. `requireSelfProvider: true`
2. `maxAgentsPerHuman: 1`
3. Replay and timestamp checks enabled

If you set `requireSelfProvider: false`, your service accepts verification providers outside the Self-operated provider set.

## Public APIs

1. `GET /api/cards/{chainId}/{agentId}`
2. `GET /api/reputation/{chainId}/{agentId}`
3. `GET /api/verify-status/{chainId}/{agentId}`
4. `GET /.well-known/a2a/{agentId}?chain={chainId}` (redirects to card resolver)

## JSON Schema & SDK helpers

1. Agent registration JSON format: `docs/AGENT_REGISTRATION_JSON.md`
   Describes the ERC-8004 registration JSON structure, Proof-of-Human extensions,
   and SDK helpers for auto-generating the file.

## CLI docs

For full CLI integration:

1. Registration spec: `docs/CLI_REGISTRATION_SPEC.md`
2. Human + agent-guided workflows: `docs/CLI_REGISTRATION_GUIDE.md`
