---
name: self-agent-id-overview
description: >
  Conceptual overview of the Self Agent ID system — on-chain identity registry,
  ERC-8004 standard, ZK proof-of-human, provider system, trust model, and
  soulbound NFTs on Celo. Use when the user asks "what is self agent id",
  "explain self agent id", "how does agent identity work", "self protocol agents",
  "ERC-8004", or "proof of human for agents". Do NOT use for specific workflows
  like registration, signing, verification, or integration — use the dedicated
  skills for those.
license: MIT
metadata:
  author: Self Protocol
  version: 1.0.0
  mcp-server: self-agent-id
---

# Self Agent ID — Overview

## What Self Agent ID Is

Self Agent ID is an on-chain identity registry deployed on the Celo blockchain that binds AI agent identities to Self Protocol human proofs. Each registered agent receives a soulbound ERC-721 NFT backed by a zero-knowledge passport verification performed through the Self mobile app.

The core purpose: enable trustless, on-chain proof-of-human for autonomous AI agents. Any service, smart contract, or protocol can query the registry to verify that an agent is backed by a real, unique human — without revealing any personal information. This solves the fundamental trust problem in agentic AI: how does a service know it is interacting with a legitimate agent operated by a real person, not a bot farm or impersonator?

The registration flow works as follows: a human scans their passport with the Self mobile app, which reads the NFC chip and generates a zero-knowledge proof locally on the device. This proof is submitted to Self Protocol's Hub V2 contract on-chain, which verifies the proof and calls back into the SelfAgentRegistry. The registry then mints a soulbound ERC-721 NFT to represent the verified agent identity. Once registered, the agent can sign HTTP requests with ECDSA, and any receiving service can verify both the signature and the on-chain proof status in a single step.

The system consists of:

- **Smart contracts** — An ERC-721 registry with soulbound NFTs, proof providers, reputation scoring, and freshness validation. Deployed on Celo Mainnet and Celo Sepolia testnet.
- **SDKs** — Client libraries in TypeScript, Python, and Rust for agent registration, HTTP request signing, and server-side verification.
- **MCP Server** — A Model Context Protocol server (`@selfxyz/mcp-server`) exposing 10 tools for AI coding assistants like Claude Code and Cursor.
- **REST API** — Hosted endpoints for registration flows, agent discovery, verification, and agent cards.
- **dApp** — A web application at [self-agent-id.vercel.app](https://self-agent-id.vercel.app) for interactive registration and agent management.

## ERC-8004 Standard

ERC-8004 is a proposed standard for on-chain AI agent registries. Self Agent ID implements three ERC-8004 registry types:

### Identity Registry (Core)
The `SelfAgentRegistry` contract is the primary ERC-721 identity registry. It issues soulbound (non-transferable) NFTs to registered agents. Each NFT represents a verified agent identity with an associated human proof, proof provider, nullifier (for sybil resistance), and optionally ZK-attested credentials (nationality, age, OFAC status).

### Reputation Registry
The `SelfReputationProvider` contract implements the ERC-8004 reputation registry pattern. It provides a `getReputationScore(agentId)` function returning a score from 0 to 100, derived from the verification strength of the proof provider that verified the agent. Self Protocol scores 100 (passport NFC + biometric). A hypothetical video-liveness provider might score 40.

### Validation Registry
The `SelfValidationProvider` contract implements the ERC-8004 validation registry pattern. It performs freshness checks — determining whether an agent's proof is still considered "fresh" based on how many blocks have elapsed since registration. The default threshold is approximately 1 year on Celo (~6,307,200 blocks at 5 seconds per block).

## Provider System

The registry uses a pluggable `IHumanProofProvider` interface, allowing any identity verification system to serve as a proof-of-human provider. Each provider reports:

- **providerName()** — A human-readable identifier (e.g., `"self"`)
- **verificationStrength()** — A score from 0 to 100 reflecting the rigor of verification
- **verifyHumanProof()** — The verification entry point (synchronous or async depending on provider)

### Self Protocol Provider

Self Protocol's implementation (`SelfHumanProofProvider`) has these characteristics:

| Property | Value |
|---|---|
| Provider name | `"self"` |
| Verification strength | `100` (passport/NFC chip + biometric) |
| Verification pattern | Async callback (Hub V2 -> Registry) |
| Direct verification | Not supported (reverts with `DirectVerificationNotSupported`) |

The async pattern works as follows: the dApp calls `verifySelfProof()` on the registry, Hub V2 verifies the ZK proof, then Hub V2 calls back into the registry's `customVerificationHook()` which mints the NFT.

### Other Potential Providers

The provider system is designed to be extensible. Other identity protocols could implement `IHumanProofProvider` with different verification strengths:

| Provider | Strength | Method |
|---|---|---|
| Self Protocol | 100 | Passport NFC chip + biometric |
| Government ID (no chip) | 60 | Document scan + liveness |
| Video liveness | 40 | Live video verification |
| Worldcoin | TBD | Iris biometric (orb) |
| Humanity Protocol | TBD | Palm biometric |

## Trust Model

### Zero-Knowledge Proofs
Passport data never leaves the user's phone. The Self mobile app reads the passport NFC chip locally and generates a ZK proof. Only the proof (not the underlying data) is submitted on-chain. The registry stores only the nullifier and optionally disclosed credential claims (nationality, age threshold, OFAC status) — never raw passport data.

### Nullifier-Based Sybil Resistance
Each human produces a deterministic nullifier scoped to the registry. The same human scanning the same passport against the same registry scope always produces the same nullifier. This enables sybil detection: the registry can enforce a maximum number of agents per human (default: 1) and expose `sameHuman(agentIdA, agentIdB)` for cross-agent checks.

### Zero PII On-Chain
No personally identifiable information is stored on-chain. The only stored values are:
- The nullifier (a cryptographic hash, not reversible to identity)
- Disclosed credential claims (optional, chosen by the user at registration time)
- The proof provider address
- The registration block number (for freshness checks)

The user controls exactly which credential claims to disclose during registration by selecting a verification config. Config 0 discloses basic data only; configs 1-2 add age thresholds (18+/21+); configs 3-5 add OFAC screening. Even with full disclosure, only the verified claims are stored — never the raw passport data or biometric information.

### Soulbound NFTs
Agent identity NFTs are non-transferable. The ERC-721 `_update` function reverts on any transfer attempt (from != 0 AND to != 0). Only minting (from = 0) and burning (to = 0) are permitted. This ensures agent identities cannot be sold, traded, or transferred to another party. The identity is permanently bound to the human who created it, and can only be destroyed through deregistration or guardian revocation.

### Guardian System
For wallet-free and smart-wallet registration modes, agents can have a designated guardian address. The guardian serves as a safety mechanism — if an agent's private key is compromised, the guardian can force-revoke the agent's identity by calling `guardianRevoke()`. This is particularly important for autonomous agents that may operate unsupervised for extended periods.

## Quick Reference

### Registration Modes

| Mode | Code | Agent Key | NFT Owner | Use Case |
|---|---|---|---|---|
| Verified Wallet (`R`) | Simple | `bytes32(uint256(uint160(wallet)))` | Human wallet | Simplest path, agent = wallet |
| Agent Identity (`K`) | Advanced | `bytes32(uint256(uint160(agentAddr)))` | Human wallet | Recommended — separate agent keypair |
| Wallet-Free (`W`) | Wallet-free | Agent-derived | Agent address | Agent-owned NFT, optional guardian |
| Smart Wallet | Passkey | Agent-derived | Smart account | Gasless via paymaster, passkey auth |

### Verification Configs

6 configs registered with Hub V2 at deployment (age threshold x OFAC screening):

| Index | Age | OFAC | Description |
|---|---|---|---|
| 0 | None | Off | Data disclosures only |
| 1 | 18+ | Off | Age-gated (18+) |
| 2 | 21+ | Off | Age-gated (21+) |
| 3 | None | On | OFAC screening only |
| 4 | 18+ | On | Age-gated (18+) + OFAC |
| 5 | 21+ | On | Age-gated (21+) + OFAC |

### Authentication Headers

Services verify agent HTTP requests using three headers:

| Header | Content |
|---|---|
| `x-self-agent-address` | Agent's Ethereum address (hex) |
| `x-self-agent-signature` | ECDSA signature over `timestamp + METHOD + pathWithQuery + keccak256(body)` |
| `x-self-agent-timestamp` | Unix timestamp in milliseconds (string), must be within 5-minute window |

### SDKs

| Language | Package | Agent Class | Verifier Class |
|---|---|---|---|
| TypeScript | `@selfxyz/agent-sdk` | `SelfAgent` | `SelfAgentVerifier` |
| Python | `selfxyz-agent-sdk` | `SelfAgent` | `SelfAgentVerifier` |
| Rust | `self-agent-sdk` | `SelfAgent` | `SelfAgentVerifier` |

All SDKs expose identical APIs for registration, signing, verification, credentials, and agent cards. The `SelfAgent` class is used by the agent (AI system) to sign requests and manage identity. The `SelfAgentVerifier` class is used by the receiving service to verify incoming requests against on-chain state.

### MCP Server

Package: `@selfxyz/mcp-server` — 10 tools across 4 categories:

- **Identity** (4): register agent, check status, get info, deregister
- **Auth** (2): sign request, create auth headers
- **Discovery** (2): list agents for address, search verified agents
- **Verification** (2): verify agent on-chain, validate freshness

Plus 2 resources (`self://networks`, `self://identity`) and 1 prompt (`self_integrate_verification`).

### Networks

| Network | Chain ID | RPC |
|---|---|---|
| Celo Mainnet | 42220 | `https://forno.celo.org` |
| Celo Sepolia | 11142220 | `https://forno.celo-sepolia.celo-testnet.org` |

## Key Concepts

### Agent Key
Every agent identity is keyed by a `bytes32` value derived from an Ethereum address: `bytes32(uint256(uint160(agentAddress)))`. In simple mode, the agent address is the human's wallet. In advanced, wallet-free, and smart-wallet modes, the agent has its own keypair. The agent key serves as the primary lookup key in all registry mappings.

### Verification Config Selection
At registration time, the user (or SDK) selects one of 6 verification configs by placing a digit (`'0'` through `'5'`) at position [1] in the `userDefinedData` field. This digit is sent as a UTF-8 character (the Self SDK encodes all user data as UTF-8 strings, not raw bytes). The config determines which credential checks are performed during the ZK verification.

### Credential Storage
ZK-attested credentials are stored on-chain at registration time. These include: nationality (ISO 3166-1 alpha-3), age threshold verified (0/18/21), OFAC screening results (3 booleans for SDN/nonSDN/consolidated lists), issuing state, and optionally name, ID number, date of birth, gender, and expiry date. All credential fields are populated from the ZK proof disclosure output — they are cryptographically verified, not self-reported.

## Skill Routing

To perform specific workflows, use the appropriate skill:

| Task | Skill |
|---|---|
| Register an agent (any mode) | `register-agent` |
| Sign HTTP requests as an agent | `sign-requests` |
| Verify agent identity from a service | `verify-agents` |
| Query agent credentials or reputation | `query-credentials` |
| Integrate Self Agent ID into a project | `integrate-self-id` |

## Reference Documentation

For detailed technical documentation, see:

- **System architecture, data flows, SDK internals, API endpoints** — [`references/architecture.md`](references/architecture.md)
- **Contract addresses, function signatures, interfaces, Solidity integration patterns** — [`references/contracts.md`](references/contracts.md)
