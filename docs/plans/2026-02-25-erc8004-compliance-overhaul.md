# ERC-8004 Compliance Overhaul Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make `SelfAgentRegistry` fully ERC-8004 compliant, add a proper proof-expiry system, and deploy companion Reputation and Validation Registries scoped to our identity registry.

**Architecture:** The overhaul is purely additive — we layer the missing ERC-8004 base interface (agentURI storage, standard events, metadata key-value store, agent wallet) on top of the existing ZK proof machinery. A new `requireHumanProof` flag lets the base `register()` functions exist for interface compliance while keeping our sybil-resistance guarantee. Expiry is tracked as a first-class on-chain timestamp derived from the passport's own document expiry date. Two new contracts (`SelfReputationRegistry`, `SelfValidationRegistry`) replace the misnamed providers and implement the full ERC-8004 Reputation and Validation Registry interfaces scoped to our identity registry.

**Tech Stack:** Solidity 0.8.28, Foundry (forge test / forge script), OpenZeppelin v5, Self Protocol Hub V2, Celo (EVM paris), EIP-712, ERC-165.

---

## Background: What Exists vs What's Missing

**Already correct:**
- ERC-721 base, soulbound enforcement, nullifier sybil resistance
- `registerWithHumanProof()`, `revokeHumanProof()`, all IERC8004ProofOfHuman view functions
- Guardian system, ZK credential storage (`AgentCredentials`), per-agent nonces
- `agentRegisteredAt` block tracking, `SelfHumanProofProvider`

**Missing (critical ERC-8004 compliance):**
- `agentURI` storage — currently discarded on registration
- `Registered(agentId, agentURI, owner)` event — 8004scan indexes on this
- `setAgentURI()` + `URIUpdated` event
- Three `register()` overloads (base interface requirement)
- `getMetadata()` / `setMetadata()` key-value store + `MetadataSet` event
- `setAgentWallet()` / `getAgentWallet()` / `unsetAgentWallet()` + EIP-712
- `ERC165.supportsInterface()` for both base and extension interface IDs
- `proofExpiresAt` timestamp (Remi's expiry feature)
- Full Reputation Registry (currently a misnamed signal adapter)
- Full Validation Registry (currently a misnamed freshness checker)

---

## Phase 1: Base ERC-8004 Identity Registry Compliance

### Task 1: agentURI Storage + `Registered` Event

This is the most critical fix. The `Registered` event is what 8004scan and all ERC-8004 indexers listen for. Without it, our registry is invisible to the ecosystem.

**Files:**
- Modify: `contracts/src/SelfAgentRegistry.sol`
- Modify: `contracts/test/SelfAgentRegistry.t.sol`

**Step 1: Write the failing tests**

Add to `contracts/test/SelfAgentRegistry.t.sol`:

```solidity
function test_registeredEventEmittedOnSimpleRegister() public {
    string memory uri = "ipfs://QmTestAgentRegistrationFile";
    // Encode agentURI into userDefinedData after action + config bytes
    bytes memory userData = _buildUserDataWithURI(ACTION_REGISTER, 0, uri);

    vm.expectEmit(true, true, false, true);
    emit Registered(1, uri, HUMAN_ADDR);

    _registerViaHub(HUMAN_ADDR, NULLIFIER_1, userData);
}

function test_agentURIStoredOnRegistration() public {
    string memory uri = "ipfs://QmTestAgentRegistrationFile";
    bytes memory userData = _buildUserDataWithURI(ACTION_REGISTER, 0, uri);
    _registerViaHub(HUMAN_ADDR, NULLIFIER_1, userData);

    assertEq(registry.tokenURI(1), uri);
}

function test_agentURIEmptyWhenNoneProvided() public {
    bytes memory userData = _buildUserData(ACTION_REGISTER, 0);
    _registerViaHub(HUMAN_ADDR, NULLIFIER_1, userData);

    assertEq(registry.tokenURI(1), "");
}
```

**Step 2: Run to confirm they fail**

```bash
cd contracts && forge test --match-test "test_registered\|test_agentURI" --evm-version paris -vvv
```
Expected: FAIL — `Registered` event not found, `tokenURI` returns empty.

**Step 3: Implement in `SelfAgentRegistry.sol`**

Add to storage section (after `agentNonces` mapping):
```solidity
/// @notice Maps agentId to the agent URI (ERC-8004 registration file location)
mapping(uint256 => string) private _agentURIs;
```

Add event (in the Events section):
```solidity
/// @notice ERC-8004 required: emitted on every agent registration
event Registered(uint256 indexed agentId, string agentURI, address indexed owner);
```

Update `_mintAgent()` — add the URI parameter and emit event. Change signature:
```solidity
function _mintAgent(
    uint256 nullifier,
    bytes32 agentKey,
    address proofProvider,
    address to,
    string memory agentURI    // <-- add this
) internal returns (uint256 agentId) {
    // ... existing code unchanged until after _mint() call ...
    _mint(to, agentId);

    // Store URI and emit ERC-8004 required event
    if (bytes(agentURI).length > 0) {
        _agentURIs[agentId] = agentURI;
    }
    emit Registered(agentId, agentURI, to);

    // ... rest of existing storage assignments unchanged ...
}
```

Update `tokenURI()` override:
```solidity
function tokenURI(uint256 tokenId) public view override returns (string memory) {
    _requireOwned(tokenId);
    return _agentURIs[tokenId];
}
```

Update userData encoding in `customVerificationHook` — the URI is appended after the action+config bytes as a length-prefixed UTF-8 string. Update `_registerAgent()` and `_registerAgentWalletFree()` to extract and pass the URI to `_mintAgent()`.

In `registerWithHumanProof()` — the first parameter was unnamed (discarded). Name it and store it:
```solidity
function registerWithHumanProof(
    string calldata agentURI,    // was unnamed, now stored
    address proofProvider,
    bytes calldata proof,
    bytes calldata providerData
) external override returns (uint256) {
    // ... existing check + verify ...
    uint256 agentId = _mintAgent(nullifier, agentKey, proofProvider, msg.sender, agentURI);
    return agentId;
}
```

**Step 4: Run tests to confirm they pass**

```bash
forge test --match-test "test_registered\|test_agentURI" --evm-version paris -vvv
```
Expected: PASS

**Step 5: Commit**

```bash
git add contracts/src/SelfAgentRegistry.sol contracts/test/SelfAgentRegistry.t.sol
git commit -m "feat: add agentURI storage and Registered event for ERC-8004 compliance"
```

---

### Task 2: `setAgentURI()` + `URIUpdated` Event

Agents need to update their registration file URI (e.g., when services change or they go inactive). Only the NFT owner can update.

**Files:**
- Modify: `contracts/src/SelfAgentRegistry.sol`
- Modify: `contracts/test/SelfAgentRegistry.t.sol`

**Step 1: Write the failing tests**

```solidity
function test_setAgentURIUpdatesURI() public {
    _registerViaHub(HUMAN_ADDR, NULLIFIER_1, _buildUserData(ACTION_REGISTER, 0));
    string memory newURI = "ipfs://QmUpdatedRegistrationFile";

    vm.prank(HUMAN_ADDR);
    registry.setAgentURI(1, newURI);

    assertEq(registry.tokenURI(1), newURI);
}

function test_setAgentURIEmitsURIUpdated() public {
    _registerViaHub(HUMAN_ADDR, NULLIFIER_1, _buildUserData(ACTION_REGISTER, 0));

    vm.expectEmit(true, false, true, true);
    emit URIUpdated(1, "ipfs://QmNew", HUMAN_ADDR);

    vm.prank(HUMAN_ADDR);
    registry.setAgentURI(1, "ipfs://QmNew");
}

function test_setAgentURIRevertsIfNotOwner() public {
    _registerViaHub(HUMAN_ADDR, NULLIFIER_1, _buildUserData(ACTION_REGISTER, 0));

    vm.prank(address(0xBEEF));
    vm.expectRevert(abi.encodeWithSelector(SelfAgentRegistry.NotNftOwner.selector, 1));
    registry.setAgentURI(1, "ipfs://QmNew");
}
```

**Step 2: Run to confirm they fail**

```bash
forge test --match-test "test_setAgentURI" --evm-version paris -vvv
```

**Step 3: Implement**

Add event:
```solidity
/// @notice ERC-8004 required: emitted when agent URI is updated
event URIUpdated(uint256 indexed agentId, string newURI, address indexed updatedBy);
```

Add function:
```solidity
/// @notice Update the agent URI (ERC-8004 required)
/// @dev Only callable by the current owner of the agent NFT
function setAgentURI(uint256 agentId, string calldata newURI) external {
    if (msg.sender != ownerOf(agentId)) revert NotNftOwner(agentId);
    _agentURIs[agentId] = newURI;
    emit URIUpdated(agentId, newURI, msg.sender);
}
```

**Step 4: Run tests**

```bash
forge test --match-test "test_setAgentURI" --evm-version paris -vvv
```

**Step 5: Commit**

```bash
git add contracts/src/SelfAgentRegistry.sol contracts/test/SelfAgentRegistry.t.sol
git commit -m "feat: add setAgentURI and URIUpdated event for ERC-8004 compliance"
```

---

### Task 3: Three `register()` Overloads

ERC-8004 requires these three function signatures to exist. We implement them as opt-in "registration without proof" gated by a `requireHumanProof` flag (default: `true`). This means our deployment always reverts these with `ProofRequired()`, satisfying the interface while preserving our sybil-resistance guarantee. Other deployers can set `requireHumanProof = false` for permissive registries.

**Files:**
- Modify: `contracts/src/SelfAgentRegistry.sol`
- Modify: `contracts/test/SelfAgentRegistry.t.sol`

**Step 1: Write the failing tests**

```solidity
function test_registerOverloadRevertsWhenProofRequired() public {
    // Default: requireHumanProof = true
    vm.expectRevert(SelfAgentRegistry.ProofRequired.selector);
    registry.register();
}

function test_registerWithURIOverloadRevertsWhenProofRequired() public {
    vm.expectRevert(SelfAgentRegistry.ProofRequired.selector);
    registry.register("ipfs://QmTest");
}

function test_registerWithURIAndMetadataRevertsWhenProofRequired() public {
    SelfAgentRegistry.MetadataEntry[] memory meta = new SelfAgentRegistry.MetadataEntry[](0);
    vm.expectRevert(SelfAgentRegistry.ProofRequired.selector);
    registry.register("ipfs://QmTest", meta);
}

function test_registerOverloadWorksWhenProofNotRequired() public {
    vm.prank(registry.owner());
    registry.setRequireHumanProof(false);

    vm.prank(address(0xCAFE));
    uint256 agentId = registry.register("ipfs://QmTest");
    assertEq(agentId, 1);
    assertFalse(registry.hasHumanProof(agentId)); // No proof attached
}
```

**Step 2: Run to confirm they fail**

```bash
forge test --match-test "test_register" --evm-version paris -vvv
```

**Step 3: Implement**

Add error:
```solidity
error ProofRequired();
```

Add storage + admin function:
```solidity
/// @notice When true, the base register() overloads revert — all registration requires human proof
/// @dev Set to false only for non-sybil-resistant deployments
bool public requireHumanProof = true;

function setRequireHumanProof(bool required) external onlyOwner {
    requireHumanProof = required;
}
```

Add `MetadataEntry` struct (in the structs section, NOT inside `AgentCredentials`):
```solidity
/// @notice ERC-8004 required: key-value metadata entry for batch registration
struct MetadataEntry {
    string metadataKey;
    bytes metadataValue;
}
```

Add the three register overloads:
```solidity
/// @notice ERC-8004 required: register with URI and metadata
/// @dev Reverts with ProofRequired() unless requireHumanProof is false
function register(
    string calldata agentURI,
    MetadataEntry[] calldata metadata
) external returns (uint256 agentId) {
    if (requireHumanProof) revert ProofRequired();
    agentId = _baseRegister(msg.sender, agentURI);
    for (uint256 i = 0; i < metadata.length; i++) {
        _setMetadataInternal(agentId, metadata[i].metadataKey, metadata[i].metadataValue);
    }
}

/// @notice ERC-8004 required: register with URI
function register(string calldata agentURI) external returns (uint256 agentId) {
    if (requireHumanProof) revert ProofRequired();
    return _baseRegister(msg.sender, agentURI);
}

/// @notice ERC-8004 required: register with no URI (URI set later via setAgentURI)
function register() external returns (uint256 agentId) {
    if (requireHumanProof) revert ProofRequired();
    return _baseRegister(msg.sender, "");
}

/// @notice Internal base registration without proof
function _baseRegister(address to, string memory agentURI) internal returns (uint256 agentId) {
    agentId = _nextAgentId++;
    _mint(to, agentId);
    if (bytes(agentURI).length > 0) _agentURIs[agentId] = agentURI;
    emit Registered(agentId, agentURI, to);
}
```

**Step 4: Run tests**

```bash
forge test --match-test "test_register" --evm-version paris -vvv
```

**Step 5: Commit**

```bash
git add contracts/src/SelfAgentRegistry.sol contracts/test/SelfAgentRegistry.t.sol
git commit -m "feat: add three register() overloads with requireHumanProof guard"
```

---

### Task 4: Key-Value Metadata Store + `MetadataSet` Event

ERC-8004 requires an on-chain key-value metadata store per agent. `agentWallet` is a **reserved key** — it cannot be set via `setMetadata()` (it has its own dedicated function added in Task 5).

**Files:**
- Modify: `contracts/src/SelfAgentRegistry.sol`
- Modify: `contracts/test/SelfAgentRegistry.t.sol`

**Step 1: Write the failing tests**

```solidity
function test_setAndGetMetadata() public {
    _registerViaHub(HUMAN_ADDR, NULLIFIER_1, _buildUserData(ACTION_REGISTER, 0));

    vm.prank(HUMAN_ADDR);
    registry.setMetadata(1, "capabilities", abi.encode("text-generation,code"));

    bytes memory val = registry.getMetadata(1, "capabilities");
    assertEq(abi.decode(val, (string)), "text-generation,code");
}

function test_setMetadataEmitsMetadataSet() public {
    _registerViaHub(HUMAN_ADDR, NULLIFIER_1, _buildUserData(ACTION_REGISTER, 0));
    bytes memory val = abi.encode("test-value");

    vm.expectEmit(true, true, false, true);
    emit MetadataSet(1, "myKey", "myKey", val);

    vm.prank(HUMAN_ADDR);
    registry.setMetadata(1, "myKey", val);
}

function test_setMetadataRevertsForReservedAgentWalletKey() public {
    _registerViaHub(HUMAN_ADDR, NULLIFIER_1, _buildUserData(ACTION_REGISTER, 0));

    vm.prank(HUMAN_ADDR);
    vm.expectRevert(SelfAgentRegistry.ReservedMetadataKey.selector);
    registry.setMetadata(1, "agentWallet", abi.encode(address(0xBEEF)));
}

function test_setMetadataRevertsIfNotOwner() public {
    _registerViaHub(HUMAN_ADDR, NULLIFIER_1, _buildUserData(ACTION_REGISTER, 0));

    vm.prank(address(0xBEEF));
    vm.expectRevert(abi.encodeWithSelector(SelfAgentRegistry.NotNftOwner.selector, 1));
    registry.setMetadata(1, "key", bytes("val"));
}

function test_getMetadataReturnsEmptyForUnsetKey() public {
    _registerViaHub(HUMAN_ADDR, NULLIFIER_1, _buildUserData(ACTION_REGISTER, 0));
    assertEq(registry.getMetadata(1, "nonexistent").length, 0);
}
```

**Step 2: Run to confirm they fail**

```bash
forge test --match-test "test_setAndGetMetadata\|test_setMetadata\|test_getMetadata" --evm-version paris -vvv
```

**Step 3: Implement**

Add error:
```solidity
error ReservedMetadataKey();
```

Add storage (after `_agentURIs`):
```solidity
/// @notice ERC-8004 required: key-value metadata store per agent
mapping(uint256 => mapping(string => bytes)) private _metadata;

bytes32 private constant _RESERVED_AGENT_WALLET_KEY_HASH = keccak256("agentWallet");
```

Add event:
```solidity
/// @notice ERC-8004 required: emitted when metadata is set
event MetadataSet(
    uint256 indexed agentId,
    string indexed indexedMetadataKey,
    string metadataKey,
    bytes metadataValue
);
```

Add functions:
```solidity
/// @notice ERC-8004 required: get metadata value for a key
function getMetadata(uint256 agentId, string memory metadataKey) external view returns (bytes memory) {
    return _metadata[agentId][metadataKey];
}

/// @notice ERC-8004 required: set metadata value for a key
/// @dev agentWallet is reserved — use setAgentWallet() instead
function setMetadata(uint256 agentId, string calldata metadataKey, bytes calldata metadataValue) external {
    if (msg.sender != ownerOf(agentId)) revert NotNftOwner(agentId);
    if (keccak256(bytes(metadataKey)) == _RESERVED_AGENT_WALLET_KEY_HASH) revert ReservedMetadataKey();
    _setMetadataInternal(agentId, metadataKey, metadataValue);
}

/// @dev Internal setter used by register() overloads (bypasses owner check)
function _setMetadataInternal(uint256 agentId, string memory metadataKey, bytes memory metadataValue) internal {
    _metadata[agentId][metadataKey] = metadataValue;
    emit MetadataSet(agentId, metadataKey, metadataKey, metadataValue);
}
```

**Step 4: Run tests**

```bash
forge test --match-test "test_setAndGetMetadata\|test_setMetadata\|test_getMetadata" --evm-version paris -vvv
```

**Step 5: Commit**

```bash
git add contracts/src/SelfAgentRegistry.sol contracts/test/SelfAgentRegistry.t.sol
git commit -m "feat: add key-value metadata store and MetadataSet event for ERC-8004 compliance"
```

---

### Task 5: Agent Wallet (`setAgentWallet` / `getAgentWallet` / `unsetAgentWallet`)

The agent wallet is a payment address separate from the NFT owner (e.g., the NFT is held by the human's hardware wallet, but the agent's operational wallet receives payments). Requires EIP-712 signature from the wallet address to prove control. Since our tokens are soulbound, the auto-clearing on transfer doesn't apply — but we implement the functions fully.

**Files:**
- Modify: `contracts/src/SelfAgentRegistry.sol`
- Modify: `contracts/test/SelfAgentRegistry.t.sol`

**Step 1: Write the failing tests**

```solidity
function test_setAgentWalletStoresWallet() public {
    _registerViaHub(HUMAN_ADDR, NULLIFIER_1, _buildUserData(ACTION_REGISTER, 0));

    address wallet = address(0xWALLET);
    uint256 deadline = block.timestamp + 1 hours;
    bytes memory sig = _signAgentWalletSet(HUMAN_PRIVATE_KEY, 1, wallet, HUMAN_ADDR, deadline);

    vm.prank(HUMAN_ADDR);
    registry.setAgentWallet(1, wallet, deadline, sig);

    assertEq(registry.getAgentWallet(1), wallet);
}

function test_setAgentWalletRevertsOnExpiredDeadline() public {
    _registerViaHub(HUMAN_ADDR, NULLIFIER_1, _buildUserData(ACTION_REGISTER, 0));

    uint256 deadline = block.timestamp - 1;
    bytes memory sig = _signAgentWalletSet(WALLET_PRIVATE_KEY, 1, WALLET_ADDR, HUMAN_ADDR, deadline);

    vm.prank(HUMAN_ADDR);
    vm.expectRevert(SelfAgentRegistry.DeadlineExpired.selector);
    registry.setAgentWallet(1, WALLET_ADDR, deadline, sig);
}

function test_setAgentWalletRevertsOnBadSignature() public {
    _registerViaHub(HUMAN_ADDR, NULLIFIER_1, _buildUserData(ACTION_REGISTER, 0));

    vm.prank(HUMAN_ADDR);
    vm.expectRevert(SelfAgentRegistry.InvalidWalletSignature.selector);
    registry.setAgentWallet(1, WALLET_ADDR, block.timestamp + 1 hours, bytes("bad-sig"));
}

function test_unsetAgentWalletClearsWallet() public {
    // ... set wallet first, then unset ...
    vm.prank(HUMAN_ADDR);
    registry.unsetAgentWallet(1);
    assertEq(registry.getAgentWallet(1), address(0));
}

function test_getAgentWalletReturnsZeroWhenUnset() public {
    _registerViaHub(HUMAN_ADDR, NULLIFIER_1, _buildUserData(ACTION_REGISTER, 0));
    assertEq(registry.getAgentWallet(1), address(0));
}
```

**Step 2: Run to confirm they fail**

```bash
forge test --match-test "test_setAgentWallet\|test_getAgentWallet\|test_unsetAgentWallet" --evm-version paris -vvv
```

**Step 3: Implement**

Add imports (already has EIP712 via AgentDemoVerifier, add to SelfAgentRegistry):
```solidity
import { EIP712 } from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
```

Update contract declaration:
```solidity
contract SelfAgentRegistry is ERC721, EIP712, Ownable, SelfVerificationRoot, IERC8004ProofOfHuman {
```

Update constructor:
```solidity
constructor(address hubV2, address initialOwner)
    ERC721("Self Agent ID", "SAID")
    EIP712("SelfAgentRegistry", "1")
    Ownable(initialOwner)
    SelfVerificationRoot(hubV2, "self-agent-id")
{
```

Add errors:
```solidity
error DeadlineExpired();
error InvalidWalletSignature();
```

Add constant:
```solidity
bytes32 private constant _AGENT_WALLET_SET_TYPEHASH = keccak256(
    "AgentWalletSet(uint256 agentId,address newWallet,address owner,uint256 deadline)"
);
```

Add functions:
```solidity
/// @notice ERC-8004 required: set agent payment wallet with EIP-712 proof of wallet control
function setAgentWallet(
    uint256 agentId,
    address newWallet,
    uint256 deadline,
    bytes calldata signature
) external {
    if (msg.sender != ownerOf(agentId)) revert NotNftOwner(agentId);
    if (block.timestamp > deadline) revert DeadlineExpired();

    bytes32 structHash = keccak256(abi.encode(
        _AGENT_WALLET_SET_TYPEHASH,
        agentId,
        newWallet,
        msg.sender,
        deadline
    ));
    bytes32 digest = _hashTypedDataV4(structHash);
    address recovered = ECDSA.recover(digest, signature);
    if (recovered != newWallet) revert InvalidWalletSignature();

    _setMetadataInternal(agentId, "agentWallet", abi.encode(newWallet));
}

/// @notice ERC-8004 required: get the agent payment wallet address
function getAgentWallet(uint256 agentId) external view returns (address) {
    bytes memory raw = _metadata[agentId]["agentWallet"];
    if (raw.length == 0) return address(0);
    return abi.decode(raw, (address));
}

/// @notice ERC-8004 required: clear the agent wallet
function unsetAgentWallet(uint256 agentId) external {
    if (msg.sender != ownerOf(agentId)) revert NotNftOwner(agentId);
    delete _metadata[agentId]["agentWallet"];
    emit MetadataSet(agentId, "agentWallet", "agentWallet", bytes(""));
}
```

**Step 4: Run tests**

```bash
forge test --match-test "test_setAgentWallet\|test_getAgentWallet\|test_unsetAgentWallet" --evm-version paris -vvv
```

**Step 5: Commit**

```bash
git add contracts/src/SelfAgentRegistry.sol contracts/test/SelfAgentRegistry.t.sol
git commit -m "feat: add setAgentWallet/getAgentWallet/unsetAgentWallet with EIP-712 for ERC-8004 compliance"
```

---

### Task 6: ERC-165 `supportsInterface()`

Consumers use ERC-165 interface detection to discover capabilities. We need to declare support for both the ERC-8004 base interface and our proof-of-human extension.

**Files:**
- Modify: `contracts/src/interfaces/IERC8004ProofOfHuman.sol`
- Modify: `contracts/src/SelfAgentRegistry.sol`
- Modify: `contracts/test/SelfAgentRegistry.t.sol`

**Step 1: Write the failing tests**

```solidity
function test_supportsERC165() public view {
    assertTrue(registry.supportsInterface(0x01ffc9a7)); // ERC-165 itself
}

function test_supportsERC721() public view {
    assertTrue(registry.supportsInterface(0x80ac58cd)); // ERC-721
}

function test_supportsERC8004ProofOfHuman() public view {
    bytes4 id = type(IERC8004ProofOfHuman).interfaceId;
    assertTrue(registry.supportsInterface(id));
}

function test_doesNotSupportRandomInterface() public view {
    assertFalse(registry.supportsInterface(0xdeadbeef));
}
```

**Step 2: Run to confirm they fail**

```bash
forge test --match-test "test_supports" --evm-version paris -vvv
```

**Step 3: Implement**

Add to `SelfAgentRegistry.sol`:
```solidity
import { IERC165 } from "@openzeppelin/contracts/utils/introspection/IERC165.sol";

function supportsInterface(bytes4 interfaceId) public view override returns (bool) {
    return
        interfaceId == type(IERC8004ProofOfHuman).interfaceId ||
        super.supportsInterface(interfaceId);
}
```

**Step 4: Run tests**

```bash
forge test --match-test "test_supports" --evm-version paris -vvv
```

**Step 5: Run full test suite to catch any regressions**

```bash
./scripts/test.sh
```
Expected: All existing tests still pass.

**Step 6: Commit**

```bash
git add contracts/src/SelfAgentRegistry.sol contracts/src/interfaces/IERC8004ProofOfHuman.sol contracts/test/SelfAgentRegistry.t.sol
git commit -m "feat: add ERC-165 supportsInterface for ERC-8004 and ProofOfHuman interfaces"
```

---

## Phase 2: Proof Expiry System

### Task 7: `proofExpiresAt` Storage + `maxProofAge`

Add first-class expiry tracking. The expiry is the minimum of: the document's own expiry date (already stored in `AgentCredentials.expiryDate`) and `block.timestamp + maxProofAge`. This means a passport expiring in 3 months won't be valid beyond 3 months even if `maxProofAge` is 1 year.

**Files:**
- Modify: `contracts/src/SelfAgentRegistry.sol`
- Modify: `contracts/src/interfaces/IERC8004ProofOfHuman.sol`
- Modify: `contracts/test/SelfAgentRegistry.t.sol`

**Step 1: Write the failing tests**

```solidity
function test_proofExpiresAtSetOnRegistration() public {
    _registerViaHub(HUMAN_ADDR, NULLIFIER_1, _buildUserData(ACTION_REGISTER, 0));

    uint256 expiry = registry.proofExpiresAt(1);
    // Should be approximately now + 1 year (default maxProofAge)
    assertApproxEqAbs(expiry, block.timestamp + 365 days, 60); // within 1 minute
}

function test_proofExpiresAtCappedByDocumentExpiry() public {
    // Register with a document that expires in 30 days
    bytes memory userData = _buildUserDataWithDocExpiry(ACTION_REGISTER, 0, block.timestamp + 30 days);
    _registerViaHub(HUMAN_ADDR, NULLIFIER_1, userData);

    uint256 expiry = registry.proofExpiresAt(1);
    assertApproxEqAbs(expiry, block.timestamp + 30 days, 60);
}

function test_hasHumanProofReturnsFalseAfterExpiry() public {
    _registerViaHub(HUMAN_ADDR, NULLIFIER_1, _buildUserData(ACTION_REGISTER, 0));
    assertTrue(registry.hasHumanProof(1));

    vm.warp(block.timestamp + 366 days); // past maxProofAge
    assertFalse(registry.hasHumanProof(1));
}

function test_isProofFreshReturnsFalseAfterExpiry() public {
    _registerViaHub(HUMAN_ADDR, NULLIFIER_1, _buildUserData(ACTION_REGISTER, 0));
    assertTrue(registry.isProofFresh(1));

    vm.warp(block.timestamp + 366 days);
    assertFalse(registry.isProofFresh(1));
}

function test_setMaxProofAgeUpdatesValue() public {
    vm.prank(registry.owner());
    registry.setMaxProofAge(180 days);
    assertEq(registry.maxProofAge(), 180 days);
}
```

**Step 2: Run to confirm they fail**

```bash
forge test --match-test "test_proofExpires\|test_isProofFresh\|test_hasHumanProof.*expiry\|test_setMaxProofAge" --evm-version paris -vvv
```

**Step 3: Implement**

Add storage:
```solidity
/// @notice Maximum age of a human proof before reauthentication is required (default: 1 year)
uint256 public maxProofAge = 365 days;

/// @notice Maps agentId to proof expiry timestamp (unix seconds)
mapping(uint256 => uint256) public proofExpiresAt;
```

Add event:
```solidity
event MaxProofAgeUpdated(uint256 newMaxProofAge);
```

Add admin function:
```solidity
function setMaxProofAge(uint256 newMaxProofAge) external onlyOwner {
    maxProofAge = newMaxProofAge;
    emit MaxProofAgeUpdated(newMaxProofAge);
}
```

Update `hasHumanProof()`:
```solidity
function hasHumanProof(uint256 agentId) external view override returns (bool) {
    return agentHasHumanProof[agentId] && block.timestamp < proofExpiresAt[agentId];
}
```

Add `isProofFresh()`:
```solidity
/// @notice Check if the proof is still within its validity window
function isProofFresh(uint256 agentId) external view returns (bool) {
    return agentHasHumanProof[agentId] && block.timestamp < proofExpiresAt[agentId];
}
```

Add helper to parse YYMMDD date string to unix timestamp:
```solidity
/// @dev Parse "YYMMDD" string to unix timestamp. Returns 0 if invalid/empty.
function _parseYYMMDDToTimestamp(string memory dateStr) internal pure returns (uint256) {
    bytes memory d = bytes(dateStr);
    if (d.length != 6) return 0;
    uint256 yy = (uint8(d[0]) - 48) * 10 + (uint8(d[1]) - 48);
    uint256 mm = (uint8(d[2]) - 48) * 10 + (uint8(d[3]) - 48);
    uint256 dd = (uint8(d[4]) - 48) * 10 + (uint8(d[5]) - 48);
    // Years 00-49 map to 2000-2049; 50-99 map to 1950-1999 (passport convention)
    uint256 year = yy < 50 ? 2000 + yy : 1900 + yy;
    // Simple approximation: days since unix epoch
    // Use a lookup or known-good formula for production; this is sufficient for yearly granularity
    uint256 daysSinceEpoch = (year - 1970) * 365 + (year - 1969) / 4 + _daysInMonths(year, mm) + dd - 1;
    return daysSinceEpoch * 1 days;
}
```

Update `_storeCredentials()` to also set `proofExpiresAt`:
```solidity
function _storeCredentials(uint256 agentId, ISelfVerificationRoot.GenericDiscloseOutputV2 memory output) internal {
    // ... existing credential storage unchanged ...

    // Set proof expiry: min(document expiry, now + maxProofAge)
    uint256 docExpiry = _parseYYMMDDToTimestamp(output.expiryDate);
    uint256 ageExpiry = block.timestamp + maxProofAge;
    proofExpiresAt[agentId] = (docExpiry > 0 && docExpiry < ageExpiry) ? docExpiry : ageExpiry;

    emit AgentCredentialsStored(agentId);
}
```

Update `IERC8004ProofOfHuman.sol` — add `isProofFresh()` and `proofExpiresAt()` to the interface:
```solidity
/// @notice Returns the unix timestamp after which this agent's proof is no longer valid
function proofExpiresAt(uint256 agentId) external view returns (uint256);

/// @notice Returns true if the agent has a human proof that is still within its validity window
function isProofFresh(uint256 agentId) external view returns (bool);
```

**Step 4: Run tests**

```bash
forge test --match-test "test_proofExpires\|test_isProofFresh\|test_setMaxProofAge" --evm-version paris -vvv
```

**Step 5: Run full suite**

```bash
./scripts/test.sh
```

**Step 6: Commit**

```bash
git add contracts/src/SelfAgentRegistry.sol contracts/src/interfaces/IERC8004ProofOfHuman.sol contracts/test/SelfAgentRegistry.t.sol
git commit -m "feat: add proofExpiresAt expiry system with maxProofAge and document expiry capping"
```

---

## Phase 3: Reputation Registry

### Task 8: `SelfReputationRegistry` Contract

Replace `SelfReputationProvider.sol` with a full ERC-8004 Reputation Registry scoped to our identity registry. At agent registration, the registry auto-submits a high-authority feedback entry from itself (Self Protocol as a trusted client). Rename the old file.

**Files:**
- Create: `contracts/src/SelfReputationRegistry.sol`
- Create: `contracts/src/interfaces/ISelfReputationRegistry.sol`
- Rename: `contracts/src/SelfReputationProvider.sol` → `contracts/src/SelfReputationSignal.sol` (keep as legacy read adapter)
- Modify: `contracts/src/SelfAgentRegistry.sol` (add auto-feedback hook)
- Create: `contracts/test/SelfReputationRegistry.t.sol`
- Modify: `contracts/script/DeployProviders.s.sol`

**Step 1: Write the failing tests**

Create `contracts/test/SelfReputationRegistry.t.sol`:

```solidity
// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import { Test } from "forge-std/Test.sol";
import { SelfReputationRegistry } from "../src/SelfReputationRegistry.sol";
import { SelfAgentRegistry } from "../src/SelfAgentRegistry.sol";

contract SelfReputationRegistryTest is Test {
    SelfReputationRegistry internal rep;
    SelfAgentRegistry internal registry;

    function setUp() public {
        // Deploy registry (use LocalRegistryHarness for isolation)
        // ...
        rep = new SelfReputationRegistry(address(registry));
    }

    function test_getIdentityRegistry() public view {
        assertEq(rep.getIdentityRegistry(), address(registry));
    }

    function test_giveFeedbackStoresFeedback() public {
        uint256 agentId = _mintTestAgent();
        address client = address(0xC1);

        vm.prank(client);
        rep.giveFeedback(agentId, 9977, 2, "proof-of-human", "", "", "", bytes32(0));

        (int128 val, uint8 dec, string memory t1, string memory t2, bool revoked) =
            rep.readFeedback(agentId, client, 1);
        assertEq(val, 9977);
        assertEq(dec, 2);
        assertEq(t1, "proof-of-human");
        assertFalse(revoked);
    }

    function test_giveFeedbackRevertsIfSelfFeedback() public {
        uint256 agentId = _mintTestAgent();

        vm.prank(AGENT_OWNER);  // agent owner
        vm.expectRevert("Self-feedback not allowed");
        rep.giveFeedback(agentId, 100, 0, "", "", "", "", bytes32(0));
    }

    function test_revokeFeedback() public {
        uint256 agentId = _mintTestAgent();
        address client = address(0xC1);
        vm.prank(client);
        rep.giveFeedback(agentId, 80, 0, "", "", "", "", bytes32(0));

        vm.prank(client);
        rep.revokeFeedback(agentId, 1);

        (, , , , bool revoked) = rep.readFeedback(agentId, client, 1);
        assertTrue(revoked);
    }

    function test_getSummaryFiltersToClientAddresses() public {
        uint256 agentId = _mintTestAgent();
        address clientA = address(0xA);
        address clientB = address(0xB);

        vm.prank(clientA);
        rep.giveFeedback(agentId, 100, 0, "", "", "", "", bytes32(0));
        vm.prank(clientB);
        rep.giveFeedback(agentId, 50, 0, "", "", "", "", bytes32(0));

        address[] memory filter = new address[](1);
        filter[0] = clientA;
        (uint64 count, int128 val, uint8 dec) = rep.getSummary(agentId, filter, "", "");
        assertEq(count, 1);
        assertEq(val, 100);
    }

    function test_getSummaryRevertsWithEmptyClientAddresses() public {
        uint256 agentId = _mintTestAgent();
        address[] memory empty = new address[](0);
        vm.expectRevert("clientAddresses required");
        rep.getSummary(agentId, empty, "", "");
    }

    function test_autoFeedbackEmittedOnAgentRegistration() public {
        // When SelfAgentRegistry registers an agent with rep registry linked,
        // a proof-of-human feedback entry should be auto-submitted
        // ...
    }
}
```

**Step 2: Run to confirm they fail**

```bash
forge test --match-path "test/SelfReputationRegistry.t.sol" --evm-version paris -vvv
```

**Step 3: Implement `SelfReputationRegistry.sol`**

Create `contracts/src/SelfReputationRegistry.sol`. Mirror the structure of the canonical `ReputationRegistryUpgradeable.sol` but as a non-upgradeable contract scoped to our registry. Key differences: no UUPS proxy, our `IIdentityRegistry` interface uses `ownerOf` + `isApprovedForAll` from our `SelfAgentRegistry`.

```solidity
// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import { Ownable } from "@openzeppelin/contracts/access/Ownable.sol";
import { ISelfAgentRegistryReader } from "./interfaces/ISelfAgentRegistryReader.sol";

/// @title SelfReputationRegistry
/// @notice ERC-8004 compliant Reputation Registry scoped to SelfAgentRegistry.
///         Self Protocol is a high-authority feedback source: every proof-of-human
///         registration automatically generates a Self-attested feedback entry.
contract SelfReputationRegistry is Ownable {

    // ---- ERC-8004 required events ----
    event NewFeedback(
        uint256 indexed agentId,
        address indexed clientAddress,
        uint64 feedbackIndex,
        int128 value,
        uint8 valueDecimals,
        string indexed indexedTag1,
        string tag1,
        string tag2,
        string endpoint,
        string feedbackURI,
        bytes32 feedbackHash
    );
    event FeedbackRevoked(uint256 indexed agentId, address indexed clientAddress, uint64 indexed feedbackIndex);
    event ResponseAppended(
        uint256 indexed agentId,
        address indexed clientAddress,
        uint64 feedbackIndex,
        address indexed responder,
        string responseURI,
        bytes32 responseHash
    );

    struct Feedback {
        int128 value;
        uint8 valueDecimals;
        bool isRevoked;
        string tag1;
        string tag2;
    }

    int128 private constant MAX_ABS_VALUE = 1e38;

    address private immutable _identityRegistry;

    // agentId => clientAddress => feedbackIndex (1-indexed) => Feedback
    mapping(uint256 => mapping(address => mapping(uint64 => Feedback))) private _feedback;
    // agentId => clientAddress => last index
    mapping(uint256 => mapping(address => uint64)) private _lastIndex;
    // agentId => unique client list
    mapping(uint256 => address[]) private _clients;
    mapping(uint256 => mapping(address => bool)) private _clientExists;
    // feedbackIndex response tracking
    mapping(uint256 => mapping(address => mapping(uint64 => uint64))) private _responseCount;

    constructor(address identityRegistry_, address initialOwner) Ownable(initialOwner) {
        require(identityRegistry_ != address(0), "bad identity");
        _identityRegistry = identityRegistry_;
    }

    // ---- ERC-8004 required ----
    function getIdentityRegistry() external view returns (address) { return _identityRegistry; }

    function giveFeedback(
        uint256 agentId,
        int128 value,
        uint8 valueDecimals,
        string calldata tag1,
        string calldata tag2,
        string calldata endpoint,
        string calldata feedbackURI,
        bytes32 feedbackHash
    ) external {
        require(valueDecimals <= 18, "too many decimals");
        require(value >= -MAX_ABS_VALUE && value <= MAX_ABS_VALUE, "value too large");
        // Prevent self-feedback (reverts with ERC721NonexistentToken if agent doesn't exist)
        require(
            !ISelfAgentRegistryFull(_identityRegistry).isAuthorizedOrOwner(msg.sender, agentId),
            "Self-feedback not allowed"
        );
        _recordFeedback(agentId, msg.sender, value, valueDecimals, tag1, tag2, endpoint, feedbackURI, feedbackHash);
    }

    /// @dev Internal path used by SelfAgentRegistry for auto proof-of-human feedback
    function recordHumanProofFeedback(uint256 agentId) external {
        require(msg.sender == _identityRegistry, "only identity registry");
        _recordFeedback(agentId, msg.sender, 100, 0, "proof-of-human", "passport-nfc", "", "", bytes32(0));
    }

    function revokeFeedback(uint256 agentId, uint64 feedbackIndex) external {
        Feedback storage fb = _feedback[agentId][msg.sender][feedbackIndex];
        require(feedbackIndex > 0 && feedbackIndex <= _lastIndex[agentId][msg.sender], "bad index");
        require(!fb.isRevoked, "already revoked");
        fb.isRevoked = true;
        emit FeedbackRevoked(agentId, msg.sender, feedbackIndex);
    }

    function appendResponse(
        uint256 agentId,
        address clientAddress,
        uint64 feedbackIndex,
        string calldata responseURI,
        bytes32 responseHash
    ) external {
        require(
            ISelfAgentRegistryFull(_identityRegistry).isAuthorizedOrOwner(msg.sender, agentId),
            "not agent owner"
        );
        _responseCount[agentId][clientAddress][feedbackIndex]++;
        emit ResponseAppended(agentId, clientAddress, feedbackIndex, msg.sender, responseURI, responseHash);
    }

    function readFeedback(uint256 agentId, address clientAddress, uint64 feedbackIndex)
        external view returns (int128 value, uint8 valueDecimals, string memory tag1, string memory tag2, bool isRevoked)
    {
        Feedback storage fb = _feedback[agentId][clientAddress][feedbackIndex];
        return (fb.value, fb.valueDecimals, fb.tag1, fb.tag2, fb.isRevoked);
    }

    function getSummary(
        uint256 agentId,
        address[] calldata clientAddresses,
        string calldata tag1,
        string calldata tag2
    ) external view returns (uint64 count, int128 summaryValue, uint8 summaryValueDecimals) {
        require(clientAddresses.length > 0, "clientAddresses required");
        // ... iterate clientAddresses, sum non-revoked feedback matching tags ...
        // (standard weighted sum implementation matching canonical contract behavior)
    }

    function getClients(uint256 agentId) external view returns (address[] memory) {
        return _clients[agentId];
    }

    function getLastIndex(uint256 agentId, address clientAddress) external view returns (uint64) {
        return _lastIndex[agentId][clientAddress];
    }

    function readAllFeedback(
        uint256 agentId,
        address[] calldata clientAddresses,
        string calldata tag1,
        string calldata tag2,
        bool includeRevoked
    ) external view returns (
        address[] memory clients,
        uint64[] memory feedbackIndexes,
        int128[] memory values,
        uint8[] memory valueDecimals,
        string[] memory tag1s,
        string[] memory tag2s,
        bool[] memory revokedStatuses
    ) { /* ... */ }

    function getResponseCount(uint256 agentId, address clientAddress, uint64 feedbackIndex, address[] calldata)
        external view returns (uint64) {
        return _responseCount[agentId][clientAddress][feedbackIndex];
    }

    function _recordFeedback(
        uint256 agentId, address client,
        int128 value, uint8 valueDecimals,
        string memory tag1, string memory tag2,
        string memory endpoint, string memory feedbackURI, bytes32 feedbackHash
    ) internal {
        if (!_clientExists[agentId][client]) {
            _clients[agentId].push(client);
            _clientExists[agentId][client] = true;
        }
        uint64 idx = ++_lastIndex[agentId][client];
        _feedback[agentId][client][idx] = Feedback(value, valueDecimals, false, tag1, tag2);
        emit NewFeedback(agentId, client, idx, value, valueDecimals, tag1, tag1, tag2, endpoint, feedbackURI, feedbackHash);
    }
}

interface ISelfAgentRegistryFull {
    function isAuthorizedOrOwner(address spender, uint256 agentId) external view returns (bool);
}
```

**Step 4: Add `isAuthorizedOrOwner()` to `SelfAgentRegistry`**

This function is required by the Reputation Registry's anti-self-feedback check and the `appendResponse()` owner check:

```solidity
/// @notice ERC-8004 Reputation Registry compatibility: check if spender is owner or operator
function isAuthorizedOrOwner(address spender, uint256 agentId) external view returns (bool) {
    address owner = ownerOf(agentId); // reverts with ERC721NonexistentToken if not minted
    return spender == owner || isApprovedForAll(owner, spender) || getApproved(agentId) == spender;
}
```

**Step 5: Wire auto-feedback in `SelfAgentRegistry`**

Add storage:
```solidity
/// @notice Optional address of the linked SelfReputationRegistry for auto proof-of-human feedback
address public reputationRegistry;

function setReputationRegistry(address registry_) external onlyOwner {
    reputationRegistry = registry_;
}
```

In `_mintAgent()`, after emitting `AgentRegisteredWithHumanProof`:
```solidity
// Auto-submit proof-of-human feedback if reputation registry is linked
if (reputationRegistry != address(0)) {
    ISelfReputationRegistryMinimal(reputationRegistry).recordHumanProofFeedback(agentId);
}
```

**Step 6: Run tests**

```bash
forge test --match-path "test/SelfReputationRegistry.t.sol" --evm-version paris -vvv
```

**Step 7: Commit**

```bash
git add contracts/src/SelfReputationRegistry.sol contracts/src/SelfAgentRegistry.sol contracts/test/SelfReputationRegistry.t.sol
git commit -m "feat: add SelfReputationRegistry (full ERC-8004 Reputation Registry) with auto proof-of-human feedback"
```

---

## Phase 4: Validation Registry

### Task 9: `SelfValidationRegistry` Contract

Replace `SelfValidationProvider.sol` with a full ERC-8004 Validation Registry. Self Protocol acts as a built-in validator: when an agent's proof is fresh, it submits `response=100`; when expired, `response=0`. External validators can also use the registry.

**Files:**
- Create: `contracts/src/SelfValidationRegistry.sol`
- Rename: `contracts/src/SelfValidationProvider.sol` → `contracts/src/SelfFreshnessChecker.sol` (keep as legacy adapter)
- Create: `contracts/test/SelfValidationRegistry.t.sol`
- Modify: `contracts/script/DeployProviders.s.sol`

**Step 1: Write the failing tests**

Create `contracts/test/SelfValidationRegistry.t.sol`:

```solidity
function test_validationRequestEmitsEvent() public {
    uint256 agentId = _mintTestAgent();
    bytes32 requestHash = keccak256("test-request");

    vm.prank(AGENT_OWNER);
    vm.expectEmit(true, true, true, true);
    emit ValidationRequest(VALIDATOR, agentId, "ipfs://QmRequest", requestHash);
    val.validationRequest(VALIDATOR, agentId, "ipfs://QmRequest", requestHash);
}

function test_validationResponseStoresResult() public {
    bytes32 requestHash = _submitRequest();

    vm.prank(VALIDATOR);
    val.validationResponse(requestHash, 87, "ipfs://QmResponse", bytes32(0), "soft-finality");

    (address v, uint256 agentId, uint8 response, , string memory tag, ) = val.getValidationStatus(requestHash);
    assertEq(v, VALIDATOR);
    assertEq(response, 87);
    assertEq(tag, "soft-finality");
}

function test_validationResponseCanBeCalledMultipleTimes() public {
    bytes32 requestHash = _submitRequest();
    vm.startPrank(VALIDATOR);
    val.validationResponse(requestHash, 50, "", bytes32(0), "soft-finality");
    val.validationResponse(requestHash, 100, "", bytes32(0), "hard-finality");
    vm.stopPrank();

    (, , uint8 response, , string memory tag, ) = val.getValidationStatus(requestHash);
    assertEq(response, 100);
    assertEq(tag, "hard-finality");
}

function test_selfValidatorAutoSubmitsFreshnessResponse() public {
    uint256 agentId = _mintTestAgent();
    val.submitFreshnessValidation(agentId);

    // Freshness data is stored in _freshnessHashes, not _validatorRequests.
    // Use getFreshnessHistory / getLatestFreshness instead of getSummary.
    (bool fresh, uint256 lastUpdated) = val.getLatestFreshness(agentId);
    assertTrue(fresh); // agent was just registered, proof is fresh
    assertGt(lastUpdated, 0);
}

function test_selfValidatorSubmitsZeroWhenExpired() public {
    uint256 agentId = _mintTestAgent();
    vm.warp(block.timestamp + 366 days); // past maxProofAge

    val.submitFreshnessValidation(agentId);

    (bool fresh,) = val.getLatestFreshness(agentId);
    assertFalse(fresh);
}
```

**Step 2: Run to confirm they fail**

```bash
forge test --match-path "test/SelfValidationRegistry.t.sol" --evm-version paris -vvv
```

**Step 3: Implement `SelfValidationRegistry.sol`**

Mirror the canonical `ValidationRegistryUpgradeable.sol` structure as non-upgradeable, with the addition of `submitFreshnessValidation()`:

```solidity
// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import { Ownable } from "@openzeppelin/contracts/access/Ownable.sol";
import { ISelfAgentRegistryReader } from "./interfaces/ISelfAgentRegistryReader.sol";

contract SelfValidationRegistry is Ownable {

    event ValidationRequest(address indexed validatorAddress, uint256 indexed agentId, string requestURI, bytes32 indexed requestHash);
    event ValidationResponse(address indexed validatorAddress, uint256 indexed agentId, bytes32 indexed requestHash, uint8 response, string responseURI, bytes32 responseHash, string tag);

    struct ValidationStatus {
        address validatorAddress;
        uint256 agentId;
        uint8 response;
        bytes32 responseHash;
        string tag;
        uint256 lastUpdate;
        bool hasResponse;
    }

    address private immutable _identityRegistry;

    mapping(bytes32 => ValidationStatus) private _validations;
    mapping(uint256 => bytes32[]) private _agentValidations;
    mapping(address => bytes32[]) private _validatorRequests;

    constructor(address identityRegistry_, address initialOwner) Ownable(initialOwner) {
        require(identityRegistry_ != address(0), "bad identity");
        _identityRegistry = identityRegistry_;
    }

    function getIdentityRegistry() external view returns (address) { return _identityRegistry; }

    function validationRequest(
        address validatorAddress,
        uint256 agentId,
        string calldata requestURI,
        bytes32 requestHash
    ) external {
        // Only agent owner or operator can request validation
        require(
            ISelfAgentRegistryFull(_identityRegistry).isAuthorizedOrOwner(msg.sender, agentId),
            "not authorized"
        );
        _validations[requestHash] = ValidationStatus(validatorAddress, agentId, 0, bytes32(0), "", 0, false);
        _agentValidations[agentId].push(requestHash);
        _validatorRequests[validatorAddress].push(requestHash);
        emit ValidationRequest(validatorAddress, agentId, requestURI, requestHash);
    }

    function validationResponse(
        bytes32 requestHash,
        uint8 response,
        string calldata responseURI,
        bytes32 responseHash,
        string calldata tag
    ) external {
        ValidationStatus storage s = _validations[requestHash];
        require(s.validatorAddress != address(0), "unknown");
        require(msg.sender == s.validatorAddress, "not validator");
        require(response <= 100, "resp>100");
        s.response = response;
        s.responseHash = responseHash;
        s.tag = tag;
        s.lastUpdate = block.timestamp;
        s.hasResponse = true;
        emit ValidationResponse(msg.sender, s.agentId, requestHash, response, responseURI, responseHash, tag);
    }

    /// @notice Self Protocol built-in: submit a freshness validation for an agent
    /// @dev Anyone can call — Self acts as validator, response = 100 if fresh, 0 if expired.
    ///      Freshness records are stored in _freshnessHashes[agentId], NOT _validatorRequests.
    ///      Use getFreshnessHistory() / getLatestFreshness() to query freshness data.
    function submitFreshnessValidation(uint256 agentId) external {
        ISelfAgentRegistryReader reg = ISelfAgentRegistryReader(_identityRegistry);
        bool fresh = reg.isProofFresh(agentId);
        bytes32 requestHash = keccak256(abi.encodePacked("freshness", agentId, block.timestamp / 1 days));

        if (_validations[requestHash].validatorAddress == address(0)) {
            _validations[requestHash] = ValidationStatus(address(this), agentId, 0, bytes32(0), "", 0, false);
            _agentValidations[agentId].push(requestHash);
            _freshnessHashes[agentId].push(requestHash); // NOT _validatorRequests[address(this)]
            emit ValidationRequest(address(this), agentId, "", requestHash);
        }

        uint8 response = fresh ? 100 : 0;
        _validations[requestHash].response = response;
        _validations[requestHash].tag = "freshness";
        _validations[requestHash].lastUpdate = block.timestamp;
        _validations[requestHash].hasResponse = true;
        emit ValidationResponse(address(this), agentId, requestHash, response, "", bytes32(0), "freshness");
    }

    function getFreshnessHistory(uint256 agentId) external view returns (bytes32[] memory) {
        return _freshnessHashes[agentId];
    }

    function getLatestFreshness(uint256 agentId) external view returns (bool fresh, uint256 lastUpdated) {
        bytes32 todayHash = keccak256(abi.encodePacked("freshness", agentId, block.timestamp / 1 days));
        ValidationStatus storage s = _validations[todayHash];
        if (!s.hasResponse) {
            bytes32 yesterdayHash = keccak256(abi.encodePacked("freshness", agentId, (block.timestamp / 1 days) - 1));
            ValidationStatus storage y = _validations[yesterdayHash];
            if (!y.hasResponse) return (false, 0);
            return (y.response == 100, y.lastUpdate);
        }
        return (s.response == 100, s.lastUpdate);
    }

    function getValidationStatus(bytes32 requestHash)
        external view returns (address validatorAddress, uint256 agentId, uint8 response, bytes32 responseHash, string memory tag, uint256 lastUpdate)
    {
        ValidationStatus memory s = _validations[requestHash];
        require(s.validatorAddress != address(0), "unknown");
        return (s.validatorAddress, s.agentId, s.response, s.responseHash, s.tag, s.lastUpdate);
    }

    function getSummary(uint256 agentId, address[] calldata validatorAddresses, string calldata tag)
        external view returns (uint64 count, uint8 avgResponse)
    { /* ... mirror canonical getSummary logic ... */ }

    function getAgentValidations(uint256 agentId) external view returns (bytes32[] memory) {
        return _agentValidations[agentId];
    }

    function getValidatorRequests(address validatorAddress) external view returns (bytes32[] memory) {
        return _validatorRequests[validatorAddress];
    }
}
```

**Step 4: Update `ISelfAgentRegistryReader.sol`** — add `isProofFresh()` and `proofExpiresAt()`:

```solidity
interface ISelfAgentRegistryReader {
    function hasHumanProof(uint256 agentId) external view returns (bool);
    function getProofProvider(uint256 agentId) external view returns (address);
    function agentRegisteredAt(uint256 agentId) external view returns (uint256);
    function isProofFresh(uint256 agentId) external view returns (bool);      // new
    function proofExpiresAt(uint256 agentId) external view returns (uint256); // new
    function isAuthorizedOrOwner(address spender, uint256 agentId) external view returns (bool); // new
}
```

**Step 5: Run tests**

```bash
forge test --match-path "test/SelfValidationRegistry.t.sol" --evm-version paris -vvv
```

**Step 6: Run full suite**

```bash
./scripts/test.sh
```

**Step 7: Commit**

```bash
git add contracts/src/SelfValidationRegistry.sol contracts/src/interfaces/ISelfAgentRegistryReader.sol contracts/test/SelfValidationRegistry.t.sol
git commit -m "feat: add SelfValidationRegistry (full ERC-8004 Validation Registry) with freshness validation"
```

---

## Phase 5: Cleanup, Docs, and Deployment

### Task 10: Rename Legacy Providers

The old `SelfReputationProvider` and `SelfValidationProvider` names were misleading. Keep them as lightweight read-only signal adapters under new names for any callers that need the simpler interface.

**Files:**
- Rename: `contracts/src/SelfReputationProvider.sol` → `contracts/src/SelfReputationSignal.sol`
- Rename: `contracts/src/SelfValidationProvider.sol` → `contracts/src/SelfFreshnessChecker.sol`
- Rename: `contracts/test/SelfReputationProvider.t.sol` → `contracts/test/SelfReputationSignal.t.sol`
- Rename: `contracts/test/SelfValidationProvider.t.sol` → `contracts/test/SelfFreshnessChecker.t.sol`
- Update contract names inside files to match new names

**Step 1: Rename and update**

```bash
cd contracts
mv src/SelfReputationProvider.sol src/SelfReputationSignal.sol
mv src/SelfValidationProvider.sol src/SelfFreshnessChecker.sol
mv test/SelfReputationProvider.t.sol test/SelfReputationSignal.t.sol
mv test/SelfValidationProvider.t.sol test/SelfFreshnessChecker.t.sol
```

Update contract declarations inside files:
- `contract SelfReputationProvider` → `contract SelfReputationSignal`
- `contract SelfValidationProvider` → `contract SelfFreshnessChecker`
- Update import paths in test files
- Update any references in deployment scripts

**Step 2: Run full suite to confirm nothing broke**

```bash
./scripts/test.sh
```

**Step 3: Commit**

```bash
git add -A
git commit -m "refactor: rename legacy signal providers to clarify they are not ERC-8004 registries"
```

---

### Task 11: Registration JSON Schema Documentation

Every agent registered in our registry must publish a JSON file at their `agentURI`. The file format is required by ERC-8004 and must be documented for agent builders using our SDK.

**Files:**
- Create: `docs/AGENT_REGISTRATION_JSON.md`
- Modify: `docs/SELF_PROTOCOL_INTEGRATION.md` (add link)

**Step 1: Create the schema doc**

Create `docs/AGENT_REGISTRATION_JSON.md`:

````markdown
# Agent Registration JSON Schema

Every agent registered with `SelfAgentRegistry` must publish a JSON file at their `agentURI`.
This file is the agent's identity document — it's how services, indexers, and 8004scan
discover and verify the agent's capabilities.

## Required Fields

```json
{
  "type": "https://eips.ethereum.org/EIPS/eip-8004#registration-v1",
  "name": "My Agent",
  "description": "What this agent does",
  "image": "https://example.com/agent-avatar.png",
  "services": [
    {
      "name": "A2A",
      "endpoint": "https://my-agent.example.com/a2a",
      "version": "1.0"
    }
  ]
}
```

## With Self Protocol Proof-of-Human Extension

```json
{
  "type": "https://eips.ethereum.org/EIPS/eip-8004#registration-v1",
  "name": "My Self-Verified Agent",
  "description": "A human-backed AI agent verified via Self Protocol",
  "image": "https://my-agent.example.com/avatar.png",
  "active": true,
  "services": [
    {
      "name": "A2A",
      "endpoint": "https://my-agent.example.com/a2a"
    },
    {
      "name": "MCP",
      "endpoint": "https://my-agent.example.com/mcp"
    }
  ],
  "registrations": [
    {
      "agentId": 42,
      "agentRegistry": "eip155:42220:0x62E37d0f6c5f67784b8828B3dF68BCDbB2e55095"
    }
  ],
  "supportedTrust": ["reputation", "tee-attestation"]
}
```

## Field Reference

| Field | Required | Notes |
|---|---|---|
| `type` | YES | Must be exactly `"https://eips.ethereum.org/EIPS/eip-8004#registration-v1"` |
| `name` | YES | Human-readable agent name |
| `description` | YES | What the agent does |
| `image` | YES | Avatar URL |
| `services` | YES | At least one service endpoint |
| `services[].name` | YES | One of: `web`, `A2A`, `MCP`, `OASF`, `ENS`, `DID`, `email` |
| `services[].endpoint` | YES | URI |
| `active` | NO | Set to `false` when agent is inactive (e.g., proof expired) |
| `registrations` | NO | Cross-chain or multi-registry references |
| `supportedTrust` | NO | `reputation`, `crypto-economic`, `tee-attestation` |

## SDK Helper

The TypeScript SDK auto-generates this file:

```typescript
import { generateRegistrationJSON } from '@selfxyz/agent-sdk';

const json = generateRegistrationJSON({
  name: 'My Agent',
  description: 'What it does',
  image: 'https://...',
  services: [{ name: 'A2A', endpoint: 'https://...' }],
  chainId: 42220,
  registryAddress: '0x62E37d0f6c5f67784b8828B3dF68BCDbB2e55095',
  agentId: 42,
});
```
````

**Step 2: Commit**

```bash
git add docs/AGENT_REGISTRATION_JSON.md docs/SELF_PROTOCOL_INTEGRATION.md
git commit -m "docs: add agent registration JSON schema documentation for ERC-8004 compliance"
```

---

### Task 12: Update Deployment Scripts

Add `SelfReputationRegistry` and `SelfValidationRegistry` to deployment scripts, and wire up the `reputationRegistry` link in `SelfAgentRegistry`.

**Files:**
- Modify: `contracts/script/DeployProviders.s.sol`
- Create: `contracts/script/DeployRegistries.s.sol`

**Step 1: Update `DeployProviders.s.sol`**

```solidity
contract DeployRegistries is BaseScript {
    function run() external broadcast {
        address registryAddr = vm.envAddress("REGISTRY");

        SelfReputationRegistry rep = new SelfReputationRegistry(registryAddr, broadcaster);
        SelfValidationRegistry val = new SelfValidationRegistry(registryAddr, broadcaster);

        // Wire reputation registry for auto proof-of-human feedback
        SelfAgentRegistry(registryAddr).setReputationRegistry(address(rep));

        console.log("SelfReputationRegistry:", address(rep));
        console.log("SelfValidationRegistry:", address(val));
    }
}
```

**Step 2: Run full test suite**

```bash
./scripts/test.sh
```
Expected: All tests pass.

**Step 3: Commit**

```bash
git add contracts/script/
git commit -m "feat: add deployment scripts for SelfReputationRegistry and SelfValidationRegistry"
```

---

## Phase 6: IERC8004ProofOfHuman Finalization (EIP Prep)

### Task 13: Clean Up the Extension Interface for EIP Submission

This is the interface document that will accompany either the amendment proposal or the companion ERC filing. It needs to be clean, complete, and generic enough that other proof-of-human providers (Worldcoin, etc.) could implement it.

**Files:**
- Modify: `contracts/src/interfaces/IERC8004ProofOfHuman.sol`
- Create: `docs/EIP_DRAFT_PROOF_OF_HUMAN.md`

**Step 1: Finalize `IERC8004ProofOfHuman.sol`**

The interface must be:
1. Generic (no Self Protocol-specific terminology)
2. ERC-165 compatible (has `interfaceId`)
3. Complete (all functions with NatSpec)

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @title IERC8004ProofOfHuman
/// @notice Optional extension for ERC-8004 Identity Registries that bind agent
///         identities to verified unique humans via privacy-preserving proofs.
/// @dev Implementations MUST also implement ERC-8004 and ERC-165.
///      The human is identified by a nullifier — a scoped, opaque identifier that
///      is unique per (human, service) pair. The nullifier is derived by the proof
///      provider; raw biometric data is never stored on-chain.
///
///      Verification strength (0-100 scale):
///        100 = Government-issued ID with NFC chip + biometric verification
///         60 = Government-issued ID without chip
///         40 = Video liveness check
///          0 = No verification
interface IERC8004ProofOfHuman {

    // ---- Events ----

    /// @notice Emitted when an agent's human proof is registered
    event AgentRegisteredWithHumanProof(
        uint256 indexed agentId,
        address indexed proofProvider,
        uint256 nullifier,
        uint8 verificationStrength
    );

    /// @notice Emitted when an agent's human proof is revoked
    event HumanProofRevoked(uint256 indexed agentId, uint256 nullifier);

    /// @notice Emitted when a proof provider is added to the approved list
    event ProofProviderAdded(address indexed provider, string name);

    /// @notice Emitted when a proof provider is removed from the approved list
    event ProofProviderRemoved(address indexed provider);

    // ---- Registration ----

    /// @notice Register an agent with a human proof from an approved provider
    /// @param agentURI The ERC-8004 registration file URI
    /// @param proofProvider Address of the approved IHumanProofProvider
    /// @param proof The proof payload for the provider to verify
    /// @param providerData Additional data required by the provider
    /// @return agentId The newly registered agent ID
    function registerWithHumanProof(
        string calldata agentURI,
        address proofProvider,
        bytes calldata proof,
        bytes calldata providerData
    ) external returns (uint256 agentId);

    /// @notice Revoke an agent's human proof (requires re-proving same human)
    function revokeHumanProof(
        uint256 agentId,
        address proofProvider,
        bytes calldata proof,
        bytes calldata providerData
    ) external;

    // ---- View Functions ----

    /// @notice Returns true if the agent has an active, non-expired human proof
    function hasHumanProof(uint256 agentId) external view returns (bool);

    /// @notice Returns the unix timestamp after which reauthentication is required (0 = no expiry)
    function proofExpiresAt(uint256 agentId) external view returns (uint256);

    /// @notice Returns true if the proof is active and within its validity window
    function isProofFresh(uint256 agentId) external view returns (bool);

    /// @notice Returns the nullifier for the human who owns this agent
    function getHumanNullifier(uint256 agentId) external view returns (uint256);

    /// @notice Returns the proof provider address used to verify this agent
    function getProofProvider(uint256 agentId) external view returns (address);

    /// @notice Returns the number of active agents registered by the same human
    function getAgentCountForHuman(uint256 nullifier) external view returns (uint256);

    /// @notice Returns true if two agents belong to the same human (same nullifier)
    function sameHuman(uint256 agentIdA, uint256 agentIdB) external view returns (bool);

    /// @notice Returns true if the given address is an approved proof provider
    function isApprovedProvider(address provider) external view returns (bool);
}
```

**Step 2: Create EIP draft outline**

Create `docs/EIP_DRAFT_PROOF_OF_HUMAN.md` with the full EIP structure (abstract, motivation, spec, rationale, security considerations) — this document is the starting point for either the amendment proposal or companion ERC filing. See the ethereum-magicians ERC-8004 thread for the right tone and structure.

**Step 3: Commit**

```bash
git add contracts/src/interfaces/IERC8004ProofOfHuman.sol docs/EIP_DRAFT_PROOF_OF_HUMAN.md
git commit -m "feat: finalize IERC8004ProofOfHuman interface and EIP draft outline"
```

---

## Phase 7: SDK Expiry Handling

### Task 14: SDK Auto-Rejection of Expired Proofs

Update the TypeScript SDK to automatically check `proofExpiresAt` before accepting an agent as valid, and guide users through reauthentication when their proof expires.

**Files:**
- Modify: `typescript-sdk/src/verify.ts` (or equivalent verification entry point)
- Modify: `typescript-sdk/src/types.ts`

**Step 1: Add expiry check to SDK verification**

```typescript
// In the agent verification function
export async function verifyAgent(
  agentKey: string,
  options: { chainId: number; registryAddress: string }
): Promise<VerifyResult> {
  const registry = getRegistry(options);

  const agentId = await registry.getAgentId(agentKey);
  if (agentId === 0n) return { verified: false, reason: 'NOT_REGISTERED' };

  const hasProof = await registry.hasHumanProof(agentId);
  if (!hasProof) return { verified: false, reason: 'NO_HUMAN_PROOF' };

  const expiresAt = await registry.proofExpiresAt(agentId);
  const nowSecs = BigInt(Math.floor(Date.now() / 1000));
  if (expiresAt > 0n && nowSecs >= expiresAt) {
    return {
      verified: false,
      reason: 'PROOF_EXPIRED',
      expiredAt: new Date(Number(expiresAt) * 1000),
      reauthUrl: buildReauthUrl(agentId, options)
    };
  }

  return { verified: true, agentId, expiresAt: new Date(Number(expiresAt) * 1000) };
}
```

**Step 2: Add `VerifyResult` type**

```typescript
export type VerifyResult =
  | { verified: true; agentId: bigint; expiresAt: Date }
  | { verified: false; reason: 'NOT_REGISTERED' | 'NO_HUMAN_PROOF' }
  | { verified: false; reason: 'PROOF_EXPIRED'; expiredAt: Date; reauthUrl: string };
```

**Step 3: Add warning threshold (30 days before expiry)**

```typescript
export const EXPIRY_WARNING_THRESHOLD_SECS = 30 * 24 * 60 * 60; // 30 days

export function isProofExpiringSoon(expiresAt: Date): boolean {
  const secsUntilExpiry = (expiresAt.getTime() - Date.now()) / 1000;
  return secsUntilExpiry > 0 && secsUntilExpiry < EXPIRY_WARNING_THRESHOLD_SECS;
}
```

**Step 4: Commit**

```bash
git add typescript-sdk/src/
git commit -m "feat: add proof expiry checking and reauth guidance to TypeScript SDK"
```

---

## Running the Full Test Suite

After all phases are complete:

```bash
cd contracts && ./scripts/test.sh
```

Expected output: all tests pass, no compilation warnings.

For the online verification path (requires Celo testnet RPC):

```bash
SELF_AGENT_CONTRACTS_ONLINE=1 forge test --evm-version paris -vvv
```

---

## Deployment Order (Celo Sepolia → Mainnet)

```bash
# 1. Deploy updated SelfAgentRegistry (new impl, same proxy if upgradeable)
PRIVATE_KEY=0x... IDENTITY_VERIFICATION_HUB_ADDRESS=0x16EC... \
  forge script script/DeploySelfAgentRegistry.s.sol \
  --rpc-url celo-sepolia --broadcast --verify --evm-version paris

# 2. Deploy new Reputation + Validation Registries and wire them up
PRIVATE_KEY=0x... REGISTRY=0x29d9... \
  forge script script/DeployRegistries.s.sol \
  --rpc-url celo-sepolia --broadcast --verify --evm-version paris
```

---

## EIP Strategy Checklist (Post-Deployment)

- [ ] Post proof-of-concept in ethereum-magicians ERC-8004 thread with deployed contract addresses
- [ ] Check current ERC-8004 EIP status (Draft / Review / Last Call / Final) — if not Final, amendment is viable
- [ ] If authors receptive: draft amendment text adding IERC8004ProofOfHuman as optional extension
- [ ] If not: file companion ERC with `IERC8004ProofOfHuman.sol` as reference implementation
- [ ] Open PR to 8004scan to index `SelfAgentRegistry` as a recognized ERC-8004 registry

---
