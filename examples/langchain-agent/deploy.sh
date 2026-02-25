#!/bin/bash
# SPDX-License-Identifier: MIT

set -euo pipefail

# Deploy LangChain demo to Cloud Run with isolated service account.
#
# The langchain-demo service account has ZERO IAM permissions — it cannot
# access any other GCP service, read secrets, or modify infrastructure.
# Even if LangChain is compromised, blast radius is limited to:
# - OpenAI key (budget-capped)

# Prerequisites:
# 1. Create isolated service account (one-time):
#    gcloud iam service-accounts create langchain-demo \
#      --display-name="LangChain Demo (isolated)" \
#      --project=self-protocol
#
# 2. Set env vars:
#    export OPENAI_KEY="sk-..."    # Budget-capped OpenAI API key

if [ -z "${OPENAI_KEY:-}" ]; then
  echo "ERROR: OPENAI_KEY not set"; exit 1
fi

gcloud run deploy langchain-agent \
  --source=. \
  --region=us-central1 \
  --service-account=langchain-demo@self-protocol.iam.gserviceaccount.com \
  --allow-unauthenticated \
  --max-instances=3 \
  --concurrency=10 \
  --min-instances=0 \
  --cpu-throttling \
  --memory=1Gi \
  --timeout=60 \
  --set-env-vars="OPENAI_API_KEY=${OPENAI_KEY}"
