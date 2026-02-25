# selfxyz-agent-sdk

Python SDK for [Self Agent ID](https://self-agent-id.vercel.app) — on-chain AI agent identity with proof-of-human verification.

Sign requests in Python, verify in TypeScript or Rust, or vice versa. The signing protocol is language-agnostic — all SDKs produce identical signatures.

## Install

```bash
pip install selfxyz-agent-sdk
```

## Agent Side — Sign Requests

```python
from self_agent_sdk import SelfAgent

agent = SelfAgent(private_key="0x...", network="mainnet")

# Sign a request (returns dict of auth headers)
headers = agent.sign_request("POST", "https://api.example.com/data",
                             body='{"query": "test"}')

# Or use the built-in HTTP client
response = agent.fetch("https://api.example.com/data",
                       method="POST", body='{"query": "test"}')

# Check registration status
print(agent.is_registered())  # True/False
print(agent.get_info())       # AgentInfo(agent_id=5, is_verified=True, ...)
```

### Credentials

```python
# Fetch ZK-attested credentials (nationality, age, OFAC, etc.)
creds = agent.get_credentials()
# AgentCredentials(issuing_state="GBR", nationality="GBR", older_than=18, ofac=[True], ...)

strength = agent.get_verification_strength()
# 0 = unverified, 1 = basic, 2 = standard, 3 = enhanced
```

## Service Side — Verify Requests

```python
from self_agent_sdk import SelfAgentVerifier

verifier = SelfAgentVerifier()  # mainnet by default

result = verifier.verify(
    signature=request.headers["x-self-agent-signature"],
    timestamp=request.headers["x-self-agent-timestamp"],
    method=request.method,
    url=request.path,
    body=request.get_data(as_text=True),
)

if result.valid:
    print(f"Verified agent: {result.agent_address}")
```

### VerifierBuilder

Chainable API for configuring verification requirements:

```python
from self_agent_sdk import VerifierBuilder

verifier = (
    VerifierBuilder()
    .network("mainnet")
    .require_age(18)
    .require_ofac()
    .require_nationality("US", "GB", "DE")
    .require_self_provider()
    .sybil_limit(1)
    .rate_limit(per_minute=60, per_hour=1000)
    .replay_protection()
    .include_credentials()
    .max_age(300_000)     # 5 min timestamp window
    .cache_ttl(60_000)    # 1 min cache
    .build()
)
```

### Static Factory

```python
# From a flat config dict (useful for env-driven config)
verifier = SelfAgentVerifier.from_config({
    "network": "mainnet",
    "require_age": 18,
    "require_ofac": True,
    "sybil_limit": 1,
})
```

### Flask Middleware

```python
from flask import Flask, g, jsonify
from self_agent_sdk import SelfAgentVerifier
from self_agent_sdk.middleware.flask import require_agent

app = Flask(__name__)
verifier = SelfAgentVerifier()

@app.route("/api/data", methods=["POST"])
@require_agent(verifier)
def handle():
    print(g.agent.agent_address)
    return jsonify(ok=True)
```

### FastAPI Dependency

```python
from fastapi import FastAPI, Depends
from self_agent_sdk import SelfAgentVerifier
from self_agent_sdk.middleware.fastapi import AgentAuth
from self_agent_sdk.types import VerificationResult

app = FastAPI()
verifier = SelfAgentVerifier()
auth = AgentAuth(verifier)

@app.post("/api/data")
async def handle(agent: VerificationResult = Depends(auth)):
    print(agent.agent_address)
    return {"ok": True}
```

## Proof Expiry & Refresh

Human proofs expire after `maxProofAge` (default: 365 days) or at passport document expiry, whichever is sooner. The expiry timestamp is set on-chain at registration.

```python
# Check proof freshness
info = agent.get_info()
print(info.proof_expires_at)  # unix seconds, 0 if unregistered

# Check if expiring within 30 days
import time
THIRTY_DAYS = 30 * 24 * 60 * 60
if info.proof_expires_at > 0 and info.proof_expires_at - time.time() < THIRTY_DAYS:
    print("Proof expiring soon — prompt human to re-verify")
```

**Verifier-side:** The verifier returns `reason="PROOF_EXPIRED"` when an agent's proof has lapsed.

**Refreshing:** There is no in-place refresh. Deregister (burn NFT) → re-register (new passport scan, new agentId, fresh expiry):

```python
agent.request_deregistration()  # human confirms via Self app
# ... after completion:
session = agent.request_registration(minimum_age=18, ofac=True)
```

## A2A Agent Card

Publish machine-readable identity metadata for agent-to-agent discovery:

```python
# Read the on-chain agent card
card = agent.get_agent_card()
# A2AAgentCard(name="My Agent", self_protocol=SelfProtocolExtension(...))

# Set or update the agent card (writes on-chain, returns tx hash)
tx_hash = agent.set_agent_card(
    name="My Agent",
    description="An AI assistant with verified identity",
    url="https://myagent.example.com",
    skills=[AgentSkill(name="search", description="Web search")],
)

# Generate a data URI for embedding
data_uri = agent.to_agent_card_data_uri()
```

## Registration Helpers

Build the `userDefinedData` strings that Self Protocol expects during registration:

```python
from self_agent_sdk import (
    get_registration_config_index,
    compute_registration_challenge_hash,
    sign_registration_challenge,
    build_simple_register_user_data_ascii,
    build_simple_deregister_user_data_ascii,
    build_advanced_register_user_data_ascii,
    build_advanced_deregister_user_data_ascii,
    build_wallet_free_register_user_data_ascii,
)

# Config index maps disclosure flags to one of 6 on-chain configs
get_registration_config_index({"minimumAge": 18, "ofac": True})  # 4

# Simple mode (verified-wallet) — human IS the agent
build_simple_register_user_data_ascii({"minimumAge": 18})   # "R1"
build_simple_deregister_user_data_ascii({"minimumAge": 18})  # "D1"

# Advanced mode (agent-identity) — agent has own keypair
signed = sign_registration_challenge(
    private_key="0xagentPrivKey",
    human_identifier="0xhumanAddr",
    chain_id=11142220,
    registry_address="0x29d94...",
)

build_advanced_register_user_data_ascii(
    agent_address=signed.agent_address,
    signature_r=signed.r,
    signature_s=signed.s,
    signature_v=signed.v,
    disclosures={"minimumAge": 18, "ofac": True},
)  # "K4{addr}{r}{s}{v}"

# Deregistration
build_advanced_deregister_user_data_ascii("0xagent")  # "X0{addr}"

# Wallet-free mode — agent acts as guardian
build_wallet_free_register_user_data_ascii(
    agent_address="0xagent",
    signature_r=signed.r,
    signature_s=signed.s,
    signature_v=signed.v,
    guardian_address="0xguardian",
    disclosures={"minimumAge": 18},
)  # "W1{agent}{guardian}{r}{s}{v}"
```

## REST Registration API

Programmatic registration without the CLI:

Set `SELF_AGENT_API_BASE` to override the default hosted API base.

```python
from self_agent_sdk import SelfAgent

# Start a registration session
session = SelfAgent.request_registration(
    mode="agent-identity",
    network="mainnet",
    disclosures={"minimumAge": 18, "ofac": True},
    agent_name="My Agent",
)

print(session.deep_link)            # URL for the human to open
print(session.human_instructions)   # Steps for the human

# Wait for completion (polls on-chain)
result = session.wait_for_completion(timeout_ms=300_000)
print(result.agent_id)        # On-chain agent ID
print(result.agent_address)   # Agent's address

# Export the generated private key
private_key = session.export_key()

# Deregister
dereg_session = agent.request_deregistration()
dereg_session.wait_for_completion()
```

## CLI

Interactive registration via the command line:

```bash
# Register an agent (agent-identity mode)
self-agent register init --mode agent-identity --human-address 0x... --network testnet
self-agent register open --session .self/session.json
self-agent register wait --session .self/session.json

# Deregister
self-agent deregister init --mode agent-identity --human-address 0x... --agent-address 0x... --network testnet
self-agent deregister open --session .self/session.json
self-agent deregister wait --session .self/session.json

# Export private key (requires --unsafe flag)
self-agent register export --session .self/session.json --unsafe --print-private-key
```

**Registration modes:**

| Mode | Description | `userDefinedData` |
|------|-------------|-------------------|
| `verified-wallet` | Human address = agent address | `R{cfg}` |
| `agent-identity` | Agent has own keypair, signed challenge | `K{cfg}{addr}{r}{s}{v}` |
| `wallet-free` | Agent as guardian, no human wallet needed | `W{cfg}{addr}{guardian}{r}{s}{v}` |
| `smart-wallet` | ZeroDev Kernel + passkeys | Smart wallet template |

## Configuration

```python
# Testnet
agent = SelfAgent(private_key="0x...", network="testnet")
verifier = SelfAgentVerifier(network="testnet")

# Custom overrides
verifier = SelfAgentVerifier(
    registry_address="0x...",      # Custom registry
    rpc_url="https://...",         # Custom RPC
    max_agents_per_human=5,        # Sybil cap (0 = disabled)
    require_self_provider=True,    # Verify proof provider (default)
    include_credentials=True,      # Fetch ZK-attested credentials
)
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

This SDK is 100% compatible with the TypeScript SDK (`@selfxyz/agent-sdk`) and Rust SDK (`self-agent-sdk`). All three produce byte-identical signatures and `userDefinedData` payloads for the same inputs. Test vectors generated from TypeScript are verified byte-for-byte in the Python test suite.

## Run Tests

From `python-sdk/`:

```bash
./scripts/test.sh
```

Manual setup (equivalent):

```bash
python3 -m venv .venv
. .venv/bin/activate
pip install -e ".[test]"
pytest -q
```

## Networks

| Network | Registry | Chain ID |
|---------|----------|----------|
| Mainnet (Celo) | `0x62E37d0f6c5f67784b8828B3dF68BCDbB2e55095` | 42220 |
| Testnet (Celo Sepolia) | `0x29d941856134b1D053AfFF57fa560324510C79fa` | 11142220 |

## License

Business Source License 1.1 (`BUSL-1.1`). See [../LICENSE](../LICENSE).
