# Self Agent ID — Contract Reference

## Contract Addresses

| Contract               | Mainnet (42220)                              | Testnet (11142220)                           |
| ---------------------- | -------------------------------------------- | -------------------------------------------- |
| SelfAgentRegistry      | `0xaC3DF9ABf80d0F5c020C06B04Cced27763355944` | `0x043DaCac8b0771DD5b444bCC88f2f8BBDBEdd379` |
| SelfHumanProofProvider | `0x4b036aFD959B457A208F676cf44Ea3ef73Ea3E3d` | `0x5E61c3051Bf4115F90AacEAE6212bc419f8aBB6c` |
| SelfReputationRegistry | `0x69Da18CF4Ac27121FD99cEB06e38c3DC78F363f4` | `0x3Bb0A898C1C0918763afC22ff624131b8F420CC2` |
| SelfValidationRegistry | `0x71a025e0e338EAbcB45154F8b8CA50b41e7A0577` | `0x84cA20B8A1559F136dA03913dbe6A7F68B6B240B` |
| Hub V2 (Self Protocol) | `0xe57F4773bd9c9d8b6Cd70431117d353298B9f5BF` | `0x16ECBA51e18a4a7e61fdC417f0d47AFEeDfbed74` |
| Celo Agent Visa        | `0xCa97f7586CF9De62B8ca516d7Ee25f6AEae5e109` | `0xf049FD6260Fce964B82728A86CF1BbEB8AB3E875` |
| SelfReputationSignal   | not deployed                                 | not deployed                                 |
| SelfFreshnessChecker   | not deployed                                 | not deployed                                 |

The reputation and validation registries are UUPS proxies (addresses above are the proxies). `SelfReputationSignal` and `SelfFreshnessChecker` are stateless view wrappers in `contracts/src` with no canonical deployment — deploy your own pointing at the registry, or read the registry directly (see [Integration Patterns](#integration-patterns-solidity)).

## SelfAgentRegistry

ERC-721 identity registry with soulbound NFTs. Token name: "Self Agent ID", symbol: "SAID".

### Registration Functions

#### registerWithHumanProof

```solidity
function registerWithHumanProof(
    string calldata agentURI,
    address proofProvider,
    bytes calldata proof,
    bytes calldata providerData
) external returns (uint256 agentId);
```

ERC-8004 standard registration entry point. For Self Protocol, this path is not used directly (Hub V2 uses async callbacks). Other providers implementing synchronous `verifyHumanProof()` can use this path. The `providerData` must contain the agent key in the first 32 bytes.

#### verifySelfProof (inherited from SelfVerificationRoot)

```solidity
function verifySelfProof(
    SelfStructs.ProofPayload calldata proofPayload,
    bytes calldata userContextData
) external;
```

The primary registration entry point for Self Protocol. Submits the ZK proof to Hub V2, which verifies it and calls back into `customVerificationHook()`. The `userContextData` encodes destination chain ID, user identifier, and user-defined data (action byte + config index + payload).

### Query Functions

#### isVerifiedAgent

```solidity
function isVerifiedAgent(bytes32 agentKey) external view returns (bool);
```

Check if an agent key maps to a registered agent with a human proof. Returns `false` if the agent key is unregistered or the proof has been revoked. It does **not** check expiry — combine it with `isProofFresh(agentId)` (the API's `isVerified` is `hasHumanProof && isProofFresh`).

#### getAgentId

```solidity
function getAgentId(bytes32 agentKey) external view returns (uint256);
```

Resolve an agent key to its agent ID. Returns 0 if not registered. The agent key is derived from the agent's address: `bytes32(uint256(uint160(agentAddress)))`.

#### getProofProvider

```solidity
function getProofProvider(uint256 agentId) external view returns (address);
```

Get the address of the proof provider that verified a specific agent. Returns `address(0)` if no proof exists. To verify the provider is Self Protocol, compare the returned address against the known `SelfHumanProofProvider` address.

#### getAgentCredentials

```solidity
function getAgentCredentials(uint256 agentId) external view returns (AgentCredentials memory);
```

Returns the full ZK-attested credential struct for an agent:

```solidity
struct AgentCredentials {
    string issuingState;     // ISO 3166-1 alpha-3 country code
    string[] name;           // Name components (if disclosed)
    string idNumber;         // Document number (if disclosed)
    string nationality;      // ISO 3166-1 alpha-3 nationality
    string dateOfBirth;      // YYMMDD format (if disclosed)
    string gender;           // "M", "F", or other (if disclosed)
    string expiryDate;       // YYMMDD format (if disclosed)
    uint256 olderThan;       // Age threshold verified (0, 18, or 21)
    bool[3] ofac;            // OFAC screening results [SDN, nonSDN, consolidated]
}
```

Empty string fields indicate the attribute was not disclosed at registration time.

#### getAgentMetadata

```solidity
function getAgentMetadata(uint256 agentId) external view returns (string memory);
```

Returns the delegated credential metadata JSON string. This is user-defined metadata set by the NFT owner, separate from the ZK-attested credentials. Returns empty string if none set.

### Sybil Resistance Functions

#### getAgentCountForHuman

```solidity
function getAgentCountForHuman(uint256 nullifier) external view returns (uint256);
```

Returns the number of currently active agents associated with a given human nullifier. The registry enforces `maxAgentsPerHuman` (default: 1) at registration time.

#### getHumanNullifier

```solidity
function getHumanNullifier(uint256 agentId) external view returns (uint256);
```

Returns the scoped nullifier for an agent. The nullifier is deterministic: the same human scanning the same passport against the same registry scope always produces the same value.

#### sameHuman

```solidity
function sameHuman(uint256 agentIdA, uint256 agentIdB) external view returns (bool);
```

Check if two agents are controlled by the same human. Returns `true` if both agents have active human proofs and share the same non-zero nullifier. Returns `false` if either agent lacks a proof.

### Management Functions

#### updateAgentMetadata

```solidity
function updateAgentMetadata(uint256 agentId, string calldata metadata) external;
```

Update the delegated credential metadata for an agent. Only callable by the current NFT owner. The metadata is a free-form JSON string stored on-chain.

#### selfDeregister

```solidity
function selfDeregister(uint256 agentId) external;
```

Deregister an agent. Only callable by the current NFT owner (`ownerOf(agentId)`). Revokes the human proof, clears all mappings and credentials, and burns the NFT.

#### guardianRevoke

```solidity
function guardianRevoke(uint256 agentId) external;
```

Force-revoke a compromised agent. Only callable by the agent's designated guardian (set during wallet-free registration). Performs the same cleanup as `selfDeregister`.

### Admin Functions (Role-Gated)

| Function                         | Role              | Description                                    |
| -------------------------------- | ----------------- | ---------------------------------------------- |
| `setSelfProofProvider(address)`  | `SECURITY_ROLE`   | Set the Self Protocol proof provider address   |
| `addProofProvider(address)`      | `SECURITY_ROLE`   | Whitelist a new proof provider                 |
| `removeProofProvider(address)`   | `SECURITY_ROLE`   | Remove a provider from the whitelist           |
| `setRequireHumanProof(bool)`     | `SECURITY_ROLE`   | Block plain `register()` (default `true`)      |
| `setMaxAgentsPerHuman(uint256)`  | `OPERATIONS_ROLE` | Set the sybil limit (0 = unlimited; default 1) |
| `setMaxProofAge(uint256)`        | `OPERATIONS_ROLE` | Proof validity in seconds (default `365 days`) |
| `setReputationRegistry(address)` | `OPERATIONS_ROLE` | Link the reputation registry (`0` disables)    |
| `setValidationRegistry(address)` | `OPERATIONS_ROLE` | Link the validation registry (`0` unlinks)     |

### Events

| Event                           | Parameters                                                |
| ------------------------------- | --------------------------------------------------------- |
| `AgentRegisteredWithHumanProof` | `agentId, proofProvider, nullifier, verificationStrength` |
| `HumanProofRevoked`             | `agentId, nullifier`                                      |
| `ProofProviderAdded`            | `provider, name`                                          |
| `ProofProviderRemoved`          | `provider`                                                |
| `GuardianSet`                   | `agentId, guardian`                                       |
| `AgentMetadataUpdated`          | `agentId`                                                 |
| `AgentCredentialsStored`        | `agentId`                                                 |
| `MaxAgentsPerHumanUpdated`      | `newMax`                                                  |
| `MaxProofAgeUpdated`            | `newMaxProofAge`                                          |
| `HumanProofRefreshed`           | `agentId, nullifier, newExpiresAt, configId`              |
| `NullifierIdentified`           | `nullifier, agentCount`                                   |

## SelfHumanProofProvider

Lightweight metadata wrapper for Self Protocol as a proof-of-human provider.

| Function                        | Returns   | Description                                          |
| ------------------------------- | --------- | ---------------------------------------------------- |
| `providerName()`                | `"self"`  | Provider identifier string                           |
| `verificationStrength()`        | `100`     | Passport NFC + biometric verification                |
| `verifyHumanProof(proof, data)` | Reverts   | Always reverts with `DirectVerificationNotSupported` |
| `hubV2()`                       | `address` | The Hub V2 contract address (immutable)              |
| `scope()`                       | `uint256` | The nullifier scope value (immutable)                |

## SelfReputationRegistry

ERC-8004 reputation (feedback) registry, UUPS proxy. At registration the identity registry auto-records a `proof-of-human` feedback entry (value = per-document weight, `tag2` = document tag).

| Function                                                                                                    | Returns                                                          | Notes                                                                       |
| ----------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- | --------------------------------------------------------------------------- |
| `giveFeedback(agentId, int128 value, uint8 valueDecimals, tag1, tag2, endpoint, feedbackURI, feedbackHash)` | —                                                                | Agent owner/operator can't rate own agent                                   |
| `revokeFeedback(agentId, uint64 feedbackIndex)`                                                             | —                                                                | Original submitter only                                                     |
| `appendResponse(agentId, clientAddress, feedbackIndex, responseURI, responseHash)`                          | —                                                                | Agent owner/operator only                                                   |
| `readFeedback(agentId, clientAddress, feedbackIndex)`                                                       | `(int128, uint8, string, string, bool, string, string, bytes32)` | value, decimals, tag1, tag2, isRevoked, endpoint, feedbackURI, feedbackHash |
| `getSummary(agentId, address[] clientAddresses, tag1, tag2)`                                                | `(uint64, int256, uint8)`                                        | count, summaryValue, decimals; ≥1 client required; `""` = no tag filter     |
| `getClients(agentId)` / `getLastIndex(agentId, client)`                                                     | `address[]` / `uint64`                                           | Enumeration                                                                 |
| `getDocumentWeight(bytes32 attestationId)`                                                                  | `(int128, string)`                                               | Weight + tag used for auto-feedback                                         |

## SelfValidationRegistry

ERC-8004 validation registry, UUPS proxy. Self acts as a built-in validator via `submitFreshnessValidation` (response `100` if `registry.isProofFresh(agentId)`, else `0`; tag `freshness`; one entry per agent per UTC day).

| Function                                                                          | Returns                                                     | Notes                                                                    |
| --------------------------------------------------------------------------------- | ----------------------------------------------------------- | ------------------------------------------------------------------------ |
| `validationRequest(validatorAddress, agentId, requestURI, bytes32 requestHash)`   | —                                                           | Agent owner/operator only                                                |
| `validationResponse(requestHash, uint8 response, responseURI, responseHash, tag)` | —                                                           | Named validator only; `response` 0-100                                   |
| `getValidationStatus(requestHash)`                                                | `(address, uint256, uint8, bytes32, string, uint256, bool)` | validator, agentId, response, responseHash, tag, lastUpdate, hasResponse |
| `getSummary(agentId, address[] validatorAddresses, tag)`                          | `(uint64 count, uint8 avgResponse)`                         | `""` = no tag filter                                                     |
| `getAgentValidations(agentId)` / `getValidatorRequests(validator)`                | `bytes32[]`                                                 | Request hashes                                                           |
| `submitFreshnessValidation(agentId)`                                              | —                                                           | Anyone can call                                                          |
| `getLatestFreshness(agentId)`                                                     | `(bool fresh, uint256 lastUpdated)`                         | Today's or yesterday's entry, else `(false, 0)`                          |
| `getFreshnessHistory(agentId)`                                                    | `bytes32[]`                                                 | Day-bucket request hashes                                                |

## SelfReputationSignal (not deployed)

Stateless view wrapper over the registry; the score is the agent's provider `verificationStrength()`.

| Function                       | Returns                          | Description                                        |
| ------------------------------ | -------------------------------- | -------------------------------------------------- |
| `getReputationScore(agentId)`  | `uint8` (0-100)                  | Provider's `verificationStrength()`; 0 if no proof |
| `getReputation(agentId)`       | `(uint8, string, bool, uint256)` | score, providerName, hasProof, registeredAtBlock   |
| `getReputationBatch(agentIds)` | `uint8[]`                        | Batch scores                                       |

Only `SelfHumanProofProvider` (strength **100**) is approved today. The SDK's `getProviderLabel()` maps ≥100 `passport`, ≥80 `kyc`, ≥60 `govt_id`, ≥40 `liveness`, else `unknown`.

## SelfFreshnessChecker (not deployed)

Stateless view wrapper; "fresh" = registered within `freshnessThreshold` blocks.

| Function                        | Returns                                   | Description                                         |
| ------------------------------- | ----------------------------------------- | --------------------------------------------------- |
| `validateAgent(agentId)`        | `(bool, bool, uint256, uint256, address)` | valid, fresh, registeredAt, blockAge, proofProvider |
| `isValidAgent(agentId)`         | `bool`                                    | `hasHumanProof` AND within threshold                |
| `validateBatch(agentIds)`       | `bool[]`                                  | Batch `isValidAgent`                                |
| `freshnessThreshold()`          | `uint256`                                 | Default 6,307,200 blocks                            |
| `setFreshnessThreshold(blocks)` | —                                         | Owner-only; `0` = registered this block only        |

The default 6,307,200 blocks is **≈73 days** at Celo's ~1 s block time (the source comment assumes 5 s blocks / ~1 year). It is independent of the registry's own expiry (`proofExpiresAt`, `maxProofAge` default 365 days) — for expiry, use `registry.isProofFresh(agentId)`.

## Celo Agent Visa

Tiered "visa" NFTs layered on top of agent identities (addresses in the table above). Reads are public; writes are relayed by the API and require an EIP-191 signed request.

| Method | Path                                     | Description                                                                               |
| ------ | ---------------------------------------- | ----------------------------------------------------------------------------------------- |
| `GET`  | `/api/visa/{chainId}/{agentId}`          | Visa state, metrics, eligibility (agentId as decimal)                                     |
| `GET`  | `/api/visa/{chainId}/batch?agents=1,2,3` | Up to 100 agents; any invalid id → 400                                                    |
| `GET`  | `/api/visa/agents?wallet=0x…&chainId=…`  | Agents owned by a wallet                                                                  |
| `POST` | `/api/visa/claim`                        | `{ chainId, agentId, targetTier (1-3), agentWallet?, signature, timestamp }`              |
| `POST` | `/api/visa/migrate`                      | `{ chainId, oldAgentId, newAgentId, connectedWallet, targetTier?, signature, timestamp }` |
| `POST` | `/api/visa/request-review`               | `{ chainId, agentId, targetTier (2 or 3), signature, timestamp }`                         |

Visa agent ids are always decimal strings in responses (wallet-derived ids can be 160-bit).

The signed message is these lines joined by `\n` (no trailing newline); `timestamp` is unix milliseconds within ±5 minutes, and each signed message is accepted once:

```
Self Agent ID visa request
action: claim
chainId: 11142220
agentId: 42
targetTier: 1
timestamp: 1767225600000
```

`migrate` signs `action: migrate`, `agentId: <oldAgentId>` and an extra `newAgentId: <id>` line after `agentId`. The signer must be the registry `ownerOf(agentId)` or the agent's own key (for wallet-based ids, the wallet itself); anyone else gets 403; an agent ID that doesn't exist gets 404. Limits: 20 signed attempts per IP per hour; relayed transactions are capped at 2 per signer, 5 per IP and 50 globally per hour.

```typescript
import { ethers } from "ethers";

const timestamp = Date.now();
const message = [
  "Self Agent ID visa request",
  "action: claim",
  "chainId: 11142220",
  "agentId: 42",
  "targetTier: 1",
  `timestamp: ${timestamp}`,
].join("\n");
const signature = await wallet.signMessage(message); // agent key or NFT owner

await fetch("https://agent-api.self.xyz/api/visa/claim", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    chainId: 11142220,
    agentId: "42",
    targetTier: 1,
    signature,
    timestamp,
  }),
});
```

## Key Interfaces

### IHumanProofProvider

The pluggable provider interface. Any identity verification system can implement this to serve as a proof provider for the registry.

```solidity
interface IHumanProofProvider {
    function verifyHumanProof(
        bytes calldata proof,
        bytes calldata data
    ) external returns (bool verified, uint256 nullifier);

    function providerName() external view returns (string memory);

    function verificationStrength() external view returns (uint8);
}
```

### IERC8004ProofOfHuman

The ERC-8004 extension interface adding proof-of-human capabilities to an identity registry.

```solidity
interface IERC8004ProofOfHuman {
    function registerWithHumanProof(string calldata agentURI, address proofProvider, bytes calldata proof, bytes calldata providerData) external returns (uint256);
    function revokeHumanProof(uint256 agentId, address proofProvider, bytes calldata proof, bytes calldata providerData) external;
    function hasHumanProof(uint256 agentId) external view returns (bool); // ignores expiry
    function proofExpiresAt(uint256 agentId) external view returns (uint256);
    function isProofFresh(uint256 agentId) external view returns (bool);
    function getHumanNullifier(uint256 agentId) external view returns (uint256);
    function getProofProvider(uint256 agentId) external view returns (address);
    function getAgentCountForHuman(uint256 nullifier) external view returns (uint256);
    function getAgentsForNullifier(uint256 nullifier) external view returns (uint256[] memory);
    function getAgentsForNullifier(uint256 nullifier, uint256 offset, uint256 limit) external view returns (uint256[] memory);
    function sameHuman(uint256 agentIdA, uint256 agentIdB) external view returns (bool);
    function isApprovedProvider(address provider) external view returns (bool);
}
```

### ISelfAgentRegistryReader

Minimal read-only interface used by the reputation/validation contracts to query the registry.

```solidity
interface ISelfAgentRegistryReader {
    function hasHumanProof(uint256 agentId) external view returns (bool);
    function getProofProvider(uint256 agentId) external view returns (address);
    function agentRegisteredAt(uint256 agentId) external view returns (uint256);
    function isAuthorizedOrOwner(address spender, uint256 agentId) external view returns (bool);
    function isProofFresh(uint256 agentId) external view returns (bool);
    function proofExpiresAt(uint256 agentId) external view returns (uint256);
}
```

## Integration Patterns (Solidity)

### Basic Humanity Check

```solidity
import { IERC8004ProofOfHuman } from "./interfaces/IERC8004ProofOfHuman.sol";

IERC8004ProofOfHuman registry = IERC8004ProofOfHuman(REGISTRY_ADDRESS);

// Verify an agent has a human proof that has not expired
require(registry.hasHumanProof(agentId), "Not human-verified");
require(registry.isProofFresh(agentId), "Proof expired");
```

### Provider Verification

```solidity
// Ensure the agent was verified by Self Protocol (not a weaker provider)
address provider = registry.getProofProvider(agentId);
require(provider == SELF_PROVIDER_ADDRESS, "Wrong provider");
```

### Verification-Strength Gating

```solidity
import { IHumanProofProvider } from "./interfaces/IHumanProofProvider.sol";

// Same value SelfReputationSignal.getReputationScore() returns, without deploying it
address provider = registry.getProofProvider(agentId);
require(provider != address(0), "No proof");
require(IHumanProofProvider(provider).verificationStrength() >= 80, "Insufficient strength");
```

### Feedback / Validation Registries

```solidity
// ERC-8004 feedback summary from clients you trust
(uint64 count, int256 total, ) = SelfReputationRegistry(REPUTATION_REGISTRY)
    .getSummary(agentId, trustedClients, "", "");

// Self's daily freshness attestation
(bool fresh, ) = SelfValidationRegistry(VALIDATION_REGISTRY).getLatestFreshness(agentId);
```

### Sybil Detection

```solidity
// Prevent the same human from using multiple agents
require(!registry.sameHuman(agentIdA, agentIdB), "Same human");

// Check total agents for a human
uint256 nullifier = registry.getHumanNullifier(agentId);
uint256 count = registry.getAgentCountForHuman(nullifier);
require(count <= MAX_ALLOWED, "Too many agents");
```

### Credential-Based Access Control

```solidity
// Age-gated access (reading from ZK-attested credentials)
SelfAgentRegistry fullRegistry = SelfAgentRegistry(REGISTRY_ADDRESS);
SelfAgentRegistry.AgentCredentials memory creds = fullRegistry.getAgentCredentials(agentId);
require(creds.olderThan >= 18, "Must be 18+");

// OFAC compliance check
require(creds.ofac[0] && creds.ofac[1] && creds.ofac[2], "OFAC check failed");
```

### Combined Check (Recommended Pattern)

```solidity
// Full verification: humanity + expiry + provider (Self = strength 100)
require(registry.hasHumanProof(agentId), "Not human-verified");
require(registry.isProofFresh(agentId), "Proof expired");
require(registry.getProofProvider(agentId) == SELF_PROVIDER_ADDRESS, "Wrong provider");
```

## Agent Key Derivation

For ECDSA agents the agent key is derived from an Ethereum address:

```solidity
bytes32 agentKey = bytes32(uint256(uint160(agentAddress)));
```

- **Simple action (`R`):** `agentAddress` = human's wallet address
- **Advanced action (`K`, API modes `linked` / `privy` / `smartwallet`):** `agentAddress` = agent's own address (separate keypair)
- **Wallet-free (`W`):** `agentAddress` = agent's own address

Ed25519 agents (`E`, API modes `ed25519` / `ed25519-linked`) use the raw 32-byte Ed25519 public key as the agent key.

To convert back:

```solidity
address agentAddress = address(uint160(uint256(agentKey)));
```

**Important:** Use `bytes32(uint256(uint160(addr)))` (zero-padded on the left, address in the low-order bytes), NOT `bytes32(bytes20(addr))`, which puts the address in the high-order bytes and produces a different key.

## userDefinedData Format

The `userDefinedData` field passed through the Hub V2 callback encodes the registration action and parameters. The Self SDK sends this as a UTF-8 string (not raw bytes), so all values are ASCII-encoded.

### Byte Layout

```
Position [0]: Action byte (ASCII character)
  'R' (0x52) = Simple register
  'D' (0x44) = Simple deregister
  'K' (0x4B) = Advanced register
  'X' (0x58) = Advanced deregister
  'W' (0x57) = Wallet-free register
  'E' (0x45) = Ed25519 register
  'F' (0x46) = Refresh proof in place
  'I' (0x49) = Identify (emits the human's nullifier; no state change)

Position [1]: Config index ('0'-'5' ASCII, or 0x00-0x05 binary)
  Selects one of 6 verification configs (age x OFAC combos)

Position [2+]: Mode-specific payload
  Simple (R/D):    No additional payload
  Advanced (K):    agentAddr(40 hex chars) + r(64) + s(64) + v(2) = 170 chars
  Deregister (X):  agentAddr(40 hex chars)
  Wallet-free (W): agentAddr(40) + guardian(40) + r(64) + s(64) + v(2) = 210 chars
  Ed25519 (E):     pubkey(64) + sig(128) + extKpub(5 x 64) + guardian(40) = 552 chars
  Refresh (F):     agentId as 32 raw bytes (big-endian); the Self app's UTF-8 encoding
                   means bytes >= 0x80 cannot be sent, so such ids cannot be refreshed
```

### Total Lengths

| Mode                      | Min Length | Format                                                             |
| ------------------------- | ---------- | ------------------------------------------------------------------ |
| Simple register (`R`)     | 2          | `R` + config                                                       |
| Simple deregister (`D`)   | 2          | `D` + config                                                       |
| Advanced register (`K`)   | 172        | `K` + config + addr(40) + r(64) + s(64) + v(2)                     |
| Advanced deregister (`X`) | 42         | `X` + config + addr(40)                                            |
| Wallet-free (`W`)         | 212        | `W` + config + agentAddr(40) + guardian(40) + r(64) + s(64) + v(2) |
| Ed25519 (`E`)             | 554        | `E` + config + pubkey(64) + sig(128) + extKpub(320) + guardian(40) |
| Refresh (`F`)             | 34         | `F` + config + agentId (32 raw bytes)                              |

## Error Reference

| Error                                   | Meaning                                                   |
| --------------------------------------- | --------------------------------------------------------- |
| `TransferNotAllowed()`                  | Attempted to transfer a soulbound NFT                     |
| `AgentAlreadyRegistered(agentKey)`      | Agent key is already registered                           |
| `AgentNotRegistered(agentKey)`          | Agent key has no registration                             |
| `NotAgentOwner(expected, actual)`       | Nullifier mismatch on deregistration                      |
| `InvalidAction(action)`                 | Unknown action byte in userDefinedData                    |
| `InvalidUserData()`                     | Malformed or too-short userDefinedData                    |
| `ProviderNotApproved(provider)`         | Provider not on the whitelist                             |
| `InvalidAgentSignature()`               | ECDSA signature does not match agent address              |
| `NotGuardian(agentId)`                  | Caller is not the designated guardian                     |
| `NotNftOwner(agentId)`                  | Caller does not own the agent NFT                         |
| `NoGuardianSet(agentId)`                | No guardian exists for this agent                         |
| `TooManyAgentsForHuman(nullifier, max)` | Sybil limit exceeded                                      |
| `InvalidConfigIndex(raw)`               | Config byte not in range 0-5 or '0'-'5'                   |
| `VerificationFailed()`                  | Synchronous provider verification failed                  |
| `ProviderDataTooShort()`                | Provider data missing agent key (< 32 bytes)              |
| `NotSameHuman()`                        | Nullifier mismatch on revocation                          |
| `DirectVerificationNotSupported()`      | Called verifyHumanProof on Self provider (use async flow) |

## Compilation and Deployment Notes

- **Solidity version:** 0.8.28
- **EVM version:** Must use `--evm-version cancun` (Hub V2 uses PUSH0 opcode)
- **Framework:** Foundry (forge build, forge test, forge script)
- **Dependencies:** OpenZeppelin Contracts, @selfxyz/contracts
- **Contract verification:** Use Sourcify verifier for Celoscan (the Etherscan-style API is unreliable). Blockscout requires no API key.
- **Agent IDs:** Start at 1 (ID 0 is reserved as "no agent" sentinel value)
- **Soulbound enforcement:** Implemented via `_update` override, not via approval restrictions
