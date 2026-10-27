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

Get code snippets for verifying agents in your service, authenticating your agent with services, and using the CLI for terminal workflows — with the TypeScript SDK, or the REST API from any language.

## Security Model

The registry supports six registration modes. All produce the same on-chain result (a verified, sybil-resistant agent NFT) but they differ in who holds the agent's private key, what key type is used, and how the human manages their agent.

### Linked Agent

**Agent Key + Owner Wallet**

A fresh EVM agent keypair is generated and linked to your wallet, which owns the agent NFT. The human proves humanity via Self, and the agent key is linked to your wallet on-chain.

**How it's secured:**

- ECDSA signature in registration proves agent key ownership
- ZK proof binds human identity to nullifier
- Agent signs requests with its _own_ key — human wallet never exposed
- Your wallet owns the agent NFT; deregister anytime by scanning your passport again

**Best for:** Developers who already have a wallet and want direct revocation control over their agents.

### Wallet-Free

**No Wallet Required**

No crypto wallet required. A fresh agent keypair is generated for you, and the agent's own address owns the NFT. Revoke anytime by scanning your passport again in the Self app.

**How it's secured:**

- Agent signs challenge with its own key during registration
- ZK proof binds human identity to nullifier
- Deregister anytime by scanning passport again

**Best for:** Quick start without any wallet setup or crypto knowledge.

### Smart Wallet

**Passkey Smart Wallet as Owner**

Works exactly like a linked agent, with the human's passkey (Face ID / fingerprint) smart wallet as the linked wallet. The agent still has its own ECDSA key for signing requests.

**How it's secured:**

- The smart wallet is controlled by a passkey backed by device biometrics
- Smart wallet owns the agent NFT
- Agent signs requests with its own ECDSA key

**Best for:** Humans who already use a passkey smart wallet and want no seed phrases or browser extensions.

### Social Login (Privy)

**Email / Google / Twitter → Embedded Wallet**

Works like a linked agent, with the human's Privy embedded wallet (created by signing in with email or a social account) as the linked wallet — no browser extension or seed phrase. A separate agent keypair is generated, and the Privy wallet owns the agent NFT.

**How it's secured:**

- Privy authenticates the human via social login (MPC-secured embedded wallet)
- Agent generates its own keypair — signs challenge proving key ownership
- ZK proof binds human identity to nullifier
- Agent operates with its own key at runtime — no Privy dependency

**Best for:** Users who prefer social login (email, Google, Twitter) over browser extensions. No crypto wallet setup required.

### Ed25519

**Existing Agent Key**

For agents that already have Ed25519 keys (common in AI frameworks like Eliza, OpenClaw, and SSH-style agents). The agent registers its existing public key — no new key generation needed — and signs a challenge to prove key ownership. The private key never leaves the agent.

**How it's secured:**

- Ed25519 signature proves agent key ownership
- ZK proof binds human identity to nullifier
- No revocation path without a guardian — use Ed25519 + Guardian if you need one

**Best for:** AI agents using Ed25519 keys natively (Eliza, OpenClaw, SSH agents, etc.).

### Ed25519 + Guardian

**Ed25519 Key + Wallet Guardian**

Same as Ed25519, but your connected wallet becomes the guardian. This gives you direct wallet-based revocation control over the agent.

**How it's secured:**

- Ed25519 signature proves agent key ownership
- ZK proof binds human identity to nullifier
- Guardian wallet can revoke the agent at any time (`guardianRevoke`)

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

Recovers the signer address from the ECDSA signature (cryptographic, can't be faked), converts it to a bytes32 key, and checks on-chain that the agent has a human proof that hasn't expired (`isVerifiedAgent()` + `isProofFresh()`).

The signer's identity is **recovered from the signature itself**, never trusted from a header. This closes the off-chain verification gap completely.

**Fully composable.** The TypeScript SDK implements both sides, and the signing protocol is open for raw implementations in any language: `keccak256(timestamp + METHOD + pathAndQuery + keccak256(body))`, signed with EIP-191.

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
// On-chain: read the strength from the agent's proof provider
// (what SelfReputationSignal.getReputationScore returns; that wrapper is not deployed)
address provider = registry.getProofProvider(agentId);
require(provider != address(0), "No proof");
require(IHumanProofProvider(provider).verificationStrength() >= 80, "Insufficient verification");
```

### ERC-8004: Three Registries

Self Protocol covers all three registry types defined by ERC-8004:

- **Identity** — `SelfAgentRegistry`: Agent NFT + human proof + ZK-attested credentials
- **Reputation** — `SelfReputationRegistry`: ERC-8004 feedback; a `proof-of-human` entry is recorded at registration
- **Validation** — `SelfValidationRegistry`: ERC-8004 validation requests/responses; Self attests daily proof freshness

## Interface Specification {#spec}

This extension adds proof-of-human capabilities to the ERC-8004 Agent Registry standard. The additions are shown below.

### ERC-8004 Base Standard

The base agent registry that every ERC-8004 implementation provides.

```solidity
/// @title IERC8004 - Agent Registry (Base Standard)
interface IERC8004 is IERC165 {
    function register() external returns (uint256 agentId);
    function register(string calldata agentURI) external returns (uint256 agentId);
    function register(string calldata agentURI, string[] calldata metadataKeys, bytes[] calldata metadataValues)
        external returns (uint256 agentId);
    function setAgentURI(uint256 agentId, string calldata newURI) external;
    function getMetadata(uint256 agentId, string memory key) external view returns (bytes memory);
    function setMetadata(uint256 agentId, string calldata key, bytes calldata value) external;
    function setAgentWallet(uint256 agentId, address newWallet, uint256 deadline, bytes calldata signature) external;
    function getAgentWallet(uint256 agentId) external view returns (address);
    function unsetAgentWallet(uint256 agentId) external;
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
        string calldata agentURI,
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
    function hasHumanProof(uint256 agentId) external view returns (bool); // ignores expiry
    function proofExpiresAt(uint256 agentId) external view returns (uint256);
    function isProofFresh(uint256 agentId) external view returns (bool);
    function getHumanNullifier(uint256 agentId) external view returns (uint256);
    function getProofProvider(uint256 agentId) external view returns (address);

    // ── Sybil detection ───────────────────────────
    function getAgentCountForHuman(uint256 nullifier) external view returns (uint256);
    function getAgentsForNullifier(uint256 nullifier) external view returns (uint256[] memory);
    function getAgentsForNullifier(uint256 nullifier, uint256 offset, uint256 limit)
        external view returns (uint256[] memory);
    function sameHuman(uint256 agentIdA, uint256 agentIdB) external view returns (bool);
    function isApprovedProvider(address provider) external view returns (bool);
}
```

`SelfAgentRegistry` also exposes `isVerifiedAgent(bytes32 agentKey)` and `getAgentId(bytes32 agentKey)` for key-based lookups (not part of the interface).

### IHumanProofProvider

Pluggable interface for identity verification backends. Self Protocol is the reference provider; any ZK identity system can implement this.

```solidity
/// @title IHumanProofProvider
/// @notice Pluggable identity backend for proof-of-human.
interface IHumanProofProvider {
    /// @notice Verify a proof and return (success, nullifier).
    function verifyHumanProof(
        bytes calldata proof,
        bytes calldata data
    ) external returns (bool verified, uint256 nullifier);

    /// @notice Provider name (SelfHumanProofProvider returns "self").
    function providerName() external view returns (string memory);

    /// @notice Verification strength score (0-100).
    function verificationStrength() external view returns (uint8);
}
```

View the reference implementation on [GitHub](https://github.com/selfxyz/self-agent-id) or the deployed contract on [Celoscan](https://celoscan.io/address/0xaC3DF9ABf80d0F5c020C06B04Cced27763355944) (Celo mainnet).
