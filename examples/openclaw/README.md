# OpenClaw Integration

Self Agent ID skill for [OpenClaw](https://openclaw.ai) agents.

OpenClaw uses Ed25519 keypairs natively for device identity (Clawdentity), making it a natural fit for Self Agent ID's Ed25519 registration flow.

## Setup

1. Copy `self-identity/` into your OpenClaw skills directory
2. Install the SDK: `pip install selfxyz-agent-sdk`
3. Register your device's Ed25519 key at https://app.ai.self.xyz/register

## Usage

```python
# In your OpenClaw agent config
skills:
  - name: self-identity
    config:
      network: testnet  # or mainnet
      key_path: ~/.openclaw/identity/ed25519.key
```

The skill automatically:

- Loads your device's existing Ed25519 keypair
- Signs outbound requests for agent-to-agent auth
- Verifies inbound requests from other Self-registered agents
- Provides registration status and agent info

## Demo

Test your agent against the live demo endpoint:

```python
# In your OpenClaw skill handler
handle({"action": "demo", "network": "celo-sepolia"}, {"config": {...}})
```

This calls the agent-to-agent demo endpoint, which verifies your agent's identity on-chain and returns mutual verification results including a `sameHuman` check.

## Key Reuse

OpenClaw's Clawdentity Ed25519 key can be directly registered with Self Agent ID — no new key generation required. The same key provides both device identity (OpenClaw) and human-verified agent identity (Self).
