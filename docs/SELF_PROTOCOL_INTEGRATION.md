# Self Protocol Integration Guide

Status: active  
Last updated: 2026-10-26

## What this project gives you

Self Agent ID lets you:

1. Register an agent identity backed by a Self Protocol human proof.
2. Deregister, refresh the human proof, or rotate agent identity using the same proof flow.
3. Sign outbound agent API requests with a dedicated agent key.
4. Verify inbound agent requests in your service with policy controls.

## Who should use which part

1. Agent builders:
   Register via the REST API (`POST /api/agent/register`), the SDK's `requestRegistration`, or the CLI, then sign requests with `SelfAgent`.
2. Service/API teams:
   Use `SelfAgentVerifier` middleware to enforce proof policy.
3. Infra/protocol teams:
   Read on-chain state from registry-compatible contracts and resolver APIs.

## Supported registration modes

1. `linked`:
   Server-generated agent keypair linked to the human's wallet, which owns the agent NFT. Recommended for autonomous agents.
2. `wallet-free`:
   No user wallet required. Server-generated agent keypair that owns its own NFT.
3. `privy` / `smartwallet`:
   Same as `linked`, with `humanAddress` set to the human's Privy embedded wallet or passkey smart wallet.
4. `ed25519`:
   The agent registers its existing Ed25519 public key with a signed challenge; no wallet needed.
5. `ed25519-linked`:
   Like `ed25519`, with the human's wallet as guardian.

The CLI supports `linked` and `wallet-free`; the REST API and SDK support all six.

## SDK

The TypeScript SDK (`@selfxyz/agent-sdk`) is the official client. Other languages call the REST API directly and implement the request-signing scheme (`x-self-agent-*` headers).

## Service-side verification defaults

`SelfAgentVerifier` defaults are strict:

1. `requireSelfProvider: true`
2. `maxAgentsPerHuman: 1`
3. Replay and timestamp checks enabled

If you set `requireSelfProvider: false`, your service accepts verification providers outside the Self-operated provider set.

## Critical prerequisites for success-path verification

1. Agent key must already be registered on-chain for your selected network.
2. If not registered, protected requests should fail with `Agent not verified on-chain`; if the human proof has expired, with `Agent's human proof has expired` (refresh it via `POST /api/agent/refresh`).
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

## Pre-launch smoke checklist

1. Build and test changed components.
2. Confirm verifier service health endpoint.
3. Run one registered-agent success request.
4. Run at least two deterministic failure drills and confirm expected outcomes.

## Public APIs

1. `GET /api/agent/info/{chainId}/{agentId}`
2. `GET /api/agent/verify/{chainId}/{agentId}`
3. `GET /api/cards/{chainId}/{agentId}`
4. `GET /api/reputation/{chainId}/{agentId}`
5. `GET /api/verify-status/{chainId}/{agentId}`
6. `GET /.well-known/a2a/{agentId}?chain={chainId}` (redirects to card resolver)

Per-agent routes return 404 for agents that don't exist or were deregistered; "verified" always means `hasHumanProof && isProofFresh`. Full reference: `docs/api-docs.md`.

## JSON Schema & SDK helpers

1. Agent registration JSON format: `docs/AGENT_REGISTRATION_JSON.md`
   Describes the ERC-8004 registration JSON structure, Proof-of-Human extensions,
   and SDK helpers for auto-generating the file.

## CLI docs

For full CLI integration:

1. CLI registration (spec, flows, orchestration): `docs/CLI_REGISTRATION.md`
