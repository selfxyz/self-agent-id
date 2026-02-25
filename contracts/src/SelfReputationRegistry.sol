// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import { Ownable } from "@openzeppelin/contracts/access/Ownable.sol";

/// @title SelfReputationRegistry
/// @notice ERC-8004 compliant Reputation Registry scoped to SelfAgentRegistry.
/// @dev Stores feedback entries keyed by (agentId, clientAddress, feedbackIndex).
///      Supports give/revoke/read/summarise feedback and agent response appending.
///      The linked identity registry auto-submits a high-authority proof-of-human
///      feedback entry at agent registration time via recordHumanProofFeedback().
contract SelfReputationRegistry is Ownable {

    // ====================================================
    // Events
    // ====================================================

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

    event FeedbackRevoked(
        uint256 indexed agentId,
        address indexed clientAddress,
        uint64 indexed feedbackIndex
    );

    event ResponseAppended(
        uint256 indexed agentId,
        address indexed clientAddress,
        uint64 feedbackIndex,
        address indexed responder,
        string responseURI,
        bytes32 responseHash
    );

    // ====================================================
    // Storage
    // ====================================================

    struct Feedback {
        int128 value;
        uint8 valueDecimals;
        bool isRevoked;
        string tag1;
        string tag2;
        string endpoint;
        string feedbackURI;
        bytes32 feedbackHash;
    }

    int128 private constant MAX_ABS_VALUE = 1e38;

    address private immutable _identityRegistry;

    /// @dev (agentId => clientAddress => feedbackIndex => Feedback)
    mapping(uint256 => mapping(address => mapping(uint64 => Feedback))) private _feedback;

    /// @dev (agentId => clientAddress => last assigned index; 0 = none)
    mapping(uint256 => mapping(address => uint64)) private _lastIndex;

    /// @dev Ordered list of all clients who have submitted feedback for an agent
    mapping(uint256 => address[]) private _clients;
    mapping(uint256 => mapping(address => bool)) private _clientExists;

    /// @dev (agentId => clientAddress => feedbackIndex => responseCount)
    mapping(uint256 => mapping(address => mapping(uint64 => uint64))) private _responseCount;

    // ====================================================
    // Constructor
    // ====================================================

    /// @param identityRegistry_ Address of the deployed SelfAgentRegistry
    /// @param initialOwner Initial owner of this contract (admin functions)
    constructor(address identityRegistry_, address initialOwner) Ownable(initialOwner) {
        require(identityRegistry_ != address(0), "bad identity registry");
        _identityRegistry = identityRegistry_;
    }

    // ====================================================
    // View — Registry Address
    // ====================================================

    /// @notice Returns the address of the linked identity registry
    function getIdentityRegistry() external view returns (address) {
        return _identityRegistry;
    }

    // ====================================================
    // Write — Feedback
    // ====================================================

    /// @notice Submit feedback for an agent.
    /// @dev Reverts if msg.sender is the agent owner or an approved operator (self-feedback).
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
        require(value >= -MAX_ABS_VALUE && value <= MAX_ABS_VALUE, "value out of range");
        require(
            !ISelfAgentRegistryMinimal(_identityRegistry).isAuthorizedOrOwner(msg.sender, agentId),
            "Self-feedback not allowed"
        );
        _recordFeedback(
            agentId, msg.sender,
            value, valueDecimals,
            tag1, tag2, endpoint, feedbackURI, feedbackHash
        );
    }

    /// @notice Called only by the identity registry to auto-record proof-of-human feedback.
    /// @dev Emits NewFeedback with tag1="proof-of-human", tag2="passport-nfc", value=100.
    function recordHumanProofFeedback(uint256 agentId) external {
        require(msg.sender == _identityRegistry, "only identity registry");
        _recordFeedback(
            agentId, msg.sender,
            100, 0,
            "proof-of-human", "passport-nfc",
            "", "", bytes32(0)
        );
    }

    /// @notice Revoke a previously submitted feedback entry.
    /// @dev Only the original submitter (clientAddress) can revoke their own entry.
    function revokeFeedback(uint256 agentId, uint64 feedbackIndex) external {
        require(
            feedbackIndex > 0 && feedbackIndex <= _lastIndex[agentId][msg.sender],
            "invalid feedback index"
        );
        Feedback storage fb = _feedback[agentId][msg.sender][feedbackIndex];
        require(!fb.isRevoked, "already revoked");
        fb.isRevoked = true;
        emit FeedbackRevoked(agentId, msg.sender, feedbackIndex);
    }

    /// @notice Append a response to a feedback entry.
    /// @dev Only callable by the agent owner or an approved operator.
    function appendResponse(
        uint256 agentId,
        address clientAddress,
        uint64 feedbackIndex,
        string calldata responseURI,
        bytes32 responseHash
    ) external {
        require(
            ISelfAgentRegistryMinimal(_identityRegistry).isAuthorizedOrOwner(msg.sender, agentId),
            "not agent owner or operator"
        );
        require(
            feedbackIndex > 0 && feedbackIndex <= _lastIndex[agentId][clientAddress],
            "invalid feedback index"
        );
        require(!_feedback[agentId][clientAddress][feedbackIndex].isRevoked, "feedback revoked");
        _responseCount[agentId][clientAddress][feedbackIndex]++;
        emit ResponseAppended(agentId, clientAddress, feedbackIndex, msg.sender, responseURI, responseHash);
    }

    // ====================================================
    // Read — Individual Feedback
    // ====================================================

    /// @notice Read a single feedback entry.
    /// @return value          The numeric feedback value
    /// @return valueDecimals  Decimal places for value
    /// @return tag1           Primary tag
    /// @return tag2           Secondary tag
    /// @return isRevoked      True if entry has been revoked
    /// @return endpoint       Endpoint URL associated with the feedback
    /// @return feedbackURI    URI pointing to extended feedback data
    /// @return feedbackHash   Hash of the feedback content for integrity verification
    function readFeedback(uint256 agentId, address clientAddress, uint64 feedbackIndex)
        external view
        returns (
            int128 value,
            uint8 valueDecimals,
            string memory tag1,
            string memory tag2,
            bool isRevoked,
            string memory endpoint,
            string memory feedbackURI,
            bytes32 feedbackHash
        )
    {
        Feedback storage fb = _feedback[agentId][clientAddress][feedbackIndex];
        return (fb.value, fb.valueDecimals, fb.tag1, fb.tag2, fb.isRevoked, fb.endpoint, fb.feedbackURI, fb.feedbackHash);
    }

    // ====================================================
    // Read — Summary
    // ====================================================

    /// @notice Aggregate non-revoked feedback across a list of client addresses.
    /// @dev IMPORTANT: summaryValue is the raw sum of int128 values. Feedback entries with
    ///      different `valueDecimals` CANNOT be meaningfully summed. Callers must ensure all
    ///      queried feedback entries use the same decimals, or filter by a single client whose
    ///      entries are decimals-consistent. Results with mixed decimals are undefined.
    /// @param agentId         The agent to summarise
    /// @param clientAddresses Non-empty list of clients to include
    /// @param tag1            Optional tag1 filter (empty = no filter)
    /// @param tag2            Optional tag2 filter (empty = no filter)
    /// @return count                  Number of matching non-revoked entries
    /// @return summaryValue           Sum of matching values
    /// @return summaryValueDecimals   Decimals of the last matched entry (simplified)
    function getSummary(
        uint256 agentId,
        address[] calldata clientAddresses,
        string calldata tag1,
        string calldata tag2
    ) external view returns (uint64 count, int128 summaryValue, uint8 summaryValueDecimals) {
        require(clientAddresses.length > 0, "clientAddresses required");
        bytes32 t1 = bytes(tag1).length > 0 ? keccak256(bytes(tag1)) : bytes32(0);
        bytes32 t2 = bytes(tag2).length > 0 ? keccak256(bytes(tag2)) : bytes32(0);
        (count, summaryValue, summaryValueDecimals) = _summarise(agentId, clientAddresses, t1, t2);
    }

    function _summarise(
        uint256 agentId,
        address[] calldata clientAddresses,
        bytes32 tag1Hash,
        bytes32 tag2Hash
    ) internal view returns (uint64 count, int128 summaryValue, uint8 summaryValueDecimals) {
        for (uint256 i = 0; i < clientAddresses.length; i++) {
            (uint64 c, int128 v, uint8 d) = _summariseClient(agentId, clientAddresses[i], tag1Hash, tag2Hash);
            count += c;
            summaryValue += v;
            if (c > 0) summaryValueDecimals = d;
        }
    }

    function _summariseClient(
        uint256 agentId,
        address client,
        bytes32 tag1Hash,
        bytes32 tag2Hash
    ) internal view returns (uint64 count, int128 summaryValue, uint8 summaryValueDecimals) {
        uint64 lastIdx = _lastIndex[agentId][client];
        for (uint64 j = 1; j <= lastIdx; j++) {
            Feedback storage fb = _feedback[agentId][client][j];
            if (fb.isRevoked) continue;
            if (tag1Hash != bytes32(0) && keccak256(bytes(fb.tag1)) != tag1Hash) continue;
            if (tag2Hash != bytes32(0) && keccak256(bytes(fb.tag2)) != tag2Hash) continue;
            count++;
            summaryValue += fb.value;
            summaryValueDecimals = fb.valueDecimals;
        }
    }

    // ====================================================
    // Read — Enumeration
    // ====================================================

    /// @notice Returns the list of all client addresses that have submitted feedback for an agent.
    function getClients(uint256 agentId) external view returns (address[] memory) {
        return _clients[agentId];
    }

    /// @notice Returns the last feedback index for a (agentId, clientAddress) pair.
    ///         Returns 0 if no feedback has been submitted.
    function getLastIndex(uint256 agentId, address clientAddress) external view returns (uint64) {
        return _lastIndex[agentId][clientAddress];
    }

    /// @notice Returns the response count for a specific feedback entry.
    ///         The final `address[]` parameter is accepted for interface compatibility but unused.
    function getResponseCount(
        uint256 agentId,
        address clientAddress,
        uint64 feedbackIndex,
        address[] calldata
    ) external view returns (uint64) {
        return _responseCount[agentId][clientAddress][feedbackIndex];
    }

    // ====================================================
    // Internal
    // ====================================================

    function _recordFeedback(
        uint256 agentId,
        address client,
        int128 value,
        uint8 valueDecimals,
        string memory tag1,
        string memory tag2,
        string memory endpoint,
        string memory feedbackURI,
        bytes32 feedbackHash
    ) internal {
        if (!_clientExists[agentId][client]) {
            _clients[agentId].push(client);
            _clientExists[agentId][client] = true;
        }
        uint64 idx = ++_lastIndex[agentId][client];
        _feedback[agentId][client][idx] = Feedback({
            value: value,
            valueDecimals: valueDecimals,
            isRevoked: false,
            tag1: tag1,
            tag2: tag2,
            endpoint: endpoint,
            feedbackURI: feedbackURI,
            feedbackHash: feedbackHash
        });
        // NOTE: `indexedTag1` and `tag1` intentionally receive the same value.
        // Solidity stores indexed strings as keccak256 in the event topic (for log filtering),
        // while the plain non-indexed copy allows off-chain decoders to recover the raw string.
        // Do NOT remove the second `tag1` — it is required for off-chain readability.
        emit NewFeedback(
            agentId, client, idx,
            value, valueDecimals,
            tag1, tag1, tag2, endpoint, feedbackURI, feedbackHash
        );
    }
}

/// @dev Minimal interface for querying ownership/approval status on SelfAgentRegistry.
interface ISelfAgentRegistryMinimal {
    function isAuthorizedOrOwner(address spender, uint256 agentId) external view returns (bool);
}
