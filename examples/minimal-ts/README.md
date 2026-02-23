# Minimal TypeScript Example

Agent signing + service verification with Self Agent ID.

## Setup

```bash
npm install
```

## Run the service

```bash
export AGENT_PRIVATE_KEY=0x...  # Your registered agent's private key
npm run service
```

## Run the agent (in another terminal)

```bash
export AGENT_PRIVATE_KEY=0x...
npm run agent
```

The agent signs requests with ECDSA. The service verifies signatures against the on-chain registry, checks age >= 18, OFAC screening, and sybil resistance.

## What's happening

1. `agent.ts` creates a `SelfAgent` from a private key and makes a signed HTTP request
2. `service.ts` runs Express with `SelfAgentVerifier` middleware that:
   - Recovers the signer from the signature
   - Checks `isVerifiedAgent()` on the registry contract
   - Verifies age, OFAC, and sybil policy
   - Attaches `req.agent` with address and credentials
