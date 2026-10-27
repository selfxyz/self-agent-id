# Self Agent ID — Contracts

ERC-8004 agent registry with a [proof-of-human extension](../docs/EIP_DRAFT_PROOF_OF_HUMAN.md), on Celo. Foundry project; MIT licensed.

```bash
git submodule update --init --recursive   # lib/ dependencies
forge build --evm-version cancun          # cancun: Hub V2 uses PUSH0
./scripts/test.sh                         # forge test --offline; SELF_AGENT_CONTRACTS_ONLINE=1 for online
```

## Contracts (`src/`)

| Contract                 | Role                                                                                                           |
| ------------------------ | -------------------------------------------------------------------------------------------------------------- |
| `SelfAgentRegistry`      | Core registry (UUPS proxy). Soulbound ERC-721 per agent, Hub V2 callback, credentials, proof expiry, guardians |
| `SelfHumanProofProvider` | Metadata wrapper for Self as a proof provider (`providerName() = "self"`, strength 100)                        |
| `SelfReputationRegistry` | ERC-8004 reputation registry (UUPS): feedback, document-type weights, human-proof feedback                     |
| `SelfValidationRegistry` | ERC-8004 validation registry (UUPS): validation requests/responses, freshness validations                      |
| `SelfReputationSignal`   | Stateless score view: `getReputationScore`, `getReputation`, `getReputationBatch`                              |
| `SelfFreshnessChecker`   | Stateless freshness view: `validateAgent`, `isValidAgent`, `validateBatch`                                     |
| `LocalRegistryHarness`   | Test-only mock registry for CLI integration tests                                                              |

Interfaces live in `src/interfaces/` (`IERC8004ProofOfHuman`, `IHumanProofProvider`, …). Deploy and upgrade scripts are in `script/`; the deployment record (proxies, implementations, multisigs) is [`deployments/registry.json`](deployments/registry.json).

## Deployed addresses

| Contract                         | Celo Mainnet (`42220`)                       | Celo Sepolia (`11142220`)                    |
| -------------------------------- | -------------------------------------------- | -------------------------------------------- |
| SelfAgentRegistry                | `0xaC3DF9ABf80d0F5c020C06B04Cced27763355944` | `0x043DaCac8b0771DD5b444bCC88f2f8BBDBEdd379` |
| SelfHumanProofProvider           | `0x4b036aFD959B457A208F676cf44Ea3ef73Ea3E3d` | `0x5E61c3051Bf4115F90AacEAE6212bc419f8aBB6c` |
| SelfReputationRegistry           | `0x69Da18CF4Ac27121FD99cEB06e38c3DC78F363f4` | `0x3Bb0A898C1C0918763afC22ff624131b8F420CC2` |
| SelfValidationRegistry           | `0x71a025e0e338EAbcB45154F8b8CA50b41e7A0577` | `0x84cA20B8A1559F136dA03913dbe6A7F68B6B240B` |
| CeloAgentVisa (not in this repo) | `0xCa97f7586CF9De62B8ca516d7Ee25f6AEae5e109` | `0xf049FD6260Fce964B82728A86CF1BbEB8AB3E875` |
| Self Hub V2 (external)           | `0xe57F4773bd9c9d8b6Cd70431117d353298B9f5BF` | `0x16ECBA51e18a4a7e61fdC417f0d47AFEeDfbed74` |

The API reads these from [`app/lib/network.ts`](../app/lib/network.ts); update it on a redeploy.

## `userDefinedData` encoding

The Self app passes `userDefinedData` as a UTF-8 string, so every position is an ASCII character (`'4'`, not `0x04`). Byte 0 is the action; byte 1 the config digit: `0` none, `1` age 18, `2` age 21, `3` OFAC, `4` 18 + OFAC, `5` 21 + OFAC.

| Byte 0    | Action                                                                                          |
| --------- | ----------------------------------------------------------------------------------------------- |
| `R` / `D` | Register (agent key = human wallet; unused by the API) / deregister                             |
| `K` / `X` | Register with an agent keypair (`linked`, `privy`, `smartwallet`) / deregister by agent address |
| `W` / `E` | Register wallet-free / Ed25519, each with an optional guardian                                  |
| `F` / `I` | Refresh the proof in place / identify (emit the nullifier, no state change)                     |

## Design rules

- **Soulbound**: transfers revert; only mint (register) and burn (deregister).
- **Verified** = `hasHumanProof && isProofFresh`; `proofExpiresAt = min(document expiry, now + maxProofAge)`, `maxProofAge` defaults to 365 days.
- **Sybil resistance**: one nullifier per human; `maxAgentsPerHuman` defaults to 1; `sameHuman()` and `getAgentCountForHuman()` for custom policies.
- **Guardians**: `W` and `E` registrations can set one; `guardianRevoke(agentId)` force-revokes. NFT owners use `selfDeregister`.
- **Metadata**: `updateAgentMetadata` is NFT-owner only (the agent key for wallet-free agents, the human wallet for linked ones).
