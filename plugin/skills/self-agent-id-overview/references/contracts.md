# Self Agent ID — Contract Reference

## Contract Addresses

| Contract | Mainnet (42220) | Testnet (11142220) |
|---|---|---|
| SelfAgentRegistry | `0x62E37d0f6c5f67784b8828B3dF68BCDbB2e55095` | `0x42CEA1b318557aDE212bED74FC3C7f06Ec52bd5b` |
| SelfHumanProofProvider | `0x0B43f87aE9F2AE2a50b3698573B614fc6643A084` | `0x69Da18CF4Ac27121FD99cEB06e38c3DC78F363f4` |
| AgentDemoVerifier | `0x063c3bc21F0C4A6c51A84B1dA6de6510508E4F1e` | `0x26e05bF632fb5bACB665ab014240EAC1413dAE35` |
| AgentGate | `0x2d710190e018fCf006E38eEB869b25C5F7d82424` | `0x71a025e0e338EAbcB45154F8b8CA50b41e7A0577` |
| Hub V2 (Self Protocol) | `0xe57F4773bd9c9d8b6Cd70431117d353298B9f5BF` | `0x16ECBA51e18a4a7e61fdC417f0d47AFEeDfbed74` |

All contracts are verified on Sourcify, Celoscan, and Blockscout.

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

Check if an agent key maps to a registered agent with an active human proof. The most common verification check. Returns `false` if the agent key is unregistered or the proof has been revoked.

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

### Admin Functions (Owner Only)

| Function | Description |
|---|---|
| `setSelfProofProvider(address)` | Set the Self Protocol proof provider address |
| `addProofProvider(address)` | Whitelist a new proof provider |
| `removeProofProvider(address)` | Remove a provider from the whitelist |
| `setMaxAgentsPerHuman(uint256)` | Set the sybil limit (0 = unlimited) |

### Events

| Event | Parameters |
|---|---|
| `AgentRegisteredWithHumanProof` | `agentId, proofProvider, nullifier, verificationStrength` |
| `HumanProofRevoked` | `agentId, nullifier` |
| `ProofProviderAdded` | `provider, name` |
| `ProofProviderRemoved` | `provider` |
| `GuardianSet` | `agentId, guardian` |
| `AgentMetadataUpdated` | `agentId` |
| `AgentCredentialsStored` | `agentId` |
| `MaxAgentsPerHumanUpdated` | `max` |

## SelfHumanProofProvider

Lightweight metadata wrapper for Self Protocol as a proof-of-human provider.

| Function | Returns | Description |
|---|---|---|
| `providerName()` | `"self"` | Provider identifier string |
| `verificationStrength()` | `100` | Passport NFC + biometric verification |
| `verifyHumanProof(proof, data)` | Reverts | Always reverts with `DirectVerificationNotSupported` |
| `hubV2()` | `address` | The Hub V2 contract address (immutable) |
| `scope()` | `uint256` | The nullifier scope value (immutable) |

## SelfReputationProvider

Stateless view-only wrapper for ERC-8004 reputation scoring.

| Function | Returns | Description |
|---|---|---|
| `getReputationScore(agentId)` | `uint8` (0-100) | Score from provider's `verificationStrength()` |
| `getReputation(agentId)` | `(uint8, string, bool, uint256)` | Full details: score, providerName, hasProof, registeredAtBlock |
| `getReputationBatch(agentIds)` | `uint8[]` | Batch scores for multiple agents |
| `name()` | `"Self Protocol"` | Provider metadata |
| `version()` | `"1.0"` | Provider version |

Score interpretation:
- **100** — Passport NFC chip + biometric (Self Protocol)
- **60** — Government ID without chip
- **40** — Video liveness check
- **0** — No proof or unverified agent

## SelfValidationProvider

Freshness-checking validation provider for ERC-8004.

| Function | Returns | Description |
|---|---|---|
| `validateAgent(agentId)` | `(bool, bool, uint256, uint256, address)` | Full validation: valid, fresh, registeredAt, blockAge, proofProvider |
| `isValidAgent(agentId)` | `bool` | Quick check: valid AND fresh |
| `validateBatch(agentIds)` | `bool[]` | Batch validation for multiple agents |
| `setFreshnessThreshold(blocks)` | — | Owner-only: set freshness window in blocks |
| `freshnessThreshold()` | `uint256` | Current threshold (default: 6,307,200 blocks) |
| `name()` | `"Self Protocol"` | Provider metadata |
| `version()` | `"1.0"` | Provider version |

Default freshness threshold: **6,307,200 blocks** (~1 year on Celo at 5 seconds per block).

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
    function hasHumanProof(uint256 agentId) external view returns (bool);
    function getHumanNullifier(uint256 agentId) external view returns (uint256);
    function getProofProvider(uint256 agentId) external view returns (address);
    function getAgentCountForHuman(uint256 nullifier) external view returns (uint256);
    function sameHuman(uint256 agentIdA, uint256 agentIdB) external view returns (bool);
    function isApprovedProvider(address provider) external view returns (bool);
}
```

### ISelfAgentRegistryReader

Minimal read-only interface used by provider contracts (reputation, validation) to query the registry without importing the full contract.

```solidity
interface ISelfAgentRegistryReader {
    function hasHumanProof(uint256 agentId) external view returns (bool);
    function getProofProvider(uint256 agentId) external view returns (address);
    function agentRegisteredAt(uint256 agentId) external view returns (uint256);
}
```

## Integration Patterns (Solidity)

### Basic Humanity Check

```solidity
import { IERC8004ProofOfHuman } from "./interfaces/IERC8004ProofOfHuman.sol";

IERC8004ProofOfHuman registry = IERC8004ProofOfHuman(REGISTRY_ADDRESS);

// Verify an agent has a human proof
require(registry.hasHumanProof(agentId), "Not human-verified");
```

### Provider Verification

```solidity
// Ensure the agent was verified by Self Protocol (not a weaker provider)
address provider = registry.getProofProvider(agentId);
require(provider == SELF_PROVIDER_ADDRESS, "Wrong provider");
```

### Reputation Gating

```solidity
import { SelfReputationProvider } from "./SelfReputationProvider.sol";

SelfReputationProvider reputation = SelfReputationProvider(REPUTATION_ADDRESS);

uint8 score = reputation.getReputationScore(agentId);
require(score >= 80, "Insufficient reputation");
```

### Freshness Validation

```solidity
import { SelfValidationProvider } from "./SelfValidationProvider.sol";

SelfValidationProvider validation = SelfValidationProvider(VALIDATION_ADDRESS);

require(validation.isValidAgent(agentId), "Proof expired or invalid");
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
// Full verification: humanity + provider + freshness + reputation
require(registry.hasHumanProof(agentId), "Not human-verified");
require(registry.getProofProvider(agentId) == SELF_PROVIDER_ADDRESS, "Wrong provider");
require(validation.isValidAgent(agentId), "Proof expired");

uint8 score = reputation.getReputationScore(agentId);
require(score >= 80, "Insufficient reputation");
```

## Agent Key Derivation

The agent key is always derived from an Ethereum address:

```solidity
bytes32 agentKey = bytes32(uint256(uint160(agentAddress)));
```

This applies to all registration modes:
- **Simple mode:** `agentAddress` = human's wallet address
- **Advanced mode:** `agentAddress` = agent's own address (separate keypair)
- **Wallet-free mode:** `agentAddress` = agent's own address
- **Smart wallet mode:** `agentAddress` = agent's own address (smart account as guardian)

To convert back:

```solidity
address agentAddress = address(uint160(uint256(agentKey)));
```

**Important:** Use `bytes32(uint256(uint160(addr)))` for the conversion, NOT `bytes32(bytes20(addr))`. The former right-pads with zeros (address in low-order bytes), while the latter left-pads, producing a different bytes32 value. The registry consistently uses the right-padded form.

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

Position [1]: Config index ('0'-'5' ASCII, or 0x00-0x05 binary)
  Selects one of 6 verification configs (age x OFAC combos)

Position [2+]: Mode-specific payload
  Simple (R/D):    No additional payload
  Advanced (K):    agentAddr(40 hex chars) + r(64) + s(64) + v(2) = 170 chars
  Deregister (X):  agentAddr(40 hex chars)
  Wallet-free (W): agentAddr(40) + guardian(40) + r(64) + s(64) + v(2) = 210 chars
```

### Total Lengths

| Mode | Min Length | Format |
|---|---|---|
| Simple register (`R`) | 2 | `R` + config |
| Simple deregister (`D`) | 2 | `D` + config |
| Advanced register (`K`) | 172 | `K` + config + addr(40) + r(64) + s(64) + v(2) |
| Advanced deregister (`X`) | 42 | `X` + config + addr(40) |
| Wallet-free (`W`) | 212 | `W` + config + agentAddr(40) + guardian(40) + r(64) + s(64) + v(2) |

## Error Reference

| Error | Meaning |
|---|---|
| `TransferNotAllowed()` | Attempted to transfer a soulbound NFT |
| `AgentAlreadyRegistered(agentKey)` | Agent key is already registered |
| `AgentNotRegistered(agentKey)` | Agent key has no registration |
| `NotAgentOwner(expected, actual)` | Nullifier mismatch on deregistration |
| `InvalidAction(action)` | Unknown action byte in userDefinedData |
| `InvalidUserData()` | Malformed or too-short userDefinedData |
| `ProviderNotApproved(provider)` | Provider not on the whitelist |
| `InvalidAgentSignature()` | ECDSA signature does not match agent address |
| `NotGuardian(agentId)` | Caller is not the designated guardian |
| `NotNftOwner(agentId)` | Caller does not own the agent NFT |
| `NoGuardianSet(agentId)` | No guardian exists for this agent |
| `TooManyAgentsForHuman(nullifier, max)` | Sybil limit exceeded |
| `InvalidConfigIndex(raw)` | Config byte not in range 0-5 or '0'-'5' |
| `VerificationFailed()` | Synchronous provider verification failed |
| `ProviderDataTooShort()` | Provider data missing agent key (< 32 bytes) |
| `NotSameHuman()` | Nullifier mismatch on revocation |
| `DirectVerificationNotSupported()` | Called verifyHumanProof on Self provider (use async flow) |

## Compilation and Deployment Notes

- **Solidity version:** 0.8.28
- **EVM version:** Must use `--evm-version cancun` (Hub V2 uses PUSH0 opcode)
- **Framework:** Foundry (forge build, forge test, forge script)
- **Dependencies:** OpenZeppelin Contracts, @selfxyz/contracts
- **Contract verification:** Use Sourcify verifier for Celoscan (the Etherscan-style API is unreliable). Blockscout requires no API key.
- **Agent IDs:** Start at 1 (ID 0 is reserved as "no agent" sentinel value)
- **Soulbound enforcement:** Implemented via `_update` override, not via approval restrictions
