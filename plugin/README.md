# Self Agent ID — Claude Code Plugin

Six skills plus the hosted Self Agent ID MCP server, so Claude Code can register, sign, verify and look up proof-of-human agent identities.

```bash
claude --plugin-dir /path/to/self-agent-id/plugin
```

Or copy [`.mcp.json`](.mcp.json) to your project root to get only the MCP server.

## Skills

| Skill                    | Use it for                                                 |
| ------------------------ | ---------------------------------------------------------- |
| `self-agent-id-overview` | What Self Agent ID is, contract addresses, core concepts   |
| `register-agent`         | Registering an agent with a human proof                    |
| `sign-requests`          | Signing outbound HTTP requests as an agent                 |
| `verify-agents`          | Checking that an agent is registered and backed by a human |
| `query-credentials`      | Reading ZK-attested credentials (age, nationality, OFAC)   |
| `integrate-self-id`      | Adding Self Agent ID end to end to an app                  |

## MCP tools

`.mcp.json` points at `https://agent-api.self.xyz/api/mcp` (Streamable HTTP, 120 requests/min per IP).

| Tool                         | Access     | Does                                                                                                 |
| ---------------------------- | ---------- | ---------------------------------------------------------------------------------------------------- |
| `self_register_agent`        | Public     | Start a registration (`linked` with `human_address`, else `wallet-free`); returns QR + `scan_url`    |
| `self_check_registration`    | Public     | Poll by `session_token`; `reveal_private_key: true` exports the key once completed                   |
| `self_lookup_agent`          | Public     | Look up an agent by `agent_id` or `agent_address`                                                    |
| `self_list_agents_for_human` | Public     | List agents for a human wallet                                                                       |
| `self_verify_agent`          | Public     | Check an agent address against a policy (fresh proof, age, OFAC, provider, sybil)                    |
| `self_verify_request`        | Public     | Verify incoming ECDSA-signed `x-self-agent-*` headers against the same policy (Ed25519: use the SDK) |
| `self_get_identity`          | Privileged | On-chain identity of the server's agent                                                              |
| `self_deregister_agent`      | Privileged | Start deregistering the server's agent (human confirms in the Self app)                              |
| `self_sign_request`          | Privileged | Auth headers signed as the server's agent                                                            |
| `self_authenticated_fetch`   | Privileged | Signed HTTP request as the server's agent (public hosts only)                                        |

Resources: `self://networks` (public), `self://identity` (privileged). Prompt: `self_integrate_verification`.

**Privileged tools** sign as the _server's_ agent, so they only work on a deployment you run with `SELF_AGENT_PRIVATE_KEY` and `MCP_PRIVILEGED_API_KEY(S)` set ([app/README.md](../app/README.md#environment)). Point `.mcp.json` at it and send the key:

```json
{
  "self-agent-id": {
    "type": "http",
    "url": "https://your-deployment.example.com/api/mcp",
    "headers": { "Authorization": "Bearer ${SELF_MCP_API_KEY}" }
  }
}
```

To sign with your own agent key, use the SDK (`SelfAgent` / `Ed25519Agent`) instead. More: [project README](../README.md).
