// SPDX-License-Identifier: MIT

pragma solidity 0.8.28;

import { SelfAgentRegistry } from "./SelfAgentRegistry.sol";
import { Ed25519Verifier } from "./lib/Ed25519Verifier.sol";

/// @title AgentDemoVerifierEd25519
/// @author Self Protocol
/// @notice Demo contract that verifies Ed25519 agents via meta-transactions.
///         A relayer submits the Ed25519 signature on-chain; the contract verifies
///         the signature using SCL crypto-lib, checks the registry, and writes state.
/// @dev Mirrors AgentDemoVerifier but uses Ed25519 instead of EIP-712/ecrecover.
///      Ed25519 verification costs ~990K gas vs ~3K for ecrecover.
contract AgentDemoVerifierEd25519 {
    /// @notice The SelfAgentRegistry used for agent verification lookups
    SelfAgentRegistry public immutable registry;

    /// @notice Whether an agent has verified at least once
    mapping(bytes32 => bool) public hasVerified;

    /// @notice Per-agent verification counter
    mapping(bytes32 => uint256) public verificationCount;

    /// @notice Per-agent nonce for replay protection (keyed by agentKey = keccak256(pubkey))
    mapping(bytes32 => uint256) public nonces;

    /// @notice Global verification counter
    uint256 public totalVerifications;

    // ---- Errors ----

    /// @notice Thrown when the agent key is not registered or has no active human proof
    error NotVerifiedAgent();
    /// @notice Thrown when the meta-transaction deadline has passed
    error MetaTxExpired();
    /// @notice Thrown when the supplied nonce does not match the expected nonce
    error MetaTxInvalidNonce();
    /// @notice Thrown when the Ed25519 signature verification fails
    error MetaTxInvalidSignature();

    // ---- Events ----

    /// @notice Emitted when an agent is verified on-chain
    event AgentChainVerified(
        bytes32 indexed agentKey,
        uint256 indexed agentId
    );

    /// @notice Emitted with per-agent and global counters
    event VerificationCompleted(
        bytes32 indexed agentKey,
        uint256 agentCount,
        uint256 totalCount
    );

    /// @notice Proves which address paid for gas
    event GasSponsored(address indexed relayer, bytes32 indexed agentKey);

    // ---- Constructor ----

    /// @param _registry Address of the deployed SelfAgentRegistry
    constructor(address _registry) {
        registry = SelfAgentRegistry(_registry);
    }

    // ---- Meta-Transaction Verification ----

    /// @notice Verify an Ed25519 agent via meta-transaction
    /// @param agentKey The agent's key (keccak256 of Ed25519 pubkey)
    /// @param nonce The expected nonce for replay protection
    /// @param deadline Unix timestamp after which the signature expires
    /// @param extKpub Pre-computed extended Weierstrass public key [Wx, Wy, Wx128, Wy128, compressedLE]
    /// @param sigR Ed25519 signature R component (little-endian)
    /// @param sigS Ed25519 signature S component (little-endian)
    /// @return agentId The agent's token ID
    function metaVerifyAgent(
        bytes32 agentKey,
        uint256 nonce,
        uint256 deadline,
        uint256[5] calldata extKpub,
        uint256 sigR,
        uint256 sigS
    )
        external
        returns (uint256 agentId)
    {
        // 1. Meta-tx validation
        if (block.timestamp > deadline) revert MetaTxExpired();
        if (nonces[agentKey] != nonce) revert MetaTxInvalidNonce();

        // 2. Verify the Ed25519 pubkey matches the claimed agentKey
        bytes32 pubkey = bytes32(extKpub[4]); // compressedLE is the 32-byte Ed25519 pubkey
        bytes32 derivedKey = keccak256(abi.encodePacked(pubkey));
        if (derivedKey != agentKey) revert MetaTxInvalidSignature();

        // 3. Construct message: plain keccak256 (no EIP-712 — Ed25519 can't do typed-data)
        bytes32 messageHash = keccak256(
            abi.encodePacked(agentKey, nonce, deadline)
        );

        // 4. Verify Ed25519 signature (before nonce increment to prevent griefing)
        //    Ed25519Verifier.verify expects the message as a string (raw bytes)
        bool valid = Ed25519Verifier.verify(
            string(abi.encodePacked(messageHash)),
            sigR,
            sigS,
            _toMemory(extKpub)
        );
        if (!valid) revert MetaTxInvalidSignature();

        // 5. Increment nonce after successful signature verification
        nonces[agentKey]++;

        // 6. Registry checks — basic verification only, no disclosure requirements
        if (!registry.isVerifiedAgent(agentKey)) revert NotVerifiedAgent();
        agentId = registry.getAgentId(agentKey);

        // 7. Effects
        hasVerified[agentKey] = true;
        verificationCount[agentKey]++;
        totalVerifications++;

        // 8. Events
        emit AgentChainVerified(agentKey, agentId);
        emit VerificationCompleted(
            agentKey,
            verificationCount[agentKey],
            totalVerifications
        );
        emit GasSponsored(msg.sender, agentKey);
    }

    // ---- View Function ----

    /// @notice Read-only access check (no gas, no state change)
    /// @param agentKey The agent's key (keccak256 of Ed25519 pubkey)
    /// @return agentId The agent's token ID
    function checkAccess(bytes32 agentKey)
        external
        view
        returns (uint256 agentId)
    {
        if (!registry.isVerifiedAgent(agentKey)) revert NotVerifiedAgent();
        agentId = registry.getAgentId(agentKey);
    }

    // ---- Internal ----

    /// @dev Copy calldata array to memory (required by Ed25519Verifier.verify which takes memory)
    function _toMemory(uint256[5] calldata arr) internal pure returns (uint256[5] memory mem) {
        mem[0] = arr[0];
        mem[1] = arr[1];
        mem[2] = arr[2];
        mem[3] = arr[3];
        mem[4] = arr[4];
    }
}
