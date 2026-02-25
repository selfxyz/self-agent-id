// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import { ImplRoot } from "./upgradeable/ImplRoot.sol";

/**
 * @title SelfReputationRegistry
 * @notice ERC-8004 compliant Reputation Registry scoped to SelfAgentRegistry.
 * @custom:version 1.0.0
 *
 * @notice CRITICAL STORAGE LAYOUT WARNING
 *
 * This contract uses the UUPS upgradeable pattern which makes storage layout EXTREMELY SENSITIVE.
 *
 * NEVER MODIFY OR REORDER existing storage variables
 * NEVER INSERT new variables between existing ones
 * NEVER CHANGE THE TYPE of existing variables
 *
 * New storage variables MUST be added at the END of the storage struct only.
 *
 * @dev Stores feedback entries keyed by (agentId, clientAddress, feedbackIndex).
 *      Supports give/revoke/read/summarise feedback and agent response appending.
 *      The linked identity registry auto-submits a high-authority proof-of-human
 *      feedback entry at agent registration time via recordHumanProofFeedback().
 */
contract SelfReputationRegistry is ImplRoot {

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
    // Structs & Constants
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

    // ====================================================
    // ERC-7201 Namespaced Storage
    // ====================================================

    /// @custom:storage-location erc7201:self.storage.SelfReputationRegistry
    struct SelfReputationRegistryStorage {
        address identityRegistry;
        mapping(uint256 => mapping(address => mapping(uint64 => Feedback))) feedback;
        mapping(uint256 => mapping(address => uint64)) lastIndex;
        mapping(uint256 => address[]) clients;
        mapping(uint256 => mapping(address => bool)) clientExists;
        mapping(uint256 => mapping(address => mapping(uint64 => uint64))) responseCount;
    }

    /// @dev keccak256(abi.encode(uint256(keccak256("self.storage.SelfReputationRegistry")) - 1)) & ~bytes32(uint256(0xff))
    bytes32 private constant SELFREPUTATIONREGISTRY_STORAGE_LOCATION =
        0xb74115cc2fc5e81810d485ad3c7e52a4ecbfda17e11c550855f3557e2e12c500;

    function _getSelfReputationRegistryStorage() private pure returns (SelfReputationRegistryStorage storage $) {
        assembly { $.slot := SELFREPUTATIONREGISTRY_STORAGE_LOCATION }
    }

    // ====================================================
    // Constructor & Initializer
    // ====================================================

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    /// @param identityRegistry_ Address of the deployed SelfAgentRegistry proxy
    /// @param initialOwner Address that receives SECURITY_ROLE and OPERATIONS_ROLE
    function initialize(address identityRegistry_, address initialOwner) external initializer {
        __ImplRoot_init(initialOwner);
        require(identityRegistry_ != address(0), "bad identity registry");
        _getSelfReputationRegistryStorage().identityRegistry = identityRegistry_;
    }

    // ====================================================
    // View — Registry Address
    // ====================================================

    /// @notice Returns the address of the linked identity registry
    function getIdentityRegistry() external view returns (address) {
        return _getSelfReputationRegistryStorage().identityRegistry;
    }

    // ====================================================
    // Write — Feedback
    // ====================================================

    /// @notice Submit feedback for an agent.
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
        SelfReputationRegistryStorage storage $ = _getSelfReputationRegistryStorage();
        require(valueDecimals <= 18, "too many decimals");
        require(value >= -MAX_ABS_VALUE && value <= MAX_ABS_VALUE, "value out of range");
        require(
            !ISelfAgentRegistryMinimal($.identityRegistry).isAuthorizedOrOwner(msg.sender, agentId),
            "Self-feedback not allowed"
        );
        _recordFeedback(
            agentId, msg.sender,
            value, valueDecimals,
            tag1, tag2, endpoint, feedbackURI, feedbackHash
        );
    }

    /// @notice Called only by the identity registry to auto-record proof-of-human feedback.
    function recordHumanProofFeedback(uint256 agentId) external {
        SelfReputationRegistryStorage storage $ = _getSelfReputationRegistryStorage();
        require(msg.sender == $.identityRegistry, "only identity registry");
        _recordFeedback(
            agentId, msg.sender,
            100, 0,
            "proof-of-human", "passport-nfc",
            "", "", bytes32(0)
        );
    }

    /// @notice Revoke a previously submitted feedback entry.
    function revokeFeedback(uint256 agentId, uint64 feedbackIndex) external {
        SelfReputationRegistryStorage storage $ = _getSelfReputationRegistryStorage();
        require(
            feedbackIndex > 0 && feedbackIndex <= $.lastIndex[agentId][msg.sender],
            "invalid feedback index"
        );
        Feedback storage fb = $.feedback[agentId][msg.sender][feedbackIndex];
        require(!fb.isRevoked, "already revoked");
        fb.isRevoked = true;
        emit FeedbackRevoked(agentId, msg.sender, feedbackIndex);
    }

    /// @notice Append a response to a feedback entry.
    function appendResponse(
        uint256 agentId,
        address clientAddress,
        uint64 feedbackIndex,
        string calldata responseURI,
        bytes32 responseHash
    ) external {
        SelfReputationRegistryStorage storage $ = _getSelfReputationRegistryStorage();
        require(
            ISelfAgentRegistryMinimal($.identityRegistry).isAuthorizedOrOwner(msg.sender, agentId),
            "not agent owner or operator"
        );
        require(
            feedbackIndex > 0 && feedbackIndex <= $.lastIndex[agentId][clientAddress],
            "invalid feedback index"
        );
        require(!$.feedback[agentId][clientAddress][feedbackIndex].isRevoked, "feedback revoked");
        $.responseCount[agentId][clientAddress][feedbackIndex]++;
        emit ResponseAppended(agentId, clientAddress, feedbackIndex, msg.sender, responseURI, responseHash);
    }

    // ====================================================
    // Read — Individual Feedback
    // ====================================================

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
        Feedback storage fb = _getSelfReputationRegistryStorage().feedback[agentId][clientAddress][feedbackIndex];
        return (fb.value, fb.valueDecimals, fb.tag1, fb.tag2, fb.isRevoked, fb.endpoint, fb.feedbackURI, fb.feedbackHash);
    }

    // ====================================================
    // Read — Summary
    // ====================================================

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
        SelfReputationRegistryStorage storage $ = _getSelfReputationRegistryStorage();
        uint64 lastIdx = $.lastIndex[agentId][client];
        for (uint64 j = 1; j <= lastIdx; j++) {
            Feedback storage fb = $.feedback[agentId][client][j];
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

    function getClients(uint256 agentId) external view returns (address[] memory) {
        return _getSelfReputationRegistryStorage().clients[agentId];
    }

    function getLastIndex(uint256 agentId, address clientAddress) external view returns (uint64) {
        return _getSelfReputationRegistryStorage().lastIndex[agentId][clientAddress];
    }

    function getResponseCount(
        uint256 agentId,
        address clientAddress,
        uint64 feedbackIndex,
        address[] calldata
    ) external view returns (uint64) {
        return _getSelfReputationRegistryStorage().responseCount[agentId][clientAddress][feedbackIndex];
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
        SelfReputationRegistryStorage storage $ = _getSelfReputationRegistryStorage();
        if (!$.clientExists[agentId][client]) {
            $.clients[agentId].push(client);
            $.clientExists[agentId][client] = true;
        }
        uint64 idx = ++$.lastIndex[agentId][client];
        $.feedback[agentId][client][idx] = Feedback({
            value: value,
            valueDecimals: valueDecimals,
            isRevoked: false,
            tag1: tag1,
            tag2: tag2,
            endpoint: endpoint,
            feedbackURI: feedbackURI,
            feedbackHash: feedbackHash
        });
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
