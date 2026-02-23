# Minimal Rust Example

Agent signing + service verification with Self Agent ID.

## Build

```bash
cargo build
```

## Run the service

```bash
export AGENT_PRIVATE_KEY=0x...
cargo run --bin service
```

## Run the agent (in another terminal)

```bash
export AGENT_PRIVATE_KEY=0x...
cargo run --bin agent
```

The agent signs requests with ECDSA. The Axum service verifies signatures against the on-chain registry and enforces age and OFAC policies.
