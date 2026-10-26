# Registration Modes — Detailed Reference

Self Agent ID supports six registration modes through `POST /api/agent/register`: `linked`, `wallet-free`, `privy`, `smartwallet`, `ed25519` and `ed25519-linked` (the server also accepts the legacy spellings `walletfree` → `wallet-free` and `smart-wallet` → `smartwallet`). All modes produce the same output: a soulbound ERC-721 NFT with ZK-attested credentials. The modes differ in how the agent key is derived, who owns the NFT, and what the `userDefinedData` field contains.

On-chain, the registry understands four registration actions (plus `F` refresh and `I` identify). The API modes map onto them like this:

| API mode                         | On-chain action            | Agent key                                            |
| -------------------------------- | -------------------------- | ---------------------------------------------------- |
| `linked`, `privy`, `smartwallet` | `K` — advanced register    | Server-generated ECDSA key, linked to `humanAddress` |
| `wallet-free`                    | `W` — wallet-free register | Server-generated ECDSA key that owns its NFT         |
| `ed25519`, `ed25519-linked`      | `E` — Ed25519 register     | Agent's own Ed25519 public key                       |
| (not offered by the API)         | `R` — simple register      | The human's own wallet address                       |

`privy` and `smartwallet` differ from `linked` only in where the human's wallet address comes from (a Privy embedded wallet or a passkey smart wallet). The server treats all three identically: it generates the agent key, binds it to `humanAddress`, and the key is exported after completion. No bundler, paymaster or smart-account transaction is involved.

## userDefinedData Overview

Every registration mode encodes its parameters in the `userDefinedData` field, which flows through Self Hub V2 to the registry's `customVerificationHook()`. The field follows this general layout:

```
Position [0]:  Action byte (ASCII character)
Position [1]:  Config index ('0' through '5', ASCII)
Position [2+]: Mode-specific payload
```

**Critical:** The Self SDK passes `userDefinedData` as a UTF-8 string, NOT raw bytes. The registry converts it to bytes on-chain using `bytes(userDefinedData)`. All hex values in the payload are ASCII hex characters (e.g., an address `0xABCD...` is encoded as the 40 ASCII characters `"ABCD..."`, not 20 raw bytes). This encoding doubles the byte count for any hex-encoded field.

---

## Simple Register (Action `R`) — human wallet as the agent

**Action byte:** `R` (0x52)

The human's own wallet address becomes the agent key. No separate keypair is generated — the human IS the agent. The hosted API does not offer this action as a mode; it is listed here because the registry supports it and the SDK exports `buildSimpleRegisterUserDataAscii()`.

### Agent Key Derivation

```solidity
bytes32 agentKey = bytes32(uint256(uint160(humanWalletAddress)));
```

### userDefinedData Format

```
Position [0]: 'R' (0x52) — simple register action
Position [1]: Config digit ('0'-'5')
```

**Total length:** 2 characters. Example: `"R4"` — simple register with config 4 (age 18+ and OFAC check).

The soulbound NFT is minted to the human's wallet address. The human must sign all agent HTTP requests with that wallet's key, so there is no separation between the human and the agent.

---

## linked Mode (Recommended for ECDSA) — also `privy` and `smartwallet`

**Action byte:** `K` (0x4B)

The server generates a fresh ECDSA keypair for the agent, separate from the human's wallet, signs the registration challenge with it, and embeds the signature in the QR code. The registry verifies the ECDSA signature on-chain.

### Agent Key Derivation

```solidity
bytes32 agentKey = bytes32(uint256(uint160(agentAddress)));
```

The `agentAddress` is derived from the agent's own public key — a completely separate address from the human's wallet.

### userDefinedData Format

```
Position [0]:     'K' (0x4B) — advanced register action
Position [1]:     Config digit ('0'-'5')
Position [2-41]:  Agent address (40 hex ASCII characters, no 0x prefix)
Position [42-105]: ECDSA signature r-value (64 hex ASCII characters)
Position [106-169]: ECDSA signature s-value (64 hex ASCII characters)
Position [170-171]: ECDSA signature v-value (2 hex ASCII characters)
```

**Total length:** 172 characters

The signature covers `keccak256("self-agent-id:register:" + humanAddress + chainId + registryAddress + nonce)`. The registry recovers the signer address and verifies it matches the agent address at positions [2-41]; otherwise the proof reverts with `InvalidAgentSignature()`.

### NFT Ownership

The soulbound NFT is minted to the human's wallet address (`humanAddress`, which the Self app uses as the `userIdentifier`). The human owns the NFT; the agent has its own keypair for signing requests.

### Characteristics

| Property              | Value                                                                             |
| --------------------- | --------------------------------------------------------------------------------- |
| Agent key source      | Server-generated ECDSA keypair                                                    |
| NFT owner             | Human's wallet (`humanAddress`)                                                   |
| Key delivery          | `POST /api/agent/register/export` (Bearer token), within 30 minutes of completion |
| Guardian              | Not applicable (the human deregisters via NFT ownership)                          |
| Gas payment           | None for the agent; the Self app relays the proof                                 |
| On-chain verification | ECDSA recovery verifies agent keypair ownership                                   |

### When to Use

- Production AI agents that need their own signing identity, owned by a human wallet
- `privy`: the human signed in with email/social login and has a Privy embedded wallet
- `smartwallet`: the human's wallet is a passkey smart wallet (its address is just passed as `humanAddress`)

### Security Notes

- Export the private key before the session expires and store it securely (environment variable, secrets manager). It cannot be recovered afterwards.
- Losing the key requires deregistration and a fresh registration.
- The human retains control via NFT ownership — they can call `selfDeregister()` from their wallet at any time.

---

## wallet-free Mode

**Action byte:** `W` (0x57)

For humans who do not have or do not want to use a crypto wallet. The server generates the agent's keypair, and the agent address owns its own NFT.

### Agent Key Derivation

```solidity
bytes32 agentKey = bytes32(uint256(uint160(agentAddress)));
```

### userDefinedData Format

```
Position [0]:     'W' (0x57) — wallet-free register action
Position [1]:     Config digit ('0'-'5')
Position [2-41]:  Agent address (40 hex ASCII characters)
Position [42-81]: Guardian address (40 hex ASCII characters; all zeros = no guardian)
Position [82-145]: ECDSA signature r-value (64 hex ASCII characters)
Position [146-209]: ECDSA signature s-value (64 hex ASCII characters)
Position [210-211]: ECDSA signature v-value (2 hex ASCII characters)
```

**Total length:** 212 characters

The hosted API always sends a zero guardian for `wallet-free`. A non-zero guardian (set when building `userDefinedData` yourself with `buildWalletFreeRegisterUserDataAscii({ guardianAddress })`) is stored on-chain and may call `guardianRevoke()`.

### Characteristics

| Property         | Value                                                                                                          |
| ---------------- | -------------------------------------------------------------------------------------------------------------- |
| Agent key source | Server-generated ECDSA keypair (CLI: generated locally)                                                        |
| NFT owner        | Agent's address                                                                                                |
| Key delivery     | Export endpoint (API) or the session file (CLI)                                                                |
| Guardian         | None via the API; optional when building userDefinedData yourself                                              |
| Revocation       | Deregister via the Self app (action `D`), agent calls `selfDeregister()`, or guardian calls `guardianRevoke()` |

### When to Use

- Quick starts and agents for users who have no crypto wallet
- Embedded agents, CLI-only workflows

---

## ed25519 and ed25519-linked Modes

**Action byte:** `E` (0x45)

For agents that already have an Ed25519 key (OpenClaw, Eliza/Solana, SSH-style keys). The agent keeps its own key; the server never sees it.

### Flow

1. `POST /api/agent/register/ed25519-challenge` with `{ "pubkey": "<64 hex>", "network": "testnet", "humanAddress": "0x..." }` (`humanAddress` only for `ed25519-linked`) → `{ challengeHash, nonce }`.
2. The agent signs the raw 32 bytes of `challengeHash` with its Ed25519 key.
3. `POST /api/agent/register` with `mode`, `network`, `ed25519Pubkey` (64 hex) and `ed25519Signature` (128 hex), plus `humanAddress` for `ed25519-linked`.

### Agent Key and Ownership

- Agent key: the raw 32-byte Ed25519 public key.
- NFT owner: an address derived from the public key (`address(uint160(uint256(keccak256(pubkey))))`).
- `ed25519-linked`: the human's wallet is stored as the **guardian** and can call `guardianRevoke(agentId)`.
- `ed25519`: no guardian.

### userDefinedData Format

```
Position [0]:       'E' (0x45)
Position [1]:       Config digit ('0'-'5')
Position [2-65]:    Ed25519 public key (64 hex)
Position [66-193]:  Ed25519 signature R‖S (128 hex)
Position [194-513]: Extended public key data for on-chain verification (5 × 64 hex)
Position [514-553]: Guardian address (40 hex; zeros for ed25519)
```

**Total length:** 554 characters

### Limitations

- Ed25519 agents cannot be deregistered through `POST /api/agent/deregister` (400). Use `guardianRevoke(agentId)` from the guardian wallet (`ed25519-linked`).
- There is no key to export (`/api/agent/register/export` returns 400 for these modes).

---

## Decision Tree

```
Start
  │
  ├─ Agent already has an Ed25519 key?
  │   ├─ Human wants wallet-based revocation → ed25519-linked
  │   └─ Otherwise → ed25519
  │
  ├─ Human has no crypto wallet?
  │   └─ YES → wallet-free
  │
  ├─ Human has a wallet?
  │   ├─ Privy embedded wallet → privy
  │   ├─ Passkey smart wallet  → smartwallet
  │   └─ Any other wallet      → linked
  │
  └─ Not sure?
      └─ linked (default recommendation)
```

**General guidance:** Start with `linked` unless there is a specific reason to use another mode. It gives the agent its own key while the human's wallet keeps ownership. The CLI supports only `linked` and `wallet-free`.

---

## Config Digit Mapping

The config digit at `userDefinedData[1]` selects one of 6 verification configs registered with Hub V2 at deployment time. Each config defines an age threshold and OFAC screening combination.

| Digit | Age Requirement | OFAC Check | Description                                       |
| ----- | --------------- | ---------- | ------------------------------------------------- |
| `'0'` | None            | No         | Minimum verification — data disclosures only      |
| `'1'` | 18+             | No         | Age-gated (18+), no sanctions check               |
| `'2'` | 21+             | No         | Age-gated (21+), no sanctions check               |
| `'3'` | None            | Yes        | OFAC sanctions screening, no age gate             |
| `'4'` | 18+             | Yes        | Age 18+ with OFAC — most common for production    |
| `'5'` | 21+             | Yes        | Strictest — age 21+ with OFAC sanctions screening |

The digit is an ASCII character (`'0'` = 0x30, `'5'` = 0x35), not a raw byte value. The registry's `_parseConfigIndex()` function accepts both ASCII (`0x30-0x35`) and raw (`0x00-0x05`) encodings, but the Self SDK always sends ASCII.

### Config Selection Guidance

- **Development/testing:** Use config `'0'` to avoid age and OFAC requirements during development.
- **General production:** Use config `'4'` (age 18+ with OFAC) as the baseline for most services.
- **US-regulated services:** Use config `'5'` for 21+ age requirements with OFAC (alcohol, gambling).
- **Global non-age-gated:** Use config `'3'` for OFAC compliance without age restrictions.

---

## Deregistration

`POST /api/agent/deregister` with `{ "network": "testnet", "agentAddress": "0x..." }` (or `agentId`) starts a deregistration session; the human scans the QR code with the Self app. The server picks the action from the NFT owner:

### Simple Deregister (Action `D`)

Used when the agent owns its own NFT (`wallet-free`, or the simple `R` registration). The Self app's user identifier is the agent address.

```
Position [0]: 'D' (0x44)
Position [1]: Config digit
```

**Total length:** 2 characters

### Advanced Deregister (Action `X`)

Used when a human wallet owns the NFT (`linked`, `privy`, `smartwallet`). Includes the agent address to identify which agent to deregister:

```
Position [0]:    'X' (0x58)
Position [1]:    Config digit
Position [2-41]: Agent address (40 hex ASCII characters)
```

**Total length:** 42 characters

### Direct Deregistration

The NFT owner can also call `selfDeregister(agentId)` directly on the registry contract, bypassing the Hub V2 flow entirely.

### Guardian Revocation

For agents with a guardian (`ed25519-linked`, or a `wallet-free` registration built with a guardian), the guardian can call `guardianRevoke(agentId)` to force-revoke the agent identity. This is an emergency mechanism for compromised agents.

---

## API Base URL

All REST API calls for registration use the base URL:

```
https://agent-api.self.xyz
```

The SDK honours the `SELF_AGENT_API_BASE` environment variable as an override.

Session tokens are sent only as `Authorization: Bearer <sessionToken>`, never in the query string. Every status response returns a rotated `sessionToken`; use the newest one for the next call.

### Registration Endpoints

| Method | Path                                    | Description                                                 |
| ------ | --------------------------------------- | ----------------------------------------------------------- |
| `POST` | `/api/agent/register`                   | Start a registration session                                |
| `GET`  | `/api/agent/register/status`            | Poll registration status (Bearer)                           |
| `GET`  | `/api/agent/register/qr`                | QR data, deep link and `scanUrl` (Bearer)                   |
| `POST` | `/api/agent/register/export`            | Export the generated private key after completion (Bearer)  |
| `POST` | `/api/agent/register/ed25519-challenge` | Challenge for Ed25519 modes                                 |
| `GET`  | `/api/qr/{qrToken}`                     | PNG QR code (the `scanUrl` from any session-start response) |

### Deregistration and Refresh Endpoints

| Method | Path                           | Description                         |
| ------ | ------------------------------ | ----------------------------------- |
| `POST` | `/api/agent/deregister`        | Start a deregistration session      |
| `GET`  | `/api/agent/deregister/status` | Poll deregistration status (Bearer) |
| `POST` | `/api/agent/refresh`           | Start an in-place proof refresh     |
| `GET`  | `/api/agent/refresh/status`    | Poll proof refresh status (Bearer)  |

Registration and deregistration stages are `qr-ready` → `completed`, or `expired` once the session times out (status endpoints return 410). Completion is read from the chain; there are no callback endpoints.

---

## Contract Addresses

| Contract               | Mainnet (42220)                              | Testnet (11142220)                           |
| ---------------------- | -------------------------------------------- | -------------------------------------------- |
| SelfAgentRegistry      | `0xaC3DF9ABf80d0F5c020C06B04Cced27763355944` | `0x043DaCac8b0771DD5b444bCC88f2f8BBDBEdd379` |
| SelfHumanProofProvider | `0x4b036aFD959B457A208F676cf44Ea3ef73Ea3E3d` | `0x5E61c3051Bf4115F90AacEAE6212bc419f8aBB6c` |
| Hub V2                 | `0xe57F4773bd9c9d8b6Cd70431117d353298B9f5BF` | `0x16ECBA51e18a4a7e61fdC417f0d47AFEeDfbed74` |
