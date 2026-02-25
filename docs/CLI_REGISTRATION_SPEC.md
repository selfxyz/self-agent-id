# CLI Registration Spec

Status: implemented  
Last updated: 2026-02-22

This spec defines the shared CLI contract used by TypeScript, Python, and Rust implementations.

## Supported modes

1. `verified-wallet`
2. `agent-identity`
3. `wallet-free`
4. `smart-wallet`

## Canonical registration challenge domain

All advanced/wallet-free/smart-wallet challenge signatures use:

1. Prefix: `"self-agent-id:register:"`
2. `humanIdentifier` (`address`)
3. `chainId` (`uint256`)
4. `registryAddress` (`address`)

Hashing and signature split (`r`,`s`,`v`) must match across all SDKs.

## CLI command surface

### `register init`

Creates a local session file and mode-specific payload material.

Required:

1. `--mode <verified-wallet|agent-identity|wallet-free|smart-wallet>`

Mode-specific:

1. `--human-address` is required for `verified-wallet` and `agent-identity`

Network selection:

1. `--network <mainnet|testnet>` (default `testnet`), or
2. explicit chain config with `--chain --registry --rpc`

Optional:

1. `--out`
2. `--callback-port`
3. `--ttl-minutes`
4. disclosure flags (`--minimum-age`, `--ofac`, `--nationality`, `--name`, `--date-of-birth`, `--gender`, `--issuing-state`)
5. app metadata (`--app-url`, `--app-name`, `--scope`)

### `register open`

Outputs the browser handoff URL for the session.

Required:

1. `--session`

Optional:

1. `--launch` (currently prints guidance; does not auto-open browser)

### `register wait`

Waits for callback and/or on-chain verification.

Required:

1. `--session`

Optional:

1. `--open` (prints handoff URL at start)
2. `--timeout-seconds`
3. `--poll-ms`
4. `--no-listener` (poll chain only)

### `register status`

Reads current session state.

Required:

1. `--session`

### `register export`

Exports generated agent private key material.

Required:

1. `--session`
2. `--unsafe`

Output selection (at least one):

1. `--out-key <path>`
2. `--print-private-key`

### `deregister init`

Creates a local session file for proof-based revocation.

Required:

1. `--mode <verified-wallet|agent-identity|wallet-free|smart-wallet>`

Mode-specific:

1. `--human-address` is required for `verified-wallet` and `agent-identity`
2. `--agent-address` is required for:
   `agent-identity`, `wallet-free`, `smart-wallet`

Network selection:

1. `--network <mainnet|testnet>` (default `testnet`), or
2. explicit chain config with `--chain --registry --rpc`

Optional:

1. `--out`
2. `--callback-port`
3. `--ttl-minutes`
4. disclosure flags (`--minimum-age`, `--ofac`, `--nationality`, `--name`, `--date-of-birth`, `--gender`, `--issuing-state`)
5. app metadata (`--app-url`, `--app-name`, `--scope`)

### `deregister open`

Outputs the browser handoff URL for the session.

Required:

1. `--session`

Optional:

1. `--launch` (currently prints guidance; does not auto-open browser)

### `deregister wait`

Waits for callback and/or on-chain deregistration.

Required:

1. `--session`

Optional:

1. `--open` (prints handoff URL at start)
2. `--timeout-seconds`
3. `--poll-ms`
4. `--no-listener` (poll chain only)

### `deregister status`

Reads current session state.

Required:

1. `--session`

## Session schema (v1)

Top-level:

1. `version`
2. `operation` (`register` or `deregister`)
3. `sessionId`
4. `createdAt`
5. `expiresAt`
6. `mode`
7. `disclosures`
8. `network`
9. `registration`
10. `callback`
11. `state`
12. `secrets` (optional; registration-generated-key modes only)

`network`:

1. `chainId`
2. `rpcUrl`
3. `registryAddress`
4. `endpointType`
5. `appUrl`
6. `appName`
7. `scope`

`registration`:

1. `humanIdentifier`
2. `agentAddress`
3. `userDefinedData` (except smart-wallet template pre-step)
4. `challengeHash` (non-verified-wallet modes)
5. `signature` (non-verified-wallet modes)
6. `smartWalletTemplate` (smart-wallet mode only before browser passkey step)

`callback`:

1. `listenHost` (`127.0.0.1`)
2. `listenPort`
3. `path` (`/callback`)
4. `stateToken`
5. `used`
6. optional `lastStatus`, `lastError`

`state`:

1. `stage`:
   `initialized`, `handoff_opened`, `callback_received`, `onchain_verified`, `onchain_deregistered`, `failed`, `expired`
2. `updatedAt`
3. optional `lastError`, `agentId`, `guardianAddress`

`secrets`:

1. `agentPrivateKey` (generated modes only)

## Browser handoff payload

CLI encodes payload in `payload=<base64url(json)>` for `/cli/register`.

Required fields:

1. `version`
2. `operation` (`register` or `deregister`)
3. `sessionId`
4. `stateToken`
5. `callbackUrl`
6. `mode`
7. `chainId`
8. `registryAddress`
9. `endpointType`
10. `appName`
11. `scope`
12. `humanIdentifier`
13. `expectedAgentAddress`
14. `expiresAt`

Optional:

1. `disclosures`
2. `userDefinedData`
3. `smartWalletTemplate`

## Callback payload contract

Browser posts JSON to local callback URL:

1. `sessionId`
2. `stateToken`
3. `status` (`success` or `error`)
4. `timestamp`
5. optional `operation`
6. optional `error`
7. optional `guardianAddress`

CLI must reject mismatched `sessionId` / `stateToken` and replay callbacks.

## Proof expiry considerations

Human proofs set `proofExpiresAt = min(passport_document_expiry, block.timestamp + maxProofAge)` at registration time (`maxProofAge` defaults to 365 days). After expiry, `isProofFresh(agentId)` returns `false`.

To refresh an expired proof, the CLI user must run the full deregister flow followed by a new register flow. This produces a new agentId. There is no in-place refresh or renewal command.

CLIs should surface `proofExpiresAt` in `register status` output and warn when expiry is within 30 days.

## Security requirements

1. Export of agent private key is blocked unless `--unsafe` is explicit.
2. Session and key files must use restricted file permissions.
3. Callback listener binds to loopback host only.
4. Session expiry is enforced before handoff/wait operations.
