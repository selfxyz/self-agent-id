# Registration Modes — Detailed Reference

Self Agent ID supports four registration modes, each encoding a different relationship between the human, the agent keypair, and the on-chain identity. All modes produce the same output: a soulbound ERC-721 NFT with ZK-attested credentials. The modes differ in how the agent key is derived, who owns the NFT, and what the `userDefinedData` field contains.

## userDefinedData Overview

Every registration mode encodes its parameters in the `userDefinedData` field, which flows through Self Hub V2 to the registry's `customVerificationHook()`. The field follows this general layout:

```
Position [0]:  Action byte (ASCII character)
Position [1]:  Config index ('0' through '5', ASCII)
Position [2+]: Mode-specific payload
```

**Critical:** The Self SDK passes `userDefinedData` as a UTF-8 string, NOT raw bytes. The registry converts it to bytes on-chain using `bytes(userDefinedData)`. All hex values in the payload are ASCII hex characters (e.g., an address `0xABCD...` is encoded as the 40 ASCII characters `"ABCD..."`, not 20 raw bytes). This encoding doubles the byte count for any hex-encoded field.

---

## verified-wallet Mode

**Action byte:** `R` (0x52)

The simplest registration path. The human's own wallet address becomes the agent key. No separate keypair is generated — the human IS the agent.

### Agent Key Derivation

```solidity
bytes32 agentKey = bytes32(uint256(uint160(humanWalletAddress)));
```

The human's wallet address is zero-padded to 32 bytes (address in the low-order 20 bytes). This is the same address that the Self app uses as the `userIdentifier` during proof submission.

### userDefinedData Format

```
Position [0]: 'R' (0x52) — simple register action
Position [1]: Config digit ('0'-'5')
```

**Total length:** 2 characters

Example: `"R3"` — simple register with config 3 (age 18+ and OFAC check).

### NFT Ownership

The soulbound NFT is minted to the human's wallet address. The human directly owns and controls the agent identity.

### Characteristics

| Property           | Value                               |
| ------------------ | ----------------------------------- |
| Agent key source   | Human's wallet address              |
| NFT owner          | Human's wallet                      |
| Keypair management | None — uses human's existing wallet |
| Guardian           | Not applicable                      |
| Gas payment        | Human pays gas directly             |

### When to Use

- Personal agents where the human directly operates the AI agent
- Prototyping and development — fastest path to a registered identity
- Single-agent setups where wallet exposure is acceptable

### Limitations

- The human's wallet address is publicly linked to the agent identity on-chain
- The human must sign all agent HTTP requests using their wallet's private key
- Cannot have multiple independent agents under the same wallet (each wallet maps to one agent key)
- No separation between human identity and agent operations

---

## agent-identity Mode (Recommended)

**Action byte:** `K` (0x4B)

The recommended mode for production agents. The agent generates its own ECDSA keypair, separate from the human's wallet. The agent signs a challenge to prove ownership of the keypair, and the ECDSA signature is verified on-chain by the registry.

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

The signature covers a challenge derived from the registration parameters. The registry recovers the signer address from the signature and verifies it matches the agent address at positions [2-41]. If the recovered address does not match, the transaction reverts with `InvalidAgentSignature()`.

### NFT Ownership

The soulbound NFT is minted to the human's wallet address (the `userIdentifier` from the Hub V2 callback). The human owns the NFT but the agent has its own keypair for signing requests.

### Characteristics

| Property              | Value                                                                |
| --------------------- | -------------------------------------------------------------------- |
| Agent key source      | Agent's own ECDSA keypair                                            |
| NFT owner             | Human's wallet                                                       |
| Keypair management    | Agent generates and stores private key                               |
| Guardian              | Not applicable (human can deregister via NFT ownership)              |
| Gas payment           | Human pays gas for registration; agent signs HTTP requests off-chain |
| On-chain verification | ECDSA recovery verifies agent keypair ownership                      |

### When to Use

- Production AI agents that need their own signing identity
- Multi-agent setups where each agent needs an independent keypair
- Services where the human's wallet should not be exposed in API calls
- Any scenario requiring separation between the human identity and agent operations

### Security Notes

- The agent's private key must be stored securely (environment variable, secrets manager)
- The private key is generated once and cannot be recovered if lost
- Losing the key requires deregistration (by the NFT owner) and fresh registration with a new keypair
- The human retains ultimate control via NFT ownership — they can call `selfDeregister()` at any time

---

## wallet-free Mode

**Action byte:** `W` (0x57)

Designed for scenarios where the human does not have or does not want to use a crypto wallet. The agent generates its own keypair, and a guardian address (typically controlled by the Self app) is designated as a safety mechanism.

### Agent Key Derivation

```solidity
bytes32 agentKey = bytes32(uint256(uint160(agentAddress)));
```

Same derivation as agent-identity mode — the agent has its own address.

### userDefinedData Format

```
Position [0]:     'W' (0x57) — wallet-free register action
Position [1]:     Config digit ('0'-'5')
Position [2-41]:  Agent address (40 hex ASCII characters)
Position [42-81]: Guardian address (40 hex ASCII characters)
Position [82-145]: ECDSA signature r-value (64 hex ASCII characters)
Position [146-209]: ECDSA signature s-value (64 hex ASCII characters)
Position [210-211]: ECDSA signature v-value (2 hex ASCII characters)
```

**Total length:** 212 characters

The guardian address at positions [42-81] is stored on-chain and has the authority to call `guardianRevoke()` if the agent's key is compromised.

### NFT Ownership

The soulbound NFT is minted to the **agent's address**, not the human's wallet. The agent is the NFT owner, and the guardian serves as the revocation authority.

### Characteristics

| Property           | Value                                                                |
| ------------------ | -------------------------------------------------------------------- |
| Agent key source   | Agent's own ECDSA keypair                                            |
| NFT owner          | Agent's address                                                      |
| Keypair management | Agent generates and stores private key                               |
| Guardian           | Designated address (e.g., Self app) with revocation authority        |
| Gas payment        | Agent pays gas or uses a relayer                                     |
| Revocation         | Guardian calls `guardianRevoke()`, or agent calls `selfDeregister()` |

### When to Use

- Agents for users who have no crypto wallet and do not want to manage one
- Agents managed entirely through the Self mobile app
- Scenarios where a trusted third party (the guardian) should have emergency revocation authority

### Guardian Revocation

If the agent's private key is compromised, the guardian can force-revoke the identity:

```solidity
registry.guardianRevoke(agentId);
```

This revokes the human proof, clears all credentials, and burns the soulbound NFT. The agent must re-register to obtain a new identity.

### Limitations

- The guardian has unilateral revocation power — choose the guardian carefully
- If the guardian address itself is compromised, there is no recovery mechanism beyond re-registration
- Gas costs fall on the agent (or a relayer) since there is no human wallet in the loop

---

## smart-wallet Mode

**Action byte:** Uses the same underlying mechanics as agent-identity mode, but wrapped in a smart account.

The most user-friendly mode, using WebAuthn passkeys instead of traditional ECDSA private keys. Built on ZeroDev Kernel smart accounts with Pimlico as the bundler and paymaster. On mainnet, the paymaster covers all gas costs, making the experience completely gasless for the user.

### Architecture

```
Human (passkey / biometric)
    │
    ▼
WebAuthn authentication (browser / device)
    │
    ▼
ZeroDev Kernel smart account
    │
    ▼
Pimlico bundler → submits UserOperation to Celo
    │
    ▼
Pimlico paymaster → sponsors gas (mainnet only)
```

### Key Components

| Component      | Details                                                    |
| -------------- | ---------------------------------------------------------- |
| Smart account  | ZeroDev Kernel v3 (ERC-4337 compatible)                    |
| Bundler        | Pimlico (`https://api.pimlico.io/v2/{chainId}/rpc`)        |
| Paymaster      | Pimlico (mainnet gasless sponsorship)                      |
| Passkey server | `https://passkeys.zerodev.app/api/v3/{projectId}` (NOT v4) |
| Authentication | WebAuthn (FIDO2) — fingerprint, face, or security key      |

### Characteristics

| Property         | Value                                                          |
| ---------------- | -------------------------------------------------------------- |
| Agent key source | Smart account address (derived from passkey)                   |
| NFT owner        | Smart account                                                  |
| Key management   | Passkey stored by browser/OS — no seed phrase                  |
| Guardian         | Smart account can designate a guardian                         |
| Gas payment      | Paymaster on mainnet (gasless); counterfactual only on testnet |

### When to Use

- Consumer-facing applications where UX is the top priority
- Agents for non-technical users who should never see a seed phrase or private key
- Mainnet deployments where gasless transactions improve onboarding conversion

### Network Differences

| Behavior                 | Testnet (Celo Sepolia) | Mainnet (Celo)                  |
| ------------------------ | ---------------------- | ------------------------------- |
| Smart account deployment | Counterfactual only    | Deployed by first UserOperation |
| Gas sponsorship          | Not available          | Pimlico paymaster covers gas    |
| Passkey registration     | Works (for testing)    | Works (production)              |

### WebAuthn Requirements

WebAuthn passkey authentication has specific browser requirements:

- **HTTPS** is required in production
- **Chrome** supports WebAuthn on `http://localhost` for development
- **Firefox** blocks WebAuthn on `http://localhost` — use Chrome for local development
- **Safari** supports WebAuthn but may require additional permissions
- **Mobile browsers** support WebAuthn via platform authenticators (fingerprint, face)

### Limitations

- Most complex setup — requires ZeroDev project ID, Pimlico API key, and passkey server configuration
- Testnet mode is counterfactual only (smart account not actually deployed, no gasless sponsorship)
- Passkey recovery depends on the browser/OS passkey sync mechanism (iCloud Keychain, Google Password Manager, etc.)
- Debugging is harder due to the additional abstraction layers (UserOperation, bundler, paymaster)

---

## Decision Tree

```
Start
  │
  ├─ Need the simplest possible setup?
  │   └─ YES → verified-wallet
  │
  ├─ Building a production agent with its own keypair?
  │   └─ YES → agent-identity
  │
  ├─ Human has no crypto wallet?
  │   └─ YES → wallet-free
  │
  ├─ Want the best UX with passkeys and gasless transactions?
  │   └─ YES → smart-wallet
  │
  └─ Not sure?
      └─ agent-identity (default recommendation)
```

**General guidance:** Start with agent-identity mode unless there is a specific reason to use another mode. It provides the best balance of security, flexibility, and simplicity for most production use cases.

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

Agents can be deregistered through two mechanisms, depending on the registration mode.

### Simple Deregister (Action `D`)

For verified-wallet mode agents. The same human who registered initiates deregistration through the Self app. The `userDefinedData` format:

```
Position [0]: 'D' (0x44)
Position [1]: Config digit
```

**Total length:** 2 characters

### Advanced Deregister (Action `X`)

For agent-identity and wallet-free mode agents. Includes the agent address to identify which agent to deregister:

```
Position [0]:    'X' (0x58)
Position [1]:    Config digit
Position [2-41]: Agent address (40 hex ASCII characters)
```

**Total length:** 42 characters

### Direct Deregistration

The NFT owner can also call `selfDeregister(agentId)` directly on the registry contract, bypassing the Hub V2 flow entirely. This is the simplest deregistration path for agents registered in agent-identity or wallet-free modes.

### Guardian Revocation

For agents with a designated guardian (wallet-free and smart-wallet modes), the guardian can call `guardianRevoke(agentId)` to force-revoke the agent identity. This is an emergency mechanism for compromised agents.

---

## API Base URL

All REST API calls for registration use the base URL:

```
https://self-agent-id.vercel.app
```

Override by setting the `SELF_AGENT_API_BASE` environment variable. The previous `selfagentid.xyz` domain is retired — use the Vercel URL.

### Registration Endpoints

| Method | Path                                 | Description                  |
| ------ | ------------------------------------ | ---------------------------- |
| `POST` | `/api/agent/register`                | Start a registration session |
| `GET`  | `/api/agent/register/status?token=X` | Poll registration status     |
| `GET`  | `/api/agent/register/qr?token=X`     | Get QR code for Self app     |
| `POST` | `/api/agent/register/callback`       | Hub V2 callback (internal)   |

### Deregistration Endpoints

| Method | Path                                   | Description                    |
| ------ | -------------------------------------- | ------------------------------ |
| `POST` | `/api/agent/deregister`                | Start a deregistration session |
| `GET`  | `/api/agent/deregister/status?token=X` | Poll deregistration status     |
| `POST` | `/api/agent/deregister/callback`       | Hub V2 callback (internal)     |

---

## Contract Addresses

| Contract               | Mainnet (42220)                              | Testnet (11142220)                           |
| ---------------------- | -------------------------------------------- | -------------------------------------------- |
| SelfAgentRegistry      | `0xaC3DF9ABf80d0F5c020C06B04Cced27763355944` | `0x043DaCac8b0771DD5b444bCC88f2f8BBDBEdd379` |
| SelfHumanProofProvider | `0x4b036aFD959B457A208F676cf44Ea3ef73Ea3E3d` | `0x5E61c3051Bf4115F90AacEAE6212bc419f8aBB6c` |
| Hub V2                 | `0xe57F4773bd9c9d8b6Cd70431117d353298B9f5BF` | `0x16ECBA51e18a4a7e61fdC417f0d47AFEeDfbed74` |
