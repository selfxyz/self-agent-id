# Self Agent ID — Claude Code Plugin

Six skills plus the hosted MCP server, so Claude Code can register, sign, verify and look up human-backed agents.

```bash
claude --plugin-dir /path/to/self-agent-id/plugin
```

MCP server only? Copy [`.mcp.json`](.mcp.json) to your project root.

## Skills

| Skill                    | Use it for                                 |
| ------------------------ | ------------------------------------------ |
| `self-agent-id-overview` | Concepts, contract addresses               |
| `register-agent`         | Registering an agent with a human proof    |
| `sign-requests`          | Signing outbound requests as an agent      |
| `verify-agents`          | Checking an agent is human-backed          |
| `query-credentials`      | Reading age, nationality, OFAC credentials |
| `integrate-self-id`      | Adding Self Agent ID to an app end to end  |

## MCP tools

Same 10 tools as [`@selfxyz/mcp-server`](https://github.com/selfxyz/self-agent-id/blob/main/mcp/README.md#tools). On the hosted server the 4 key tools are disabled: they sign as the server's agent. To sign as yours, run `@selfxyz/mcp-server` locally.
