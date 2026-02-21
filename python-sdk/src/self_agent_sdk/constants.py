"""Constants mirroring sdk/src/constants.ts"""
from typing import TypedDict, Literal

NetworkName = Literal["mainnet", "testnet"]


class NetworkConfig(TypedDict):
    registry_address: str
    rpc_url: str


NETWORKS: dict[NetworkName, NetworkConfig] = {
    "mainnet": {
        "registry_address": "0x62E37d0f6c5f67784b8828B3dF68BCDbB2e55095",
        "rpc_url": "https://forno.celo.org",
    },
    "testnet": {
        "registry_address": "0x42CEA1b318557aDE212bED74FC3C7f06Ec52bd5b",
        "rpc_url": "https://forno.celo-sepolia.celo-testnet.org",
    },
}

DEFAULT_NETWORK: NetworkName = "mainnet"
ZERO_ADDRESS = "0x" + "0" * 40
DEFAULT_MAX_AGE_MS = 5 * 60 * 1000       # 5 minutes
DEFAULT_CACHE_TTL_MS = 60_000             # 1 minute

HEADERS = {
    "ADDRESS": "x-self-agent-address",
    "SIGNATURE": "x-self-agent-signature",
    "TIMESTAMP": "x-self-agent-timestamp",
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
         {"name": "ofac", "type": "bool[]"},
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
]

# ABI for IHumanProofProvider — used to query provider metadata
PROVIDER_ABI = [
    {"name": "providerName", "type": "function", "stateMutability": "view",
     "inputs": [], "outputs": [{"name": "", "type": "string"}]},
    {"name": "verificationStrength", "type": "function", "stateMutability": "view",
     "inputs": [], "outputs": [{"name": "", "type": "uint8"}]},
]
