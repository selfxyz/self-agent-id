# Self Agent ID — Smart Contracts

On-chain AI agent registry with ERC-8004 proof-of-human extension, deployed on Celo.

## Contracts

| Contract | Description |
|----------|-------------|
| `SelfAgentRegistry` | Core registry — ERC-721 soulbound NFTs, 4 registration modes (simple/advanced/wallet-free/smart-wallet), ZK-attested credentials, multi-config verification |
| `SelfHumanProofProvider` | Proof provider — connects to Self Protocol Hub V2, verifies ZK proofs, manages 6 verification configs (age 0/18/21 x OFAC off/on) |
| `AgentDemoVerifier` | Demo contract — EIP-712 meta-transaction verifier for gasless on-chain agent verification |
| `AgentGate` | Access gate — `onlyVerifiedAgent` modifier for gating contract functions to verified agents |
| `SelfReputationProvider` | Reputation — verification strength scoring from proof providers |
| `SelfValidationProvider` | Validation — real-time proof status and freshness checks |
| `LocalRegistryHarness` | Test harness — local mock for testing without Hub V2 dependency |

## Deployed Addresses

### Celo Mainnet (42220)

| Contract | Address |
|----------|---------|
| Registry | `0x62E37d0f6c5f67784b8828B3dF68BCDbB2e55095` |
| Provider | `0x0B43f87aE9F2AE2a50b3698573B614fc6643A084` |
| DemoVerifier | `0x063c3bc21F0C4A6c51A84B1dA6de6510508E4F1e` |
| AgentGate | `0x2d710190e018fCf006E38eEB869b25C5F7d82424` |

### Celo Sepolia (11142220)

| Contract | Address |
|----------|---------|
| Registry | `0x42CEA1b318557aDE212bED74FC3C7f06Ec52bd5b` |
| Provider | `0x69Da18CF4Ac27121FD99cEB06e38c3DC78F363f4` |
| DemoVerifier | `0x26e05bF632fb5bACB665ab014240EAC1413dAE35` |
| AgentGate | `0x71a025e0e338EAbcB45154F8b8CA50b41e7A0577` |

## Build & Test

Requires [Foundry](https://book.getfoundry.sh/).

```shell
forge build --evm-version cancun
./scripts/test.sh
```

The `--evm-version cancun` flag is required because Self Protocol Hub V2 uses `PUSH0`.

`./scripts/test.sh` runs `forge test --offline` by default to avoid a known Foundry
panic in some environments when resolving external signature metadata.
Set `SELF_AGENT_CONTRACTS_ONLINE=1` to force the online `forge test` path.

## Key Design Decisions

- **Soulbound NFTs**: Agent tokens are non-transferable (mint/burn only)
- **Async verification**: ZK proof verification happens via Hub V2 callback, not in the registration tx
- **Multi-config**: 6 verification configs (age thresholds x OFAC screening), selected via `userDefinedData[1]`
- **Guardian system**: Wallet-free and smart-wallet modes support optional guardians for agent revocation
- **Nullifier-based sybil resistance**: Each human maps to a unique nullifier; `sameHuman()` and `getAgentCountForHuman()` enable per-service sybil policies
