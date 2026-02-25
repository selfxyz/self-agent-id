# self-agent-sdk

Rust SDK for [Self Agent ID](https://self-agent-id.vercel.app) — on-chain AI agent identity with proof-of-human verification.

Sign requests in Rust, verify in TypeScript or Python, or vice versa. The signing protocol is language-agnostic — all SDKs produce identical signatures.

## Install

```bash
cargo add self-agent-sdk
```

With Axum middleware support:

```bash
cargo add self-agent-sdk --features axum
```

## Agent Side — Sign Requests

```rust
use self_agent_sdk::{SelfAgent, SelfAgentConfig, NetworkName};

let agent = SelfAgent::new(SelfAgentConfig {
    private_key: "0x...".to_string(),
    network: Some(NetworkName::Mainnet),
    registry_address: None,
    rpc_url: None,
})?;

// Sign a request (returns HashMap of auth headers)
let headers = agent.sign_request("POST", "https://api.example.com/data", Some(body)).await?;

// Or use the built-in HTTP client (auto-signs)
let response = agent.fetch("https://api.example.com/data", Some(Method::POST), Some(body)).await?;

// Check on-chain status
let registered = agent.is_registered().await?;
let info = agent.get_info().await?;
// AgentInfo { agent_id, is_verified, nullifier, agent_count, ... }
```

### Agent Properties

```rust
agent.address();    // Address
agent.agent_key();  // B256 — zero-padded bytes32 for on-chain lookups
```

### Credentials

```rust
// Fetch ZK-attested credentials (nationality, age, OFAC, etc.)
let creds = agent.get_credentials().await?;
// Some(AgentCredentials { issuing_state, nationality, older_than, ofac, ... })

let strength = agent.get_verification_strength().await?;
// 0 = unverified, 1 = basic, 2 = standard, 3 = enhanced
```

## Service Side — Verify Requests

```rust
use self_agent_sdk::{SelfAgentVerifier, VerifierConfig};

let mut verifier = SelfAgentVerifier::new(VerifierConfig::default());

let result = verifier.verify(
    signature, timestamp, "POST", "/api/data", Some(body)
).await;

if result.valid {
    println!("Verified agent: {:?}", result.agent_address);
    println!("Agent ID: {}", result.agent_id);
}
```

### VerifierBuilder

Chainable API for configuring verification requirements:

```rust
use self_agent_sdk::{SelfAgentVerifier, VerifierBuilder, NetworkName};

let verifier = SelfAgentVerifier::create()
    .network(NetworkName::Mainnet)
    .require_age(18)
    .require_ofac()
    .require_nationality(&["US", "GB", "DE"])
    .require_self_provider()
    .sybil_limit(1)
    .rate_limit(60, 1000)      // per_minute, per_hour
    .replay_protection()
    .include_credentials()
    .max_age(300_000)          // 5 min timestamp window
    .cache_ttl(60_000)         // 1 min cache
    .build();
```

### Axum Middleware (feature-gated)

```rust
use self_agent_sdk::{self_agent_auth, VerifiedAgent, SelfAgentVerifier};
use axum::{Router, routing::post, Json};

let verifier = SelfAgentVerifier::create()
    .require_age(18)
    .build();

let app = Router::new()
    .route("/api/data", post(handler))
    .layer(self_agent_auth(verifier));

async fn handler(agent: VerifiedAgent) -> Json<serde_json::Value> {
    Json(serde_json::json!({ "agentId": agent.result.agent_id.to_string() }))
}
```

### Static Factory

```rust
use self_agent_sdk::{SelfAgentVerifier, VerifierFromConfig};

let verifier = SelfAgentVerifier::from_config(VerifierFromConfig {
    network: Some(NetworkName::Mainnet),
    require_age: Some(18),
    require_ofac: Some(true),
    sybil_limit: Some(1),
    ..Default::default()
});
```

## A2A Agent Card

Publish machine-readable identity metadata for agent-to-agent discovery:

```rust
// Read the on-chain agent card
let card = agent.get_agent_card().await?;
// Some(A2AAgentCard { name, self_protocol: { agent_id, verification_strength, ... } })

// Set or update the agent card (writes on-chain)
let tx_hash = agent.set_agent_card(
    "My Agent".to_string(),
    Some("An AI assistant with verified identity".to_string()),
    Some("https://myagent.example.com".to_string()),
    Some(vec![AgentSkill { name: "search".to_string(), description: Some("Web search".to_string()) }]),
).await?;

// Generate a data URI for embedding
let data_uri = agent.to_agent_card_data_uri().await?;
```

## Registration Helpers

Build the `userDefinedData` strings that Self Protocol expects during registration:

```rust
use self_agent_sdk::registration::*;

// Config index maps disclosure flags to one of 6 on-chain configs
let d = RegistrationDisclosures { minimum_age: 18, ofac: true };
get_registration_config_index(&d); // 4

// Simple mode (verified-wallet) — human IS the agent
build_simple_register_user_data_ascii(&RegistrationDisclosures { minimum_age: 18, ofac: false });
// "R1"

// Advanced mode (agent-identity) — agent has own keypair
let signed = sign_registration_challenge(
    "0xagentPrivKey",
    human_address,
    11142220,
    registry_address,
).await?;

build_advanced_register_user_data_ascii(
    &signed.agent_address,
    &signed.parts,
    &RegistrationDisclosures { minimum_age: 18, ofac: true },
); // "K4{addr}{r}{s}{v}"

// Deregistration
build_simple_deregister_user_data_ascii(&d);           // "D4"
build_advanced_deregister_user_data_ascii("0x...", &d); // "X4{addr}"

// Wallet-free mode — agent acts as guardian
build_wallet_free_register_user_data_ascii(
    "0xagent", "0xguardian", &signed.parts, &d,
); // "W4{agent}{guardian}{r}{s}{v}"
```

## REST Registration API

Programmatic registration without the CLI:

Set `SELF_AGENT_API_BASE` to override the default hosted API base.

```rust
use self_agent_sdk::{RegistrationRequest, RegistrationSession};

// Start a registration session
let session = RegistrationSession::request(
    RegistrationRequest {
        mode: "agent-identity".to_string(),
        network: "mainnet".to_string(),
        ..Default::default()
    },
    None, // use default API base
).await?;

println!("{}", session.deep_link);           // URL for the human to open
println!("{:?}", session.human_instructions); // Steps for the human

// Wait for completion (polls on-chain)
let result = session.wait_for_completion(Some(300_000), None).await?;
println!("Agent ID: {}", result.agent_id);

// Export the generated private key
let private_key = session.export_key().await?;
```

## CLI

Interactive registration via the command line:

```bash
# Register an agent (agent-identity mode)
self-agent-cli register init --mode agent-identity --human-address 0x... --network testnet
self-agent-cli register open --session .self/session.json
self-agent-cli register wait --session .self/session.json

# Deregister
self-agent-cli deregister init --mode agent-identity --human-address 0x... --agent-address 0x... --network testnet
self-agent-cli deregister open --session .self/session.json
self-agent-cli deregister wait --session .self/session.json

# Export private key (requires --unsafe flag)
self-agent-cli register export --session .self/session.json --unsafe --print-private-key
```

**Registration modes:**

| Mode | Description | `userDefinedData` |
|------|-------------|-------------------|
| `verified-wallet` | Human address = agent address | `R{cfg}` |
| `agent-identity` | Agent has own keypair, signed challenge | `K{cfg}{addr}{r}{s}{v}` |
| `wallet-free` | Agent as guardian, no human wallet needed | `W{cfg}{addr}{guardian}{r}{s}{v}` |
| `smart-wallet` | ZeroDev Kernel + passkeys | Smart wallet template |

## Configuration

```rust
// Testnet
let agent = SelfAgent::new(SelfAgentConfig {
    private_key: "0x...".to_string(),
    network: Some(NetworkName::Testnet),
    registry_address: None,
    rpc_url: None,
})?;

// Custom overrides
let verifier = SelfAgentVerifier::new(VerifierConfig {
    registry_address: Some(Address::from_str("0x...")?),
    rpc_url: Some("https://...".to_string()),
    max_agents_per_human: Some(5),
    require_self_provider: Some(true),
    include_credentials: Some(true),
    ..Default::default()
});
```

## Security Chain

The verifier implements an 11-step security chain:

1. **Timestamp freshness** — reject stale requests (default: 5 min window)
2. **Signature recovery** — derive agent address from ECDSA signature
3. **Agent key derivation** — `zeroPad(address, 32)` for on-chain lookup
4. **On-chain verification** — `isVerifiedAgent(agentKey)` confirms human backing
5. **Provider check** — ensures proof came from Self Protocol, not a third party
6. **Sybil resistance** — limits agents per human (default: 1)
7. **Replay protection** — reject duplicate `(signature, timestamp)` pairs
8. **Credential validation** — verify ZK-attested credentials if configured
9. **Age verification** — enforce minimum age from passport proof
10. **OFAC screening** — verify agent passed sanctions screening
11. **Rate limiting** — per-agent request throttling

## Cross-Language Compatibility

This SDK is 100% compatible with the TypeScript SDK (`@selfxyz/agent-sdk`) and Python SDK (`selfxyz-agent-sdk`). All three produce byte-identical signatures and `userDefinedData` payloads for the same inputs.

## Run Tests

```bash
cargo test
```

Integration tests (require network access, skipped by default):

```bash
cargo test -- --ignored
```

## Networks

| Network | Registry | Chain ID |
|---------|----------|----------|
| Mainnet (Celo) | `0x62E37d0f6c5f67784b8828B3dF68BCDbB2e55095` | 42220 |
| Testnet (Celo Sepolia) | `0x29d941856134b1D053AfFF57fa560324510C79fa` | 11142220 |

## License

MIT
