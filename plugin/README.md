# Self Agent ID — Claude Code Plugin

Proof-of-human identity for AI agents. This plugin provides 6 skills and an MCP server with 10 tools for registering, authenticating, verifying, and querying agent identities backed by ZK passport proofs on Celo.

## Installation

Add the plugin to Claude Code:

```bash
claude plugin add /path/to/self-agent-id/plugin
```

Or copy the `.mcp.json` file to your project root to enable the MCP server directly.

## Environment Variables

| Variable                 | Required | Default                   | Description                                                         |
| ------------------------ | -------- | ------------------------- | ------------------------------------------------------------------- |
| `SELF_AGENT_PRIVATE_KEY` | No       | —                         | Agent's hex private key. Enables identity and authentication tools. |
| `SELF_NETWORK`           | No       | `testnet`                 | Network to operate on: `mainnet` or `testnet`.                      |
| `SELF_AGENT_API_BASE`    | No       | `https://app.ai.self.xyz` | API base URL override for custom deployments.                       |

## Skills

| Skill                      | Description                                                                               |
| -------------------------- | ----------------------------------------------------------------------------------------- |
| **self-agent-id-overview** | Architecture overview, contract addresses, and core concepts of the Self Agent ID system. |
| **register-agent**         | Step-by-step guide to registering an AI agent with proof-of-human verification.           |
| **sign-requests**          | How agents sign API requests using ECDSA for authenticated communication.                 |
| **verify-agents**          | Verify that an agent is registered and backed by a real human identity.                   |
| **query-credentials**      | Query ZK-attested credentials (age, nationality, OFAC status) for registered agents.      |
| **integrate-self-id**      | End-to-end integration guide for adding Self Agent ID to your application.                |

## MCP Tools

The MCP server (`@selfxyz/mcp-server`) exposes the following tools:

| Tool                         | Description                                                          |
| ---------------------------- | -------------------------------------------------------------------- |
| `self_register_agent`        | Register a new agent with the on-chain registry.                     |
| `self_check_registration`    | Check whether an agent is currently registered.                      |
| `self_get_identity`          | Retrieve the full identity record for a registered agent.            |
| `self_deregister_agent`      | Remove an agent's registration from the registry.                    |
| `self_sign_request`          | Sign an outgoing API request with the agent's private key.           |
| `self_authenticated_fetch`   | Perform an HTTP request with automatic agent authentication headers. |
| `self_lookup_agent`          | Look up a single agent by address or ID.                             |
| `self_list_agents_for_human` | List all agents registered under a given human address.              |
| `self_verify_agent`          | Verify an agent's registration status and proof-of-human backing.    |
| `self_verify_request`        | Verify an incoming signed request from another agent.                |

## Documentation

For full documentation, architecture details, and contract addresses, see the [project README](../README.md).
