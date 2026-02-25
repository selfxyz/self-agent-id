#!/usr/bin/env bash
# SPDX-FileCopyrightText: 2025-2026 Social Connect Labs, Inc.
# SPDX-License-Identifier: BUSL-1.1
# NOTE: Converts to Apache-2.0 on 2029-06-11 per LICENSE.

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DEFAULT_PRIVATE_KEY="0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80"
DEFAULT_DEPLOYER_ADDRESS="0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266"

require_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Missing required command: $1" >&2
    exit 1
  fi
}

pick_port() {
  echo $((37100 + RANDOM % 900))
}

json_field() {
  local key="$1"
  node -e "const fs=require('fs'); const key=process.argv[1]; const raw=fs.readFileSync(0,'utf8').trim(); if(!raw){process.exit(0)}; let parsed; try { parsed = JSON.parse(raw); } catch { process.exit(0); } const value = parsed[key]; if (value === undefined || value === null) { process.exit(0); } process.stdout.write(String(value));" "$key"
}

usage() {
  cat <<'EOF'
Usage:
  local-registry-harness.sh start [--port N] [--host 127.0.0.1] [--private-key 0x...]
  local-registry-harness.sh stop --pid N
  local-registry-harness.sh set-agent --rpc-url URL --registry 0x... --agent-key 0x... --agent-id N [--private-key 0x...] [--verified true|false]
EOF
}

if [ $# -lt 1 ]; then
  usage
  exit 1
fi

subcommand="$1"
shift

case "$subcommand" in
  start)
    require_cmd anvil
    require_cmd forge
    require_cmd cast
    require_cmd curl
    require_cmd node

    host="127.0.0.1"
    port=""
    private_key="$DEFAULT_PRIVATE_KEY"

    while [ $# -gt 0 ]; do
      case "$1" in
        --host)
          host="$2"
          shift 2
          ;;
        --port)
          port="$2"
          shift 2
          ;;
        --private-key)
          private_key="$2"
          shift 2
          ;;
        *)
          echo "Unknown flag for start: $1" >&2
          exit 1
          ;;
      esac
    done

    if [ -z "$port" ]; then
      port="$(pick_port)"
    fi

    rpc_url="http://${host}:${port}"
    log_path="$(mktemp -t local-registry-harness.XXXXXX.log)"

    nohup anvil --host "$host" --port "$port" >"$log_path" 2>&1 &
    anvil_pid=$!

    ready=0
    for _ in $(seq 1 60); do
      if curl -sS \
        --max-time 2 \
        -H "content-type: application/json" \
        -d '{"jsonrpc":"2.0","method":"eth_chainId","params":[],"id":1}' \
        "$rpc_url" | grep -q '"result"'; then
        ready=1
        break
      fi
      sleep 0.2
    done

    if [ "$ready" != "1" ]; then
      kill "$anvil_pid" >/dev/null 2>&1 || true
      echo "Failed to start local anvil node. Log: $log_path" >&2
      exit 1
    fi

    artifact_path="$ROOT_DIR/contracts/out/LocalRegistryHarness.sol/LocalRegistryHarness.json"
    if [ ! -f "$artifact_path" ]; then
      forge build --root "$ROOT_DIR/contracts" >/dev/null
    fi
    if [ ! -f "$artifact_path" ]; then
      kill "$anvil_pid" >/dev/null 2>&1 || true
      echo "Missing contract artifact: $artifact_path" >&2
      exit 1
    fi

    bytecode="$(node -e "const fs=require('fs'); const p=process.argv[1]; const j=JSON.parse(fs.readFileSync(p,'utf8')); const b=(j.bytecode||{}).object || ''; if(!b){process.exit(2)} process.stdout.write(b);" "$artifact_path")"

    deploy_json="$(cast send \
      --rpc-url "$rpc_url" \
      --private-key "$private_key" \
      --create "$bytecode" \
      --json)"

    registry_address="$(printf '%s\n' "$deploy_json" | json_field contractAddress)"
    if [ -z "$registry_address" ]; then
      kill "$anvil_pid" >/dev/null 2>&1 || true
      echo "Failed to parse deployed registry address from deployment output." >&2
      exit 1
    fi

    cat <<EOF
{
  "ok": true,
  "rpcUrl": "$rpc_url",
  "chainId": 31337,
  "registryAddress": "$registry_address",
  "anvilPid": $anvil_pid,
  "anvilLogPath": "$log_path",
  "deployerPrivateKey": "$private_key",
  "deployerAddress": "$DEFAULT_DEPLOYER_ADDRESS"
}
EOF
    ;;

  stop)
    pid=""
    while [ $# -gt 0 ]; do
      case "$1" in
        --pid)
          pid="$2"
          shift 2
          ;;
        *)
          echo "Unknown flag for stop: $1" >&2
          exit 1
          ;;
      esac
    done

    if [ -z "$pid" ]; then
      echo "--pid is required for stop" >&2
      exit 1
    fi

    kill "$pid" >/dev/null 2>&1 || true
    cat <<EOF
{
  "ok": true,
  "stoppedPid": $pid
}
EOF
    ;;

  set-agent)
    require_cmd cast

    rpc_url=""
    registry=""
    agent_key=""
    agent_id=""
    private_key="$DEFAULT_PRIVATE_KEY"
    verified="true"

    while [ $# -gt 0 ]; do
      case "$1" in
        --rpc-url)
          rpc_url="$2"
          shift 2
          ;;
        --registry)
          registry="$2"
          shift 2
          ;;
        --agent-key)
          agent_key="$2"
          shift 2
          ;;
        --agent-id)
          agent_id="$2"
          shift 2
          ;;
        --private-key)
          private_key="$2"
          shift 2
          ;;
        --verified)
          verified="$2"
          shift 2
          ;;
        *)
          echo "Unknown flag for set-agent: $1" >&2
          exit 1
          ;;
      esac
    done

    if [ -z "$rpc_url" ] || [ -z "$registry" ] || [ -z "$agent_key" ] || [ -z "$agent_id" ]; then
      echo "--rpc-url, --registry, --agent-key, and --agent-id are required for set-agent" >&2
      exit 1
    fi

    tx_json="$(cast send "$registry" \
      "setAgent(bytes32,uint256,bool)" \
      "$agent_key" \
      "$agent_id" \
      "$verified" \
      --rpc-url "$rpc_url" \
      --private-key "$private_key" \
      --json)"
    tx_hash="$(printf '%s\n' "$tx_json" | json_field transactionHash)"

    cat <<EOF
{
  "ok": true,
  "txHash": "${tx_hash:-}"
}
EOF
    ;;

  *)
    usage
    exit 1
    ;;
esac
