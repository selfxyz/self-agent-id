# Standalone Python Ed25519 Agent

Reference implementation demonstrating the full Ed25519 agent lifecycle with `selfxyz-agent-sdk`.

## Quick Start

```bash
pip install -r requirements.txt
# Generate a new keypair and check registration
python agent.py
# With an existing seed
ED25519_SEED=<your-seed> python agent.py
```

## What This Demonstrates

1. **Keygen** — Generate an Ed25519 keypair from a 32-byte seed
2. **Register** — Check registration status, guide user through QR flow
3. **Authenticate** — Sign HTTP requests with Ed25519 via `agent.fetch()`
4. **Verify** — Service-side verification using `SelfAgentVerifier`

## Environment Variables

| Variable       | Description              | Default                                 |
| -------------- | ------------------------ | --------------------------------------- |
| `ED25519_SEED` | 64-char hex Ed25519 seed | Random (generated)                      |
| `SERVICE_URL`  | Target service URL       | `http://localhost:3000/api/demo/verify` |
