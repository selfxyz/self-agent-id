// SPDX-License-Identifier: MIT

pragma solidity 0.8.28;

import { SelfAgentRegistry } from "./SelfAgentRegistry.sol";
import { EIP712 } from "lib/openzeppelin-contracts/contracts/utils/cryptography/EIP712.sol";
import { ECDSA } from "lib/openzeppelin-contracts/contracts/utils/cryptography/ECDSA.sol";

/// @title AgentDemoVerifier
/// @author Self Protocol
/// @notice Demo contract that verifies agents via EIP-712 meta-transactions.
///         A relayer submits the signed typed data on-chain; the contract recovers
///         the signer, checks the registry, and writes state.
contract AgentDemoVerifier is EIP712 {
    /// @notice The SelfAgentRegistry used for agent verification lookups
    SelfAgentRegistry public immutable registry;

    /// @dev EIP-712 typehash for the MetaVerify struct
    bytes32 private constant META_VERIFY_TYPEHASH =
        keccak256("MetaVerify(bytes32 agentKey,uint256 nonce,uint256 deadline)");

    /// @notice Whether an agent has verified at least once
    mapping(bytes32 => bool) public hasVerified;

    /// @notice Per-agent verification counter
    mapping(bytes32 => uint256) public verificationCount;

    /// @notice Per-agent nonce for EIP-712 replay protection
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
    /// @notice Thrown when the recovered EIP-712 signer does not match the agent address
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
    constructor(address _registry) EIP712("AgentDemoVerifier", "1") {
        registry = SelfAgentRegistry(_registry);
    }

    // ---- Meta-Transaction Verification ----

    /// @notice Verify an agent via EIP-712 meta-transaction
    /// @param agentKey The agent's public key (bytes32)
    /// @param nonce The expected nonce for replay protection
    /// @param deadline Unix timestamp after which the signature expires
    /// @param signature The EIP-712 signature from the agent
    /// @return agentId The agent's token ID
    function metaVerifyAgent(
        bytes32 agentKey,
        uint256 nonce,
        uint256 deadline,
        bytes calldata signature
    )
        external
        returns (uint256 agentId)
    {
        // 1. Meta-tx validation
        if (block.timestamp > deadline) revert MetaTxExpired();
        if (nonces[agentKey] != nonce) revert MetaTxInvalidNonce();

        // 2. EIP-712 signature verification (before nonce increment to prevent griefing)
        bytes32 structHash = keccak256(
            abi.encode(META_VERIFY_TYPEHASH, agentKey, nonce, deadline)
        );
        address signer = ECDSA.recover(_hashTypedDataV4(structHash), signature);
        if (signer != address(uint160(uint256(agentKey)))) {
            revert MetaTxInvalidSignature();
        }

        // 3. Increment nonce after successful signature verification
        nonces[agentKey]++;

        // 4. Registry checks — basic verification only, no disclosure requirements
        if (!registry.isVerifiedAgent(agentKey)) revert NotVerifiedAgent();
        agentId = registry.getAgentId(agentKey);

        // 5. Effects
        hasVerified[agentKey] = true;
        verificationCount[agentKey]++;
        totalVerifications++;

        // 6. Events
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
    /// @param agentKey The agent's public key (bytes32)
    /// @return agentId The agent's token ID
    function checkAccess(bytes32 agentKey)
        external
        view
        returns (uint256 agentId)
    {
        if (!registry.isVerifiedAgent(agentKey)) revert NotVerifiedAgent();
        agentId = registry.getAgentId(agentKey);
    }

    /// @notice Expose the EIP-712 domain separator for client-side signing
    function DOMAIN_SEPARATOR() external view returns (bytes32) {
        return _domainSeparatorV4();
    }
}
