#!/bin/bash
# SPDX-License-Identifier: MIT

set -euo pipefail

# Run LangChain agent locally — auth disabled (Next.js proxy handles it).
#
# Required env vars (set in your shell or .env):
#   AGENT_PRIVATE_KEY=0x...   (same key you registered with)
#   OPENAI_API_KEY=sk-...     (budget-capped OpenAI key)

if [ -z "${AGENT_PRIVATE_KEY:-}" ]; then
  echo "ERROR: AGENT_PRIVATE_KEY not set"
  echo "  export AGENT_PRIVATE_KEY=0x..."
  exit 1
fi

if [ -z "${OPENAI_API_KEY:-}" ]; then
  echo "ERROR: OPENAI_API_KEY not set"
  echo "  export OPENAI_API_KEY=sk-..."
  exit 1
fi

export REQUIRE_AUTH=false
exec uvicorn main:app --host 127.0.0.1 --port 8090 --reload
