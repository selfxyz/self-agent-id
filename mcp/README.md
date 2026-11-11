# @selfxyz/mcp-server

Local MCP server for [Self Agent ID](https://docs.self.xyz/docs/agent-id/guides/mcp-user/): register, look up and verify human-backed agents, and sign requests as your agent. Runs over stdio; your key never leaves your machine.

**Don't need to sign as your own agent?** Use the hosted server, no install:

```bash
claude mcp add --transport http self-agent-id https://agent-api.self.xyz/api/mcp
```

## Install (Node 18+)

```bash
claude mcp add self-agent-id -e SELF_AGENT_NETWORK=testnet -- npx -y @selfxyz/mcp-server
```

Other clients (`mcpServers` config):

```json
{
  "mcpServers": {
    "self-agent-id": {
      "command": "npx",
      "args": ["-y", "@selfxyz/mcp-server"],
      "env": {
        "SELF_AGENT_NETWORK": "testnet",
        "SELF_AGENT_PRIVATE_KEY": "0x..."
      }
    }
  }
}
```

Leave out `SELF_AGENT_PRIVATE_KEY` until you've registered.

## Register an agent (~3 min)

1. Call `self_register_agent` (add `human_address` to link it to your wallet)
2. Scan the QR with the Self app
3. Call `self_check_registration` with the newest `session_token` until `completed`
4. Call it again with `reveal_private_key=true`, set `SELF_AGENT_PRIVATE_KEY`, restart

The key appears in the transcript: treat it as secret.

## Tools

| Tool                         | Key? | Does                                                   |
| ---------------------------- | :--: | ------------------------------------------------------ |
| `self_register_agent`        |  —   | Start a registration: QR, `deep_link`, `session_token` |
| `self_check_registration`    |  —   | Poll a registration; export the key once completed     |
| `self_lookup_agent`          |  —   | Agent by `agent_id` or `agent_address`                 |
| `self_list_agents_for_human` |  —   | Agents a wallet owns                                   |
| `self_verify_agent`          |  —   | Check an agent against a policy (age, OFAC, sybil)     |
| `self_verify_request`        |  —   | Verify incoming `x-self-agent-*` headers (ECDSA only)  |
| `self_get_identity`          | yes  | Your agent's identity and credentials                  |
| `self_sign_request`          | yes  | Signed headers for an HTTP request                     |
| `self_authenticated_fetch`   | yes  | Send a signed request (public hosts only, 10 KB cap)   |
| `self_deregister_agent`      | yes  | Start revoking your agent (human confirms)             |

Verify tools default to 1 agent per human: pass `max_agents_per_human: 0` for no limit. Resources: `self://networks`, `self://identity`. Prompt: `self_integrate_verification`.

## Config

| Variable                                | Default                      | Purpose                                            |
| --------------------------------------- | ---------------------------- | -------------------------------------------------- |
| `SELF_AGENT_PRIVATE_KEY`                | unset                        | Enables the "Key?" tools                           |
| `SELF_AGENT_NETWORK`                    | `mainnet`                    | `mainnet` or `testnet`                             |
| `SELF_RPC_URL`                          | network default              | RPC override                                       |
| `SELF_AGENT_API_BASE`                   | `https://agent-api.self.xyz` | API to call                                        |
| `MCP_AUTH_FETCH_ALLOWED_HOSTS`          | unset                        | Host allowlist for fetch (`*.example.com`)         |
| `MCP_AUTH_FETCH_ALLOW_PRIVATE_NETWORKS` | `false`                      | Allow private/local targets (dev only)             |
| `MCP_VERIFY_REQUEST_REPLAY_PROTECTION`  | `true`                       | Per-process replay cache for `self_verify_request` |

Dev: `npm ci && npm test && npm run build`. A test fails if the tool list drifts from the hosted server (`app/app/api/mcp`). License: MIT.
