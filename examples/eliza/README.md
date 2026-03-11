# Eliza (ai16z) Integration

Self Agent ID plugin for [Eliza](https://github.com/ai16z/eliza) agents.

Eliza agents on Solana already use Ed25519 keypairs. This plugin registers the same key with Self Agent ID for human-verified identity — no new key generation required.

## Setup

1. Install: `npm install @selfxyz/agent-sdk`
2. Add to your Eliza character config:

```json
{
  "plugins": ["./self-identity/plugin"],
  "settings": {
    "SELF_ED25519_SEED": "your-64-char-hex-seed",
    "SELF_NETWORK": "testnet"
  }
}
```

Or reuse your existing Solana key (the plugin falls back to `SOLANA_PRIVATE_KEY`).

3. Register: Visit https://app.ai.self.xyz/register with your Ed25519 seed

## Actions

| Action               | Description                                        |
| -------------------- | -------------------------------------------------- |
| `checkIdentity`      | Check registration status                          |
| `signRequest`        | Sign an HTTP request                               |
| `authenticatedFetch` | Make a signed HTTP request                         |
| `demoVerify`         | Test against the live agent-to-agent demo endpoint |
| `verifyAgent`        | Verify another agent's request                     |

## Demo

Test your agent against the live demo:

```typescript
const result = await plugin.actions.demoVerify.handler({
  network: "celo-sepolia",
});
// result.body.verified === true if your agent is registered and verified
// result.body.sameHuman tells you if you share the same human backer as the demo agent
```

## Key Reuse

Eliza's Solana Ed25519 key can be directly registered with Self Agent ID. The same key provides both blockchain identity (Solana) and human-verified agent identity (Self).
