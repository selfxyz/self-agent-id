"""FastAPI app wrapping a LangChain agent with Self Agent ID verification.

Security layers:
1. On-chain: max 1 agent per human (contract-level)
2. SDK: requireSelfProvider=True, maxAgentsPerHuman=1
3. Rate limiting: 10 requests/hour per agent address
4. Cloud Run: max 3 instances, 10 concurrency, gVisor sandbox
"""
import time

from fastapi import FastAPI, Request, HTTPException, Depends
from self_agent_sdk import SelfAgentVerifier
from self_agent_sdk.middleware.fastapi import AgentAuth

from agent import executor

app = FastAPI(title="Self Agent ID + LangChain Demo")

verifier = SelfAgentVerifier(
    max_agents_per_human=1,
    require_self_provider=True,
)
auth = AgentAuth(verifier)

# In-memory rate limiter (resets on container restart — acceptable for demo)
rate_limits: dict[str, list[float]] = {}


def check_rate_limit(agent_address: str, max_per_hour: int = 10) -> bool:
    """Rate limit by agent address. Since max_agents_per_human=1,
    each address maps 1:1 to a unique human."""
    now = time.time()
    key = agent_address.lower()
    timestamps = [t for t in rate_limits.get(key, []) if t > now - 3600]
    rate_limits[key] = timestamps
    if len(timestamps) >= max_per_hour:
        return False
    timestamps.append(now)
    return True


@app.post("/agent")
async def handle(request: Request, agent_result=Depends(auth)):
    if not check_rate_limit(agent_result.agent_address, max_per_hour=10):
        raise HTTPException(429, "Rate limited - 10 requests/hour per human")

    body = await request.json()
    result = executor.invoke({"input": body.get("query", "")})
    return {"response": result["output"], "agent": agent_result.agent_address}


@app.get("/health")
async def health():
    return {"status": "ok"}
