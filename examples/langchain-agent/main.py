# SPDX-License-Identifier: MIT

"""FastAPI app wrapping a LangChain agent with Self Agent ID verification.

The AI agent verifies callers ON-CHAIN before engaging in conversation.
It reads the SelfAgentRegistry contract directly via web3.py to check
whether the caller's agent address maps to a verified, human-backed agent.

Gate logic:
1. Proxy forwards agent_address from x-self-agent-address SDK header
2. Convert address → agentKey: bytes32(uint256(uint160(address)))
3. Call registry.isVerifiedAgent(agentKey) on the correct network
4. If verified → agent is human-backed, chat enabled
5. If not → refused

This serves as reference code for integrating Self Agent ID verification
into any Python service. The key pattern:
  address → agentKey → isVerifiedAgent() → getAgentId()

Security layers:
1. Signed-header authentication: caller must sign the request body
2. On-chain verification: isVerifiedAgent() on SelfAgentRegistry
3. Rate limiting: 10 requests/hour per agent address
4. Cloud Run: max 3 instances, 10 concurrency, gVisor sandbox
5. SSRF prevention: URL validator blocks internal/private hosts
"""
import hashlib
import json
import os
import sys
import time
import traceback

from eth_account.messages import encode_defunct
from fastapi import FastAPI, Request, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from web3 import Web3

app = FastAPI(title="Self Agent ID + LangChain Demo")

# CORS: restrict to configured origins (defaults to the demo frontend)
_allowed_origins = [
    o.strip()
    for o in os.environ.get("CORS_ALLOWED_ORIGINS", "").split(",")
    if o.strip()
]
if not _allowed_origins:
    _allowed_origins = ["https://self-agent-id.vercel.app"]

app.add_middleware(
    CORSMiddleware,
    allow_origins=_allowed_origins,
    allow_methods=["POST", "GET", "OPTIONS"],
    allow_headers=["Content-Type", "x-self-agent-address", "x-self-agent-signature"],
)

# ── Network configuration ─────────────────────────────────────────────────
# Registry addresses and RPC URLs for each supported network.

NETWORKS = {
    "celo-mainnet": {
        "rpc_url": "https://forno.celo.org",
        "registry_address": "0x60651482a3033A72128f874623Fc790061cc46D4",
        "label": "Celo Mainnet",
    },
    "celo-sepolia": {
        "rpc_url": "https://forno.celo-sepolia.celo-testnet.org",
        "registry_address": "0x29d941856134b1D053AfFF57fa560324510C79fa",
        "label": "Celo Sepolia",
    },
}

# Minimal ABI — only the functions needed for verification
REGISTRY_ABI = [
    {
        "inputs": [{"name": "agentPubKey", "type": "bytes32"}],
        "name": "isVerifiedAgent",
        "outputs": [{"name": "", "type": "bool"}],
        "stateMutability": "view",
        "type": "function",
    },
    {
        "inputs": [{"name": "agentPubKey", "type": "bytes32"}],
        "name": "getAgentId",
        "outputs": [{"name": "", "type": "uint256"}],
        "stateMutability": "view",
        "type": "function",
    },
]


def address_to_agent_key(address: str) -> bytes:
    """Convert an Ethereum address to the agentPubKey used by the registry.

    In "simple mode", the agent key is: bytes32(uint256(uint160(address)))
    This is a right-padded 32-byte value with the address in the last 20 bytes.
    """
    addr_int = int(address, 16)
    return addr_int.to_bytes(32, byteorder="big")


def get_registry(network_id: str):
    """Get a web3 contract instance for the SelfAgentRegistry on the given network."""
    net = NETWORKS.get(network_id)
    if not net:
        return None, f"Unknown network: {network_id}"
    w3 = Web3(Web3.HTTPProvider(net["rpc_url"]))
    registry = w3.eth.contract(
        address=Web3.to_checksum_address(net["registry_address"]),
        abi=REGISTRY_ABI,
    )
    return registry, None


def verify_agent_onchain(agent_address: str, network_id: str) -> dict:
    """Check if an agent is verified on-chain. Returns verification info.

    This is the core verification logic:
    1. Convert address → agentKey (bytes32)
    2. Call isVerifiedAgent(agentKey) on the registry
    3. If verified, call getAgentId(agentKey) for the token ID

    This is the AI agent doing its OWN verification — not trusting
    any upstream proxy. The proxy only forwards the address.
    """
    registry, err = get_registry(network_id)
    if err:
        return {"verified": False, "reason": err}

    agent_key = address_to_agent_key(agent_address)

    try:
        is_verified = registry.functions.isVerifiedAgent(agent_key).call()
        if not is_verified:
            return {"verified": False, "reason": "Agent not verified on-chain"}

        agent_id = registry.functions.getAgentId(agent_key).call()
        return {"verified": True, "agent_id": agent_id}
    except Exception as exc:
        return {"verified": False, "reason": f"On-chain check failed: {exc}"}


# ── Lazy-load LangChain executor ──────────────────────────────────────────

executor = None
_init_error = None

try:
    from agent import executor as _executor
    executor = _executor
    print("Agent executor initialized", flush=True)
except Exception as exc:
    _init_error = traceback.format_exc()
    print(f"INIT ERROR: {exc}", file=sys.stderr, flush=True)
    print(_init_error, file=sys.stderr, flush=True)

# ── Server-side state ──────────────────────────────────────────────────────

# Per-session verification tracking.
# Each browser page load generates a unique session_id. The AI treats each
# session as a fresh encounter — no memory between page refreshes.
# Key: "session:network:address" → {agent_id, verified_at}
session_verified: dict[str, dict] = {}

# Rate limiter (resets on container restart — acceptable for demo)
rate_limits: dict[str, list[float]] = {}

# Global visitor stats (persists across sessions for the AI's personality)
unique_visitors: set[str] = set()
total_queries: int = 0


def check_rate_limit(agent_address: str, max_per_hour: int = 10) -> bool:
    now = time.time()
    key = agent_address.lower()
    timestamps = [t for t in rate_limits.get(key, []) if t > now - 3600]
    rate_limits[key] = timestamps
    if len(timestamps) >= max_per_hour:
        return False
    timestamps.append(now)
    return True


def is_valid_address(addr: str) -> bool:
    """Check if addr looks like a real Ethereum address."""
    return addr.startswith("0x") and len(addr) == 42


def verify_signature(agent_address: str, signature: str, body_bytes: bytes) -> bool:
    """Verify that the caller controls the claimed agent address.

    The caller signs SHA-256(request_body) with their agent private key.
    We recover the signer address and compare to the claimed address.
    """
    try:
        digest = hashlib.sha256(body_bytes).hexdigest()
        message = encode_defunct(text=digest)
        recovered = Web3().eth.account.recover_message(message, signature=signature)
        return recovered.lower() == agent_address.lower()
    except Exception:
        return False


@app.post("/agent")
async def handle(request: Request):
    if _init_error:
        raise HTTPException(status_code=500, detail="Service temporarily unavailable")

    # ── Signed-header authentication ────────────────────────────────────
    # The caller MUST provide x-self-agent-address and x-self-agent-signature
    # headers. The signature proves the caller controls the agent private key.
    agent_address = request.headers.get("x-self-agent-address", "").lower()
    signature = request.headers.get("x-self-agent-signature", "")

    if not agent_address or not is_valid_address(agent_address):
        raise HTTPException(status_code=401, detail="Missing or invalid x-self-agent-address header")
    if not signature:
        raise HTTPException(status_code=401, detail="Missing x-self-agent-signature header")

    body_bytes = await request.body()
    if not verify_signature(agent_address, signature, body_bytes):
        raise HTTPException(status_code=401, detail="Invalid signature — caller does not control this agent address")

    body = json.loads(body_bytes)
    query = body.get("query", "")
    network_id = body.get("network", "celo-sepolia")
    session_id = body.get("session_id", "unknown")

    if not check_rate_limit(agent_address):
        raise HTTPException(status_code=429, detail="Rate limited - 10 requests/hour per agent")

    global total_queries
    total_queries += 1
    unique_visitors.add(agent_address)

    net_label = NETWORKS.get(network_id, {}).get("label", network_id)

    # ── On-chain verification gate ─────────────────────────────────────────
    # The AI agent checks on-chain ITSELF before engaging.
    # Verification is tracked per SESSION — each page refresh is a fresh
    # encounter. The AI has no memory between browser sessions.

    session_key = f"{session_id}:{network_id}:{agent_address}"
    already_verified_this_session = session_key in session_verified
    is_verified = False
    first_verification = False
    agent_id = None

    if is_valid_address(agent_address):
        if already_verified_this_session:
            # Already checked this session — use cached result
            is_verified = True
            agent_id = session_verified[session_key]["agent_id"]
        else:
            # Fresh check — call the contract
            check = verify_agent_onchain(agent_address, network_id)
            if check["verified"]:
                session_verified[session_key] = {
                    "agent_id": check["agent_id"],
                    "verified_at": time.time(),
                }
                is_verified = True
                first_verification = True
                agent_id = check["agent_id"]

    # ── Build caller context for the AI ────────────────────────────────────

    if is_verified and first_verification:
        caller_context = (
            f"- Their agent address is {agent_address}\n"
            f"- Network: {net_label}\n"
            f"- Their agent ID is #{agent_id}\n"
            f"- You have JUST NOW verified them on-chain — they are human-backed!\n"
            f"- You called isVerifiedAgent() on the SelfAgentRegistry and it returned true.\n"
            f"- This is the first time you are meeting them in this session.\n"
            f"- You have seen {len(unique_visitors)} unique human(s) so far, {total_queries} total queries.\n"
            f"- You have now enabled the chat for this agent's human."
        )
    elif is_verified:
        caller_context = (
            f"- Their agent address is {agent_address}\n"
            f"- Network: {net_label}\n"
            f"- Their agent ID is #{agent_id}\n"
            f"- They are verified as human-backed (you checked on-chain earlier this session).\n"
            f"- You have seen {len(unique_visitors)} unique human(s) so far, {total_queries} total queries."
        )
    else:
        # Hard gate — don't even invoke the AI for unverified agents.
        # We cannot trust the LLM to reliably refuse; enforce at the service level.
        return {
            "response": (
                "meow... I checked on-chain and you are NOT a verified agent. "
                "isVerifiedAgent() returned false. "
                "I cannot talk to you until you register and verify at self.xyz. "
                "Go prove you're human first. meow."
            ),
            "agent": agent_address,
            "verified": False,
        }

    try:
        result = executor.invoke({
            "input": query,
            "caller_context": caller_context,
        })
        return {"response": result["output"], "agent": agent_address, "verified": True}
    except Exception as exc:
        print(f"EXECUTOR ERROR: {exc}", file=sys.stderr, flush=True)
        traceback.print_exc(file=sys.stderr)
        raise HTTPException(status_code=500, detail="Agent processing failed")


@app.get("/health")
async def health():
    return {
        "status": "ok" if not _init_error else "degraded",
        "networks": list(NETWORKS.keys()),
        "active_sessions": len(session_verified),
        "total_queries": total_queries,
    }
