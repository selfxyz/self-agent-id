#!/bin/bash
set -euo pipefail

# Deploy LangChain demo to Cloud Run with isolated service account.
#
# The langchain-demo service account has ZERO IAM permissions — it cannot
# access any other GCP service, read secrets, or modify infrastructure.
# Even if LangChain is compromised, blast radius is limited to:
# - Demo agent key (test-only, no funds)
# - OpenAI key (budget-capped)

# Prerequisites:
# 1. Create isolated service account (one-time):
#    gcloud iam service-accounts create langchain-demo \
#      --display-name="LangChain Demo (isolated)" \
#      --project=self-agent-id
#
# 2. Set env vars:
#    export AGENT_PK="0x..."       # Demo agent private key (test only)
#    export OPENAI_KEY="sk-..."    # Budget-capped OpenAI API key

gcloud run deploy langchain-agent \
  --source=. \
  --region=us-central1 \
  --service-account=langchain-demo@self-agent-id.iam.gserviceaccount.com \
  --max-instances=3 \
  --concurrency=10 \
  --min-instances=0 \
  --cpu-throttling \
  --memory=512Mi \
  --timeout=60 \
  --set-env-vars="AGENT_PRIVATE_KEY=${AGENT_PK},OPENAI_API_KEY=${OPENAI_KEY}" \
  --allow-unauthenticated
