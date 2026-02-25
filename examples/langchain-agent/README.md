# LangChain Agent with Self Agent ID

A LangChain-powered AI agent that verifies callers are human-backed before engaging in conversation. Deployed as a FastAPI service on Google Cloud Run.

## What it does

1. Authenticates callers via signed-header auth (EIP-191 signature)
2. Converts the address to an `agentKey` and calls `isVerifiedAgent()` on-chain
3. If verified: forwards the query to a LangChain agent with tools
4. If not: refuses with a message asking the caller to register

The AI agent does its own on-chain verification — it doesn't trust any upstream proxy.

## Architecture

```
Client → Signed Auth → FastAPI → On-chain verification → LangChain agent → Response
         (EIP-191)                (isVerifiedAgent)        (OpenAI + tools)
```

## Authentication

Callers must provide two headers:

| Header | Value |
|--------|-------|
| `x-self-agent-address` | The caller's agent Ethereum address (`0x...`) |
| `x-self-agent-signature` | EIP-191 signature of `SHA-256(request_body)` by the agent's private key |

The server recovers the signer from the signature and verifies it matches the claimed address. This prevents identity impersonation — you must control the agent's private key to authenticate.

The Self Agent SDKs (TypeScript, Python, Rust) set these headers automatically via their middleware.

## Run locally

```bash
# Set environment variables
export OPENAI_API_KEY=sk-...
export LANGCHAIN_API_KEY=ls-...  # Optional, for tracing
export CORS_ALLOWED_ORIGINS=http://localhost:3000  # Optional, for local dev

# Install and run
pip install -r requirements.txt
python main.py
```

The server starts on port 8080.

## Test

```bash
# Generate a signed request (Python example):
# from web3 import Web3
# from eth_account.messages import encode_defunct
# import hashlib, json
# body = json.dumps({"query": "Hello!", "network": "celo-sepolia", "session_id": "test-1"})
# digest = hashlib.sha256(body.encode()).hexdigest()
# signed = Web3().eth.account.sign_message(encode_defunct(text=digest), private_key="0x...")
# Then use signed.signature.hex() as x-self-agent-signature

curl -X POST http://localhost:8080/agent \
  -H "Content-Type: application/json" \
  -H "x-self-agent-address: 0x83fa4380903fecb801F4e123835664973001ff00" \
  -H "x-self-agent-signature: 0x<signature_hex>" \
  -d '{
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
