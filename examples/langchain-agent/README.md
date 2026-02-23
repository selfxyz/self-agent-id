# LangChain Agent with Self Agent ID

A LangChain-powered AI agent that verifies callers are human-backed before engaging in conversation. Deployed as a FastAPI service on Google Cloud Run.

## What it does

1. Receives a chat request with an agent address
2. Converts the address to an `agentKey` and calls `isVerifiedAgent()` on-chain
3. If verified: forwards the query to a LangChain agent with tools
4. If not: refuses with a message asking the caller to register

The AI agent does its own on-chain verification — it doesn't trust any upstream proxy.

## Architecture

```
Client → FastAPI → On-chain verification → LangChain agent → Response
                   (isVerifiedAgent)        (OpenAI + tools)
```

## Run locally

```bash
# Set environment variables
export OPENAI_API_KEY=sk-...
export LANGCHAIN_API_KEY=ls-...  # Optional, for tracing

# Install and run
pip install -r requirements.txt
python main.py
```

The server starts on port 8080.

## Test

```bash
curl -X POST http://localhost:8080/agent \
  -H "Content-Type: application/json" \
  -d '{
    "agent_address": "0x83fa4380903fecb801F4e123835664973001ff00",
    "query": "Hello! Tell me about yourself.",
    "network": "celo-sepolia",
    "session_id": "test-1"
  }'
```

## Deploy to Cloud Run

```bash
./deploy.sh
```

See `deploy.sh` for the full `gcloud run deploy` command with security settings.

## Files

| File | Purpose |
|------|---------|
| `main.py` | FastAPI app with on-chain verification gate |
| `agent.py` | LangChain agent executor with tools |
| `tools.py` | Agent tools (web search, URL validator) |
| `Dockerfile` | Container image |
| `deploy.sh` | Cloud Run deployment script |
| `run-local.sh` | Local development script |
