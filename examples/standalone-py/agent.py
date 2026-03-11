# SPDX-License-Identifier: MIT

"""
Standalone Ed25519 Agent — Python Reference Implementation

Demonstrates the full lifecycle:
  1. Generate or load an Ed25519 keypair
  2. Check registration status
  3. Authenticate API requests with Ed25519 signatures
  4. Verify another agent's identity (service-side)
"""

import os
import secrets

from self_agent_sdk import Ed25519Agent, SelfAgentVerifier

# ── 1. Generate or load keypair ──────────────────────────────────────────────

seed = os.environ.get("ED25519_SEED") or secrets.token_hex(32)
print(f"Ed25519 seed: {seed}")

agent = Ed25519Agent(private_key=seed, network="testnet")
print(f"Agent address (derived): {agent.address}")
print(f"Agent key (keccak256): {agent.agent_key}")

# ── 2. Check registration ────────────────────────────────────────────────────

registered = agent.is_registered()
print(f"Registered: {registered}")

if not registered:
    print("\nAgent not registered. To register:")
    print("1. Visit https://app.ai.self.xyz/register")
    print("2. Enter your Ed25519 seed (64 hex chars, no 0x prefix)")
    print("3. Scan the QR code with your Self app")
    print("4. Re-run this script after registration completes")
    raise SystemExit(0)

# ── 3. Make signed requests ──────────────────────────────────────────────────

info = agent.get_info()
print(f"\nAgent ID: #{info.agent_id}")
print(f"Verified: {info.is_verified}")

SERVICE_URL = os.environ.get(
    "SERVICE_URL", "http://localhost:3000/api/demo/verify"
)
print(f"\nSending signed request to {SERVICE_URL}...")

res = agent.fetch(
    SERVICE_URL,
    method="POST",
    body='{"message": "Hello from Ed25519 agent"}',
    headers={"Content-Type": "application/json"},
)
print(f"Response: {res.status_code}")
print(res.text)

# ── 4. Verify another agent (service-side) ───────────────────────────────────

print("\n--- Service-side verification demo ---")

verifier = (
    SelfAgentVerifier.create()
    .network("testnet")
    .sybil_limit(0)
    .replay_protection(False)
    .build()
)

headers = agent.sign_request("GET", "https://example.com/api/test")
result = verifier.verify(
    signature=headers["x-self-agent-signature"],
    timestamp=headers["x-self-agent-timestamp"],
    method="GET",
    url="https://example.com/api/test",
    keytype=headers.get("x-self-agent-keytype"),
    agent_key_hex=headers.get("x-self-agent-key"),
)

print(f"Verification result: {'PASS' if result.valid else 'FAIL'}")
if result.valid:
    print(f"  Agent: {result.agent_address}")
    print(f"  Agent ID: #{result.agent_id}")
