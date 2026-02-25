# EIP Draft: IERC8004ProofOfHuman Extension

> **Status:** Draft — for ethereum-magicians discussion
> **Category:** ERC
> **Requires:** ERC-8004, ERC-165, ERC-721

---

## Abstract

This EIP proposes an optional extension interface (`IERC8004ProofOfHuman`) for ERC-8004
Identity Registries that enables trustless binding of agent identities to verified unique
humans via privacy-preserving zero-knowledge proofs.

---

## Motivation

ERC-8004 defines a registry for trustless AI agents but does not specify how to prove that
an agent is controlled by a unique human. Without this, agents can be Sybil-attacked:
a single malicious actor registers thousands of agents to game reputation systems.

This extension:
1. Adds a sybil-resistance layer via nullifier-based unique-human verification
2. Adds proof expiry so stale verifications trigger reauthentication
3. Adds proof-of-human metadata that Reputation and Validation Registries can weight more highly
4. Preserves privacy — no biometric data is stored on-chain

---

## Specification

### Interface

See `IERC8004ProofOfHuman.sol` for the full Solidity interface.

### Key Concepts

**Nullifier**
A scoped, opaque identifier unique per `(human, service)` pair. Derived by the proof
provider from biometric data. Two agents with the same nullifier belong to the same human.
The nullifier is stored on-chain but the original biometric data is not.

**Proof Provider**
An approved contract that verifies proofs and calls back the registry. The registry
maintains an allowlist of approved providers. Self Protocol's Hub V2 is an example
provider for government-ID + NFC-chip verification.

**maxAgentsPerHuman**
A registry-level cap on how many agents one human can register (default: 1). Prevents
a single human from evading reputation decay by rotating agents.

**proofExpiresAt**
First-class expiry timestamp = `min(document expiry, block.timestamp + maxProofAge)`.
No oracle required — the expiry is set at registration time and checked on-chain by
`isProofFresh()`. SDKs should reject agents whose proof has expired.

**Agent Document Format**
The ERC-8004 registration document served at `agentURI` is designed to be optionally valid
as an A2A Agent Card. An ERC-8004 identity document containing `url`, `version`, `provider`,
`capabilities`, and `securitySchemes` fields is simultaneously a valid A2A Agent Card as
defined by the A2A protocol specification. This eliminates a separate A2A card registration
step. Fields are additive; ERC-8004 parsers and A2A parsers each read their respective
fields and ignore the rest.

**Verification Strength**
A 0-100 score indicating how strongly the proof binds a human identity:
- 100: Government ID + NFC chip + biometric match
- 60: Government ID without chip
- 40: Video liveness
- 0: No verification

### Sybil Resistance Properties

1. `register()` reverts with `ProofRequired()` when `requireHumanProof = true` (default)
2. A nullifier can only control `maxAgentsPerHuman` agents simultaneously
3. Revoking an agent returns the nullifier slot (human can re-register)
4. Expired proofs cause `isProofFresh()` to return false without requiring any transaction

### Events Required

- `Registered(agentId, agentURI, owner)` — ERC-8004 base requirement
- `AgentRegisteredWithHumanProof(agentId, proofProvider, nullifier, verificationStrength)`
- `HumanProofRevoked(agentId, nullifier)`
- `URIUpdated(agentId, newURI, updatedBy)`
- `MetadataSet(agentId, indexedMetadataKey, metadataKey, metadataValue)`

---

## Rationale

**Why nullifiers instead of wallet addresses?**
Wallet addresses can be created by anyone. A nullifier is derived from biometric data
by the proof provider and scoped to the service — it cannot be fabricated.

**Why store expiry on-chain instead of in the URI?**
Off-chain expiry requires oracle trust. On-chain expiry allows smart contracts (including
Reputation and Validation Registries) to enforce freshness without external calls.

**Why a separate `isProofFresh()` from `hasHumanProof()`?**
`hasHumanProof()` returns true for agents that have ever proven humanity, including those
with expired proofs. This lets callers distinguish "never verified" from "was verified but
needs renewal" — enabling different UX responses.

**Why EIP-712 for `setAgentWallet()`?**
The agent owner (NFT holder) may use a hardware wallet for custody, but the agent's
operational wallet should sign payments. EIP-712 proves the wallet address is controlled
by the signer without requiring the owner to delegate authority.

---

## Security Considerations

**Nullifier privacy:** Nullifiers are pseudo-anonymous. The same human's nullifiers
across different services are unlinkable (scoped). However, two agents from the same
human on the same service share a nullifier, revealing they are co-owned.

**Proof replay:** Proof providers MUST include the registry address and chain ID in the
proof scope to prevent cross-registry replay attacks.

**maxProofAge governance:** The registry owner can reduce `maxProofAge`, which will
cause previously valid proofs to immediately expire. Implementations SHOULD emit a
`MaxProofAgeUpdated` event and SDK integrators SHOULD watch for this event.

**appendResponse authorization:** Only the agent NFT owner or approved operator can
respond to feedback in the Reputation Registry. The soulbound nature of the NFT prevents
the owner from transferring out and leaving the agent orphaned.

---

## Reference Implementation

- **SelfAgentRegistry** (Celo Mainnet): `0x62E37d0f6c5f67784b8828B3dF68BCDbB2e55095`
- **SelfReputationRegistry** (Celo Mainnet): TBD
- **SelfValidationRegistry** (Celo Mainnet): TBD
- **Source:** https://github.com/selfxyz/self-agent-id

---

## Appendix: Guardian System

The guardian system allows a human to designate a trusted address that can revoke their
agent if the human loses access to their wallet. Guardians are set per-agent and can only
revoke (not transfer or modify metadata). This is an implementation detail of
`SelfAgentRegistry` and is not required by this EIP.

---

*This document is a starting point for ethereum-magicians discussion. The Self Protocol
team intends to deploy the reference implementation on Celo Mainnet and initiate a forum
thread on ethereum-magicians with deployed contract addresses before formal EIP submission.*
