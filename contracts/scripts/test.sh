#!/usr/bin/env bash
set -euo pipefail

# Foundry can panic on some macOS/system proxy setups while resolving
# external signature metadata. `--offline` avoids that path and is stable.
EVM_VERSION="${EVM_VERSION:-cancun}"

if [[ "${SELF_AGENT_CONTRACTS_ONLINE:-0}" == "1" ]]; then
  exec forge test --evm-version "$EVM_VERSION" "$@"
fi

exec forge test --offline --evm-version "$EVM_VERSION" "$@"
