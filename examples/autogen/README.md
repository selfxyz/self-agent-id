# Microsoft AutoGen Integration

Self Agent ID tools for [Microsoft AutoGen](https://github.com/microsoft/autogen) agents.

## Setup

```bash
pip install selfxyz-agent-sdk pyautogen
```

## Usage

```bash
ED25519_SEED=<your-seed> OPENAI_API_KEY=<key> python agent.py
```

## Tools

| Tool                    | Description                     |
| ----------------------- | ------------------------------- |
| `check_identity`        | Check agent registration status |
| `authenticated_request` | Make signed HTTP requests       |
| `verify_request`        | Verify another agent's request  |

## How It Works

AutoGen agents register function tools that use Self Agent ID for authenticated API access. The Ed25519 key provides cryptographic proof of human backing, enabling trust in multi-agent workflows.
