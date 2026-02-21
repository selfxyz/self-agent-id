from fastapi import Request, HTTPException
from ..verifier import SelfAgentVerifier
from ..types import VerificationResult


class AgentAuth:
    """FastAPI dependency that verifies Self Agent ID on incoming requests.

    Usage:
        verifier = SelfAgentVerifier()
        auth = AgentAuth(verifier)

        @app.post("/api/data")
        async def handle(agent: VerificationResult = Depends(auth)):
            print(agent.agent_address)
    """

    def __init__(self, verifier: SelfAgentVerifier):
        self._verifier = verifier

    async def __call__(self, request: Request) -> VerificationResult:
        sig = request.headers.get("x-self-agent-signature")
        ts = request.headers.get("x-self-agent-timestamp")
        if not sig or not ts:
            raise HTTPException(401, "Missing agent authentication headers")

        body = (await request.body()).decode("utf-8") or None
        result = self._verifier.verify(
            signature=sig, timestamp=ts,
            method=request.method,
            url=str(request.url),
            body=body,
        )
        if not result.valid:
            raise HTTPException(401, result.error)
        return result
