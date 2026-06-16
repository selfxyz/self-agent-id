# CrewAI Integration

Self Agent ID tools for [CrewAI](https://github.com/joaomdmoura/crewai) agents.

## Setup

```bash
pip install selfxyz-agent-sdk crewai
```

## Usage

Register an Ed25519 agent before running the example. The registration flow
prints a browser handoff URL for the human operator to scan with the Self app,
then waits for on-chain confirmation.

```bash
python -m self_agent_sdk.cli register init --mode ed25519 --network testnet --out .self/session.json
python -m self_agent_sdk.cli register open --session .self/session.json
python -m self_agent_sdk.cli register wait --session .self/session.json
```

After registration, run the CrewAI agent with the same Ed25519 seed.

```bash
ED25519_SEED=<your-seed> python agent.py
```

## Tools

| Tool                    | Description                     |
| ----------------------- | ------------------------------- |
| `SelfAuthenticatedTool` | Make signed HTTP requests       |
| `SelfIdentityTool`      | Check agent registration status |

## How It Works

CrewAI agents use these tools to make authenticated API requests. Each request is signed with Ed25519, providing cryptographic proof that the agent is backed by a verified human.
