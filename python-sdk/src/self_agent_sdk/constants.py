# SPDX-FileCopyrightText: 2025-2026 Social Connect Labs, Inc.
# SPDX-License-Identifier: BUSL-1.1
# NOTE: Converts to Apache-2.0 on 2029-06-11 per LICENSE.

"""Constants for the Self Agent SDK, mirroring sdk/src/constants.ts.

Defines network configurations, default timeouts, HTTP header names,
and JSON ABIs for the SelfAgentRegistry and IHumanProofProvider contracts.
"""

from typing import TypedDict, Literal

NetworkName = Literal["mainnet", "testnet"]


class NetworkConfig(TypedDict):
    """Typed dict for per-network registry address and RPC endpoint."""

    registry_address: str
    rpc_url: str


# Celo mainnet and Celo Sepolia testnet configurations
NETWORKS: dict[NetworkName, NetworkConfig] = {
    "mainnet": {
        "registry_address": "0xaC3DF9ABf80d0F5c020C06B04Cced27763355944",
        "rpc_url": "https://forno.celo.org",
    },
    "testnet": {
        "registry_address": "0x043DaCac8b0771DD5b444bCC88f2f8BBDBEdd379",
        "rpc_url": "https://forno.celo-sepolia.celo-testnet.org",
    },
}

DEFAULT_NETWORK: NetworkName = "mainnet"
ZERO_ADDRESS = "0x" + "0" * 40
DEFAULT_MAX_AGE_MS = 5 * 60 * 1000       # 5 minutes
DEFAULT_CACHE_TTL_MS = 60_000             # 1 minute

# Self Hub V2 action byte for proof refresh
ACTION_REFRESH = 0x46  # 'F'
ACTION_IDENTIFY = 0x49  # 'I'

# Seconds before expiry at which the proof is considered "expiring soon" (30 days)
EXPIRY_WARNING_THRESHOLD_SECS = 30 * 24 * 60 * 60

# HTTP header names used in agent-to-agent signed requests
HEADERS = {
    "ADDRESS": "x-self-agent-address",
    "SIGNATURE": "x-self-agent-signature",
    "TIMESTAMP": "x-self-agent-timestamp",
    "KEYTYPE": "x-self-agent-keytype",
    "KEY": "x-self-agent-key",
}

# JSON ABI for web3.py — mirrors sdk/src/constants.ts REGISTRY_ABI
REGISTRY_ABI = [
    {"name": "isVerifiedAgent", "type": "function", "stateMutability": "view",
     "inputs": [{"name": "agentPubKey", "type": "bytes32"}],
     "outputs": [{"name": "", "type": "bool"}]},
    {"name": "getAgentId", "type": "function", "stateMutability": "view",
     "inputs": [{"name": "agentPubKey", "type": "bytes32"}],
     "outputs": [{"name": "", "type": "uint256"}]},
    {"name": "hasHumanProof", "type": "function", "stateMutability": "view",
     "inputs": [{"name": "agentId", "type": "uint256"}],
     "outputs": [{"name": "", "type": "bool"}]},
    {"name": "getHumanNullifier", "type": "function", "stateMutability": "view",
     "inputs": [{"name": "agentId", "type": "uint256"}],
     "outputs": [{"name": "", "type": "uint256"}]},
    {"name": "getAgentCountForHuman", "type": "function", "stateMutability": "view",
     "inputs": [{"name": "nullifier", "type": "uint256"}],
     "outputs": [{"name": "", "type": "uint256"}]},
    {"name": "sameHuman", "type": "function", "stateMutability": "view",
     "inputs": [{"name": "agentIdA", "type": "uint256"}, {"name": "agentIdB", "type": "uint256"}],
     "outputs": [{"name": "", "type": "bool"}]},
    {"name": "getProofProvider", "type": "function", "stateMutability": "view",
     "inputs": [{"name": "agentId", "type": "uint256"}],
     "outputs": [{"name": "", "type": "address"}]},
    {"name": "selfProofProvider", "type": "function", "stateMutability": "view",
     "inputs": [],
     "outputs": [{"name": "", "type": "address"}]},
    {"name": "ownerOf", "type": "function", "stateMutability": "view",
     "inputs": [{"name": "tokenId", "type": "uint256"}],
     "outputs": [{"name": "", "type": "address"}]},
    {"name": "getAgentCredentials", "type": "function", "stateMutability": "view",
     "inputs": [{"name": "agentId", "type": "uint256"}],
     "outputs": [{"name": "", "type": "tuple", "components": [
         {"name": "issuingState", "type": "string"},
         {"name": "name", "type": "string[]"},
         {"name": "idNumber", "type": "string"},
         {"name": "nationality", "type": "string"},
         {"name": "dateOfBirth", "type": "string"},
         {"name": "gender", "type": "string"},
         {"name": "expiryDate", "type": "string"},
         {"name": "olderThan", "type": "uint256"},
         {"name": "ofac", "type": "bool[3]"},
     ]}],
    },
    # A2A Agent Cards
    {"name": "getAgentMetadata", "type": "function", "stateMutability": "view",
     "inputs": [{"name": "agentId", "type": "uint256"}],
     "outputs": [{"name": "", "type": "string"}]},
    {"name": "updateAgentMetadata", "type": "function", "stateMutability": "nonpayable",
     "inputs": [{"name": "agentId", "type": "uint256"}, {"name": "metadata", "type": "string"}],
     "outputs": []},
    {"name": "agentRegisteredAt", "type": "function", "stateMutability": "view",
     "inputs": [{"name": "agentId", "type": "uint256"}],
     "outputs": [{"name": "", "type": "uint256"}]},
    # ERC-8004: proof expiry
    {"name": "proofExpiresAt", "type": "function", "stateMutability": "view",
     "inputs": [{"name": "agentId", "type": "uint256"}],
     "outputs": [{"name": "", "type": "uint256"}]},
    {"name": "isProofFresh", "type": "function", "stateMutability": "view",
     "inputs": [{"name": "agentId", "type": "uint256"}],
     "outputs": [{"name": "", "type": "bool"}]},
    # Replay-protection nonces for registration signatures
    {"name": "agentNonces", "type": "function", "stateMutability": "view",
     "inputs": [{"name": "agent", "type": "address"}],
     "outputs": [{"name": "", "type": "uint256"}]},
    # Nullifier → agent lookups
    {"name": "getAgentsForNullifier", "type": "function", "stateMutability": "view",
     "inputs": [{"name": "nullifier", "type": "uint256"}],
     "outputs": [{"name": "", "type": "uint256[]"}]},
    {"name": "getAgentsForNullifier", "type": "function", "stateMutability": "view",
     "inputs": [{"name": "nullifier", "type": "uint256"}, {"name": "offset", "type": "uint256"}, {"name": "limit", "type": "uint256"}],
     "outputs": [{"name": "", "type": "uint256[]"}]},
    # Agent config identifier
    {"name": "agentConfigId", "type": "function", "stateMutability": "view",
     "inputs": [{"name": "agentId", "type": "uint256"}],
     "outputs": [{"name": "", "type": "bytes32"}]},
    # Proof refresh event
    {"name": "HumanProofRefreshed", "type": "event",
     "inputs": [
         {"name": "agentId", "type": "uint256", "indexed": True},
         {"name": "newExpiry", "type": "uint256", "indexed": False},
         {"name": "nullifier", "type": "uint256", "indexed": False},
         {"name": "configId", "type": "bytes32", "indexed": False},
     ]},
]

# ABI for IHumanProofProvider — used to query provider metadata
PROVIDER_ABI = [
    {"name": "providerName", "type": "function", "stateMutability": "view",
     "inputs": [], "outputs": [{"name": "", "type": "string"}]},
    {"name": "verificationStrength", "type": "function", "stateMutability": "view",
     "inputs": [], "outputs": [{"name": "", "type": "uint8"}]},
]
