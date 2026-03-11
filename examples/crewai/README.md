# CrewAI Integration

Self Agent ID tools for [CrewAI](https://github.com/joaomdmoura/crewai) agents.

## Setup

```bash
pip install selfxyz-agent-sdk crewai
```

## Usage

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
