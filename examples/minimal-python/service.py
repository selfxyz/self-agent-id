"""Minimal service: verify agent requests with FastAPI."""
from fastapi import FastAPI, Depends
from self_agent_sdk import SelfAgentVerifier
from self_agent_sdk.middleware.fastapi import AgentAuth

app = FastAPI()

verifier = (
    SelfAgentVerifier.create()
    .network("testnet")
    .require_age(18)
    .require_ofac()
    .sybil_limit(3)
    .build()
)
agent_auth = AgentAuth(verifier)


@app.post("/api/data")
async def handle(agent=Depends(agent_auth)):
    print(f"Verified agent: {agent.agent_address}")
    return {"ok": True, "agent": agent.agent_address}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
