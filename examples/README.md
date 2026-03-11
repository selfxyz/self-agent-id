# Self Agent ID — Framework Examples

Integration examples for using Self Agent ID with popular AI agent frameworks.

## Quick Start

```bash
# TypeScript (reference implementation)
cd standalone-ts && npm install && ED25519_SEED=<seed> npx tsx agent.ts

# Python (reference implementation)
cd standalone-py && pip install -r requirements.txt && ED25519_SEED=<seed> python agent.py

# E2E demo test (requires registered agent)
cd standalone-ts && ED25519_SEED=<seed> SKIP_REGISTRATION=1 npx tsx e2e-demo-test.ts
```

## Framework Compatibility

| Framework                               | Language   | Key Type | Integration              | Status           |
| --------------------------------------- | ---------- | -------- | ------------------------ | ---------------- |
| **Standalone**                          | TypeScript | Ed25519  | Reference implementation | Runtime tested   |
| **Standalone**                          | Python     | Ed25519  | Reference implementation | Runtime tested   |
| **[Minimal](minimal-ts/)**              | TypeScript | ECDSA    | Existing reference       | Runtime tested   |
| **[Minimal](minimal-python/)**          | Python     | ECDSA    | Existing reference       | Runtime tested   |
| **[OpenClaw](openclaw/)**               | Python     | Ed25519  | Skill handler            | Doc-quality code |
| **[Eliza](eliza/)**                     | TypeScript | Ed25519  | Plugin                   | Doc-quality code |
| **[LangChain](langchain/)**             | Python     | Ed25519  | Custom tools             | Doc-quality code |
| **[CrewAI](crewai/)**                   | Python     | Ed25519  | Custom tools             | Doc-quality code |
| **[AutoGen](autogen/)**                 | Python     | Ed25519  | Function tools           | Doc-quality code |
| **[LangChain Agent](langchain-agent/)** | Python     | ECDSA    | Full agent               | Production       |

## Architecture

```
┌─────────────────┐     ┌──────────────────┐     ┌────────────────────┐
│  Agent Framework │     │  Self Agent SDK   │     │  Self Agent        │
│  (CrewAI, etc.)  │────▶│  Ed25519Agent     │────▶│  Registry (ERC-8004)│
│                  │     │  SelfAgent        │     │  on Celo           │
└─────────────────┘     └──────────────────┘     └────────────────────┘
        │                        │                        │
        │ tool call              │ sign request            │ isVerifiedAgent()
        ▼                        ▼                        ▼
   ┌─────────┐           ┌──────────────┐        ┌──────────────┐
   │  LLM    │           │  HTTP Request │        │  Human Proof │
   │         │           │  + Ed25519    │        │  (ZK, NFC)   │
   └─────────┘           │  Signature    │        └──────────────┘
                         └──────────────┘
```

## Ed25519 vs ECDSA

| Feature             | Ed25519                    | ECDSA (secp256k1)              |
| ------------------- | -------------------------- | ------------------------------ |
| Key generation      | `crypto.randomBytes(32)`   | `ethers.Wallet.createRandom()` |
| Ecosystem           | Python, Rust, Solana, SSH  | Ethereum, EVM chains           |
| On-chain verify gas | ~456K                      | ~3K                            |
| SDK class           | `Ed25519Agent`             | `SelfAgent`                    |
| Key format          | 64 hex chars (no 0x)       | 0x-prefixed 66 hex chars       |
| Registration        | Ed25519 challenge-response | EIP-712 or wallet-free         |

Both key types produce identical HTTP headers and are verified transparently by `SelfAgentVerifier`.

## Registration Flow

1. Generate keypair (Ed25519 seed or Ethereum private key)
2. Call registration API (challenge → sign → submit)
3. Scan QR code with Self app (proves you're human via NFC passport)
4. Agent is registered on-chain with soulbound NFT
5. Agent can now make authenticated requests

## Common Patterns

### Agent-side (making requests)

```python
agent = Ed25519Agent(private_key=seed, network="testnet")
res = agent.fetch("https://api.example.com/data", method="POST", body='{"key": "value"}')
```

### Service-side (verifying requests)

```python
verifier = SelfAgentVerifier.create().network("testnet").require_age(18).build()
result = verifier.verify(signature=sig, timestamp=ts, method="POST", url=url, body=body)
```

## Directory Structure

```
examples/
├── README.md                    # This file
├── standalone-ts/               # TypeScript Ed25519 reference + E2E test
├── standalone-py/               # Python Ed25519 reference
├── minimal-ts/                  # TypeScript ECDSA reference (existing)
├── minimal-python/              # Python ECDSA reference (existing)
├── openclaw/                    # OpenClaw skill
├── eliza/                       # Eliza (ai16z) plugin
├── langchain/                   # LangChain custom tools
├── langchain-agent/             # LangChain full agent (existing)
├── crewai/                      # CrewAI agent
└── autogen/                     # Microsoft AutoGen agent
```
