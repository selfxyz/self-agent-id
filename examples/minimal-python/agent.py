# SPDX-License-Identifier: MIT

"""Minimal agent: sign and send a verified request."""
import os
from self_agent_sdk import SelfAgent

agent = SelfAgent(
    private_key=os.environ["AGENT_PRIVATE_KEY"],
    network="testnet",
)

# Check registration
print("Registered:", agent.is_registered())

if agent.is_registered():
    info = agent.get_info()
    print(f"Agent ID: {info.agent_id}, Verified: {info.is_verified}")

    # Send a signed request
    res = agent.fetch(
        "http://localhost:8000/api/data",
        method="POST",
        body='{"message": "Hello from a verified agent"}',
    )
    print(f"Response: {res.status_code} {res.text}")
