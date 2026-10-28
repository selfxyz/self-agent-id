# Changelog

## 0.3.0

Brings the stdio server in line with the current Self Agent ID API and the hosted MCP server at `https://agent-api.self.xyz/api/mcp`.

### Breaking changes

- Default network is now `mainnet` (was `testnet`), matching the SDK and the hosted server. Set `SELF_AGENT_NETWORK=testnet` to keep using Celo Sepolia. `SELF_NETWORK` is still read as a fallback.
- Default API base is now `https://agent-api.self.xyz` (was `https://self-agent-id.vercel.app`).
- `self_register_agent` no longer takes `mode`: it registers wallet-free without `human_address` and linked with it. It returns `session_token`, `scan_url`, `deep_link` and a QR image instead of `session_id` and `qr_url`.
- `self_check_registration` takes `session_token` (the newest one, it rotates on every poll) instead of `session_id`, and returns the private key only when called with `reveal_private_key=true`.
- `self_verify_agent` and `self_verify_request` share one policy: Self provider required and at most 1 agent per human by default. `max_agents_per_human` (`0` = no limit) is new on both, and `self_verify_request` now takes the same policy parameters.
- Removed `self_refresh_proof`, `self_list_agents_by_nullifier` and `self_demo_verify`, which the hosted server does not offer.
- An invalid `SELF_AGENT_PRIVATE_KEY`, network or `SELF_AGENT_API_BASE` now stops the server at startup.
- The package `main` export is now the `createServer` module; importing it no longer starts a server.

### Fixes

- Registration polling uses `Authorization: Bearer` (the API rejects `?token=`), reports the API's real stages, and maps HTTP 410 to `expired`. Key export uses `POST /api/agent/register/export`.
- `scan_url` points at the API's QR image; the old `qr_url` linked to a route that does not exist.
- "Verified" now always means a human proof that has not expired (`hasHumanProof && isProofFresh`).
- `self_lookup_agent` and `self_list_agents_for_human` return the current API shapes (including `complete`), report missing agents (404), validate addresses strictly and URL-encode path segments.
- `self_verify_request` keys its replay cache on the recovered signer and signed message hash, so re-encoded signatures cannot replay a request.
- `self_get_identity` uses the RPC of the requested network.
- `self_deregister_agent` uses the REST deregister flow and returns `scan_url` and a `session_token`.
- `self_authenticated_fetch` blocks private and reserved targets (IPv4, IPv6 literals and DNS answers), follows redirects by hand and re-checks each hop, drops the body on method-changing redirects, and caps time and response size.
- Errors and logs no longer include keys, session tokens or raw error text.
- Resource and prompt text updated (current URLs and `SelfAgentVerifier.verify()`).
- Depends on the published `@selfxyz/agent-sdk` `^0.3.0`.

### Other

- Source moved to [`selfxyz/self-agent-id`](https://github.com/selfxyz/self-agent-id/tree/main/mcp) (`mcp/`), next to the hosted server.
