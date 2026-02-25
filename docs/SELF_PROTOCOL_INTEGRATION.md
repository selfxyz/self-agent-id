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

## Critical prerequisites for success-path verification

1. Agent key must already be registered on-chain for your selected network.
2. If not registered, protected requests should fail with `Agent not verified on-chain`.
3. Verify both sides are on the same network (`mainnet` vs `testnet`) before debugging signatures.

## Request body fidelity (raw body requirement)

Signature verification is byte-sensitive.  
Your verifier should use the exact request body bytes received by the HTTP server whenever framework tooling allows it.

Guidelines:

1. Prefer raw-body capture middleware (for example, JSON parser verify hooks).
2. Avoid mutating, normalizing, or reserializing parsed JSON before verification.
3. If you cannot use raw bytes, document and enforce a single canonical serialization strategy end-to-end.

## Deterministic verification drills

Use these to validate an integration quickly:

1. Tamper drill:
   - Sign body `A`.
   - Send body `B` with the same signed headers.
   - Expected: invalid signature rejection.
2. Expired drill:
   - Send a timestamp older than configured `maxAge`.
   - Expected: timestamp freshness rejection.
3. Replay drill:
   - Submit identical signed request twice.
   - Expected: first accepted, second rejected when replay protection is enabled.

## Pre-demo smoke checklist

1. Build and test changed components.
2. Confirm verifier service health endpoint.
3. Run one registered-agent success request.
4. Run at least two deterministic failure drills and confirm expected outcomes.

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
