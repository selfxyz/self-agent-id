# Minimal Python Example

Agent signing + service verification with Self Agent ID.

## Setup

```bash
pip install -r requirements.txt
```

## Run the service

```bash
export AGENT_PRIVATE_KEY=0x...
python service.py
```

## Run the agent (in another terminal)

```bash
export AGENT_PRIVATE_KEY=0x...
python agent.py
```

The agent signs requests with ECDSA. The FastAPI service verifies signatures against the on-chain registry and enforces age, OFAC, and sybil policies.
