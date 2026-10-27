# @selfxyz/mcp-server

MCP server for [Self Agent ID](https://docs.self.xyz/docs/agent-id/guides/mcp-user/): proof-of-human identity for AI agents. Register an agent backed by a real human, look up and verify agents, and sign HTTP requests as your agent, from any MCP client (Claude Desktop, Claude Code, Cursor, and others).

This package runs locally over stdio and keeps your agent key on your machine. It calls the Self Agent ID REST API (`https://agent-api.self.xyz` by default) and reads the Celo registry directly.

Guide: https://docs.self.xyz/docs/agent-id/guides/mcp-user/

## Zero-install option: the hosted server

If you do not need to sign as your own agent, connect to the hosted server instead. It has the same tools, with no install:

```bash
claude mcp add --transport http self-agent-id https://agent-api.self.xyz/api/mcp
```

On the hosted server, the tools that act as an agent are reserved for the operator. Use this package to sign with your own key.

## Install

Claude Code:

```bash
claude mcp add self-agent-id -e SELF_AGENT_NETWORK=testnet -- npx -y @selfxyz/mcp-server
```

Claude Desktop, Cursor and other clients (`mcpServers` config):

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

Leave out `SELF_AGENT_PRIVATE_KEY` until you have registered an agent. Requires Node.js 18 or later.

## Configuration

| Variable                                | Default                      | Description                                                                                         |
| --------------------------------------- | ---------------------------- | --------------------------------------------------------------------------------------------------- |
| `SELF_AGENT_PRIVATE_KEY`                | unset                        | Your agent's private key. Enables the agent tools below.                                            |
| `SELF_AGENT_NETWORK`                    | `mainnet`                    | `mainnet` (Celo) or `testnet` (Celo Sepolia). The older `SELF_NETWORK` is still read as a fallback. |
| `SELF_RPC_URL`                          | network default              | RPC endpoint for the configured network.                                                            |
| `SELF_AGENT_API_BASE`                   | `https://agent-api.self.xyz` | Self Agent ID REST API to call.                                                                     |
| `MCP_AUTH_FETCH_ALLOWED_HOSTS`          | unset                        | Comma-separated hosts `self_authenticated_fetch` may reach (`*.example.com` matches subdomains).    |
| `MCP_AUTH_FETCH_ALLOW_PRIVATE_NETWORKS` | `false`                      | Set `true` to let `self_authenticated_fetch` reach private and local addresses.                     |
| `MCP_VERIFY_REQUEST_REPLAY_PROTECTION`  | `true`                       | Set `false` to turn off the replay cache of `self_verify_request`.                                  |

The default network is mainnet, the same as the SDK and the hosted server. Use `testnet` while you try things out.

## Tools

| Tool                         | Needs key | Description                                                                                                                                                                                           |
| ---------------------------- | --------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `self_register_agent`        | no        | Start a registration. Returns a QR image, `scan_url`, `deep_link` and a `session_token`. Wallet-free without `human_address`, linked to that wallet with it.                                          |
| `self_check_registration`    | no        | Poll a registration with the newest `session_token`. Reports the stage (`qr-ready`, `completed`, `expired`, `failed`). With `reveal_private_key=true` after `completed`, returns the new agent's key. |
| `self_lookup_agent`          | no        | Look up an agent by `agent_id` or `agent_address`: verification, proof provider and disclosed credentials.                                                                                            |
| `self_list_agents_for_human` | no        | List the agents a wallet owns. Includes `total_count` and `complete`.                                                                                                                                 |
| `self_verify_agent`          | no        | Check an agent address against a policy (fresh proof-of-human, provider, sybil limit, age, OFAC).                                                                                                     |
| `self_verify_request`        | no        | Verify the `x-self-agent-*` headers of an incoming request: signature, 5 minute freshness, replay and on-chain policy. ECDSA agents only.                                                             |
| `self_get_identity`          | yes       | Your agent's on-chain identity, verification status and credentials.                                                                                                                                  |
| `self_sign_request`          | yes       | Produce `x-self-agent-*` headers for an HTTP request, signed as your agent.                                                                                                                           |
| `self_authenticated_fetch`   | yes       | Send a signed HTTP request as your agent. Private networks are blocked; up to 3 redirects, each re-checked; 10 KB response cap.                                                                       |
| `self_deregister_agent`      | yes       | Start the irreversible revocation of your agent. Returns a QR image and `session_token` for the human to confirm.                                                                                     |

"Verified" always means the agent has a human proof that has not expired. Both verify tools default to Self as the proof provider and at most 1 agent per human; set `max_agents_per_human` to `0` for no limit.

### Register an agent

1. Call `self_register_agent` (pass `human_address` to link the agent to your wallet).
2. Scan the QR code with the Self app.
3. Call `self_check_registration` with the newest `session_token` until the stage is `completed`.
4. Call it once more with `reveal_private_key=true`, store the key as `SELF_AGENT_PRIVATE_KEY` and restart the server.

The exported key appears in the conversation, so treat that transcript as secret.

## Resources and prompt

| Name                          | Description                                                                                                             |
| ----------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `self://networks`             | Chain IDs, registry addresses and RPC URLs for both networks.                                                           |
| `self://identity`             | Your agent's identity (needs `SELF_AGENT_PRIVATE_KEY`).                                                                 |
| `self_integrate_verification` | Prompt that generates verification middleware for a web framework, using `SelfAgentVerifier` from `@selfxyz/agent-sdk`. |

## Security

- The agent key never leaves the process and is never sent to the API. Errors and logs never include keys, session tokens or raw error text.
- `self_authenticated_fetch` refuses private, loopback, link-local and reserved addresses (IPv4 and IPv6, including DNS answers), and re-checks every redirect hop. Set `MCP_AUTH_FETCH_ALLOWED_HOSTS` to restrict it further.
- The replay cache of `self_verify_request` is per process. A service that needs strict replay protection must keep its own.

## Development

Lives in [`selfxyz/self-agent-id`](https://github.com/selfxyz/self-agent-id) under `mcp/`, next to the hosted server (`app/app/api/mcp`). Both register the same tools; a test fails if their tool lists differ.

```bash
cd mcp
npm ci
npm run lint   # type-check, tests included
npm test
npm run build
```

## License

MIT
