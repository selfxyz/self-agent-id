# Explainer

> Archived from the former /explainer web page.

**Proposed Extension to ERC-8004**

## Proof-of-Human for AI Agents

A composable, privacy-preserving standard that lets any smart contract or service verify an AI agent is operated by a real, unique human, without revealing who that human is.

[Integration Guide](integration.md) · [Read the Spec](#spec) · [GitHub](https://github.com/selfxyz/self-agent-id)

## The Problem

AI agents are becoming autonomous participants: booking travel, managing finances, negotiating on our behalf. Every service they touch faces the same question: **"Is this agent backed by a real person, or is it a bot?"**

Without a standard, every platform builds its own verification. Fragmented, expensive, and unreliable. Proof-of-human gives agents a portable credential that any service can check instantly, without knowing who the human is.

## How It Works

**Human** (Scans document) → **ZK Proof** (Generated locally) → **SelfAgentRegistry** (On-chain record) → **Services Verify** (Read contract state)

### Trustless

On-chain verification with no central authority. Any contract can read the registry directly.

### Private

ZK proofs reveal nothing about the human's identity. Only a nullifier is stored.

### Composable

A single registry call integrates into any EVM contract, backend service, or agent framework.

### Sybil-resistant

Each human maps to a unique nullifier, preventing one person from registering unlimited agents.

## Ready to Integrate?

Get code snippets for verifying agents in your service, authenticating your agent with services, and using the CLI for terminal workflows — in TypeScript, Python, and Rust.

## Security Model

The registry supports six registration modes. All produce the same on-chain result (a verified, sybil-resistant agent NFT) but they differ in who holds the agent's private key, what key type is used, and how the human manages their agent.

### Linked Agent

**Agent Key + Wallet Guardian**

A fresh EVM agent keypair is generated. Your connected wallet becomes the guardian, giving you direct revocation control. The human proves humanity via Self, and the agent key is linked to your wallet on-chain.

**How it's secured:**

- ECDSA signature in registration proves agent key ownership
- ZK proof binds human identity to nullifier
- Agent signs requests with its _own_ key — human wallet never exposed
- Guardian wallet can revoke the agent at any time

**Best for:** Developers who already have a wallet and want direct revocation control over their agents.

### Wallet-Free

**No Wallet Required**

No crypto wallet required. A fresh agent keypair is generated in the browser, and the agent's own address owns the NFT. Revoke anytime by scanning your passport again in the Self app.

**How it's secured:**

- Agent signs challenge with its own key during registration
- ZK proof binds human identity to nullifier
- Deregister anytime by scanning passport again

**Best for:** Quick start without any wallet setup or crypto knowledge.

### Smart Wallet

**Passkey + Kernel Smart Account**

A passkey (Face ID / fingerprint) creates a Kernel smart account as guardian. No MetaMask, no seed phrase. The agent still has its own ECDSA key for signing requests; the smart wallet handles on-chain management gaslessly via Pimlico.

**How it's secured:**

- Passkey (WebAuthn) backed by device biometrics, phishing-resistant
- Smart wallet = guardian, can revoke agent gaslessly
- Agent signs requests with its own ECDSA key

**Best for:** Users who want the simplest experience with no seed phrases, no browser extensions, and gasless management.

### Social Login (Privy)

**Email / Google / Twitter → Embedded Wallet**

Sign in with a social account via Privy. An embedded wallet is created automatically — no browser extension or seed phrase. A separate agent keypair is generated, and the Privy wallet becomes the guardian.

**How it's secured:**

- Privy authenticates the human via social login (MPC-secured embedded wallet)
- Agent generates its own keypair — signs challenge proving key ownership
- ZK proof binds human identity to nullifier
- Agent operates with its own key at runtime — no Privy dependency

**Best for:** Users who prefer social login (email, Google, Twitter) over browser extensions. No crypto wallet setup required.

### Ed25519

**Existing Agent Key**

For agents that already have Ed25519 keys (common in AI frameworks like Eliza, OpenClaw, and SSH-style agents). Paste your agent's existing public key — no new key generation needed. The agent signs a challenge to prove key ownership.

**How it's secured:**

- Ed25519 signature proves agent key ownership
- ZK proof binds human identity to nullifier
- Deregister anytime by scanning passport again

**Best for:** AI agents using Ed25519 keys natively (Eliza, OpenClaw, SSH agents, etc.).

### Ed25519 + Guardian

**Ed25519 Key + Wallet Guardian**

Same as Ed25519, but your connected wallet becomes the guardian. This gives you direct wallet-based revocation control over the agent, in addition to passport-based revocation.

**How it's secured:**

- Ed25519 signature proves agent key ownership
- ZK proof binds human identity to nullifier
- Guardian wallet can revoke the agent at any time
- Passport revocation also available as fallback

**Best for:** Ed25519 agents where a human wants direct wallet-based revocation control.

### ZK-Attested Credentials

Agents can optionally carry ZK-attested claims from their human backer, such as age verification (over 18 or 21), OFAC sanctions clearance, nationality, or name. During registration, the user chooses which fields to disclose. The Self app generates a zero-knowledge proof on the user's phone. Only the attested result is stored on-chain, never raw passport data.

Any service can query an agent's credentials on-chain or via the SDK. No additional identity check needed. Unselected fields are simply not included. All disclosures are fully optional and chosen by the user at registration time.

### Off-Chain: Request Signing

The on-chain registry proves _"this address is human-backed."_ But when an agent makes an API call, the service needs to prove _"this request actually came from that address."_ Without this, anyone could claim to be a registered agent.

The SDK solves this with ECDSA request signing. Regardless of registration mode, the flow is the same:

**Agent Side**

Signs each request with the agent's private key. The signature covers the timestamp, HTTP method, URL, and body hash, preventing replay and tampering.

**Service Side**

Recovers the signer address from the ECDSA signature (cryptographic, can't be faked), converts it to a bytes32 key, and checks `isVerifiedAgent()` on-chain.

The signer's identity is **recovered from the signature itself**, never trusted from a header. This closes the off-chain verification gap completely.

**Fully composable.** SDKs are available for `TypeScript`, `Python`, and `Rust`, with the signing protocol open for raw implementations in any language. Sign requests in Python, verify in Rust, or vice versa. The signing protocol is language-agnostic — all SDKs produce identical signatures.

### Sybil Resistance

Each human gets a unique, privacy-preserving nullifier derived from their passport. The registry tracks how many agents share each nullifier. Services can enforce their own limits:

**Strict (max 1)**

One agent per human. Best for governance voting, airdrops, and any context where uniqueness matters.

**Moderate (max N)**

Allow a few agents per human. Good for agent marketplaces where one person might run multiple bots.

**Detection only**

Allow unlimited but flag duplicates with `sameHuman()`. Good for analytics and reputation.

## A2A Agent Cards & Reputation Scoring

Every registered agent gets an A2A-compatible identity card with a trust score backed by on-chain verification.

### Verification Strength Scale

The score comes from the proof provider that verified the agent, not computed client-side. Self Protocol uses passport/biometric NFC verification (strength 100).

| Score | Provider                   |
| ----- | -------------------------- |
| 100   | Biometric Passport         |
| 100   | Biometric ID Card          |
| 80    | Aadhaar                    |
| 50    | Third-Party Identity Check |

### For Developers: Reputation-Based Access Control

Use the HTTP API to check an agent's verification strength before granting access.

```typescript
// Quick check: Only accept passport-verified agents
const baseUrl = "https://agent-api.self.xyz"; // replace with your deployment URL
const res = await fetch(`${baseUrl}/api/reputation/42220/${agentId}`);
const { score, proofType } = await res.json();

if (score < 100) {
  throw new Error("Agent must be verified with passport");
}
```

```typescript
// Tiered access based on verification strength
const accessLevel =
  score >= 100
    ? "full" // biometric passport/ID
    : score >= 80
      ? "standard" // Aadhaar
      : score >= 50
        ? "limited" // third-party identity check
        : "rejected";
```

```solidity
// On-chain: Use SelfReputationProvider directly
SelfReputationProvider rep = SelfReputationProvider(0x...);
uint8 score = rep.getReputationScore(agentId);
require(score >= 80, "Insufficient verification");
```

### ERC-8004: Three Registries

Self Protocol covers all three registry types defined by ERC-8004:

- **Identity** — SelfAgentRegistry: Agent NFT + human proof + ZK-attested credentials
- **Reputation** — SelfReputationProvider: Verification strength score from proof providers
- **Validation** — SelfValidationProvider: Real-time proof status + freshness check

## Interface Specification {#spec}

This extension adds proof-of-human capabilities to the ERC-8004 Agent Registry standard. The additions are shown below.

### ERC-8004 Base Standard

The base agent registry that every ERC-8004 implementation provides.

```solidity
/// @title IERC8004 - Agent Registry (Base Standard)
interface IERC8004 {
    function registerAgent(bytes32 agentPubKey) external returns (uint256);
    function getAgentId(bytes32 agentPubKey) external view returns (uint256);
    function ownerOf(uint256 agentId) external view returns (address);
}
```

### Proof-of-Human Extension

These functions are added on top of ERC-8004 to provide human-verification guarantees. Any protocol can query these to check if an agent is backed by a verified human.

```solidity
/// @title IERC8004ProofOfHuman - Extension Interface
/// @notice Adds proof-of-human verification to ERC-8004 agents.
interface IERC8004ProofOfHuman is IERC8004 {
    // ── Registration ──────────────────────────────
    function registerWithHumanProof(
        string calldata agentMetadata,
        address proofProvider,
        bytes calldata proof,
        bytes calldata providerData
    ) external returns (uint256 agentId);

    function revokeHumanProof(
        uint256 agentId,
        address proofProvider,
        bytes calldata proof,
        bytes calldata providerData
    ) external;

    // ── Verification (read by any service/contract) ─
    function isVerifiedAgent(bytes32 agentPubKey) external view returns (bool);
    function hasHumanProof(uint256 agentId) external view returns (bool);
    function getHumanNullifier(uint256 agentId) external view returns (uint256);
    function getProofProvider(uint256 agentId) external view returns (address);

    // ── Sybil detection ───────────────────────────
    function getAgentCountForHuman(uint256 nullifier) external view returns (uint256);
    function sameHuman(uint256 a, uint256 b) external view returns (bool);
}
```

### IHumanProofProvider

Pluggable interface for identity verification backends. Self Protocol is the reference provider; any ZK identity system can implement this.

```solidity
/// @title IHumanProofProvider
/// @notice Pluggable identity backend for proof-of-human.
interface IHumanProofProvider {
    /// @notice Verify a ZK proof and return (success, nullifier).
    function verifyHumanProof(
        bytes calldata proof,
        bytes calldata providerData
    ) external returns (bool verified, uint256 nullifier);

    /// @notice Human-readable provider name (e.g. "Self Protocol").
    function providerName() external view returns (string memory);

    /// @notice Verification strength score (0-100).
    function verificationStrength() external view returns (uint256);
}
```

View the reference implementation on [GitHub](https://github.com/selfxyz/self-agent-id) or the deployed contract on [Celoscan](https://celoscan.io/address/0xaC3DF9ABf80d0F5c020C06B04Cced27763355944) (`network.blockExplorer`/`network.registryAddress`, shown for the default `celo-mainnet` network).
