// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import { Ownable } from "@openzeppelin/contracts/access/Ownable.sol";
import { ISelfAgentRegistryReader } from "./interfaces/ISelfAgentRegistryReader.sol";

/// @title SelfValidationRegistry
/// @notice ERC-8004 Validation Registry. Records validation requests and responses for agents.
/// @dev Self Protocol acts as a built-in validator via submitFreshnessValidation():
///      response=100 when the agent's human proof is fresh, response=0 when expired.
///      External validators can participate by responding to validation requests.
contract SelfValidationRegistry is Ownable {

    // ====================================================
    // Events
    // ====================================================

    /// @notice Emitted when an agent owner requests validation from a validator
    event ValidationRequest(
        address indexed validatorAddress,
        uint256 indexed agentId,
        string requestURI,
        bytes32 indexed requestHash
    );

    /// @notice Emitted when a validator submits their response
    event ValidationResponse(
        address indexed validatorAddress,
        uint256 indexed agentId,
        bytes32 indexed requestHash,
        uint8 response,
        string responseURI,
        bytes32 responseHash,
        string tag
    );

    // ====================================================
    // Storage
    // ====================================================

    struct ValidationStatus {
        address validatorAddress;
        uint256 agentId;
        uint8 response;
        bytes32 responseHash;
        string tag;
        uint256 lastUpdate;
        bool hasResponse;
    }

    /// @notice The linked SelfAgentRegistry (identity registry)
    address private immutable _identityRegistry;

    /// @notice requestHash => validation status
    mapping(bytes32 => ValidationStatus) private _validations;

    /// @notice agentId => list of requestHashes involving that agent
    mapping(uint256 => bytes32[]) private _agentValidations;

    /// @notice validatorAddress => list of requestHashes assigned to that validator
    mapping(address => bytes32[]) private _validatorRequests;

    /// @notice agentId => ordered list of day-bucket requestHashes from submitFreshnessValidation
    /// @dev Keyed by agentId so iteration is O(days checked for that agent), not O(all agents × all days).
    ///      Use getFreshnessHistory() / getLatestFreshness() to read freshness data instead of getSummary().
    mapping(uint256 => bytes32[]) private _freshnessHashes;

    // ====================================================
    // Constructor
    // ====================================================

    constructor(address identityRegistry_, address initialOwner) Ownable(initialOwner) {
        require(identityRegistry_ != address(0), "bad identity");
        _identityRegistry = identityRegistry_;
    }

    // ====================================================
    // External — View
    // ====================================================

    /// @notice Returns the address of the linked identity registry
    function getIdentityRegistry() external view returns (address) {
        return _identityRegistry;
    }

    /// @notice Retrieve the current validation status for a request
    function getValidationStatus(bytes32 requestHash)
        external
        view
        returns (
            address validatorAddress,
            uint256 agentId,
            uint8 response,
            bytes32 responseHash,
            string memory tag,
            uint256 lastUpdate,
            bool hasResponse
        )
    {
        ValidationStatus memory s = _validations[requestHash];
        require(s.validatorAddress != address(0), "unknown request");
        return (s.validatorAddress, s.agentId, s.response, s.responseHash, s.tag, s.lastUpdate, s.hasResponse);
    }

    /// @notice Return all requestHashes for a given agent
    function getAgentValidations(uint256 agentId) external view returns (bytes32[] memory) {
        return _agentValidations[agentId];
    }

    /// @notice Return all requestHashes assigned to a given validator
    function getValidatorRequests(address validatorAddress) external view returns (bytes32[] memory) {
        return _validatorRequests[validatorAddress];
    }

    /// @notice Aggregate responses for an agent across a set of validators, optionally filtered by tag
    /// @dev avgResponse is computed as integer division total/count. Since response
    ///      is bounded to 0-100 and count >= 1, the result fits in uint8 without overflow.
    ///      Integer truncation applies (e.g., three scores of 99,99,100 yields avg=99).
    /// @param agentId The agent to summarise
    /// @param validatorAddresses The validators to include
    /// @param tag If non-empty, only responses with this tag are included
    /// @return count Number of matching responses
    /// @return avgResponse Average response value (0 if count == 0)
    function getSummary(uint256 agentId, address[] calldata validatorAddresses, string calldata tag)
        external
        view
        returns (uint64 count, uint8 avgResponse)
    {
        uint256 total;
        for (uint256 i = 0; i < validatorAddresses.length; i++) {
            bytes32[] storage reqs = _validatorRequests[validatorAddresses[i]];
            for (uint256 j = 0; j < reqs.length; j++) {
                ValidationStatus storage s = _validations[reqs[j]];
                if (s.agentId != agentId) continue;
                if (!s.hasResponse) continue;
                if (bytes(tag).length > 0 && keccak256(bytes(s.tag)) != keccak256(bytes(tag))) continue;
                count++;
                total += s.response;
            }
        }
        avgResponse = count > 0 ? uint8(total / count) : 0;
    }

    // ====================================================
    // External — Mutating
    // ====================================================

    /// @notice Request validation of an agent from a specific validator
    /// @dev Caller must be the agent owner, ERC-721 approved address, or approved-for-all operator.
    /// @param validatorAddress The address that will respond
    /// @param agentId The agent being validated
    /// @param requestURI Optional URI pointing to validation request data
    /// @param requestHash Hash identifying the request (caller-chosen; should be unique)
    function validationRequest(
        address validatorAddress,
        uint256 agentId,
        string calldata requestURI,
        bytes32 requestHash
    ) external {
        require(
            ISelfAgentRegistryReader(_identityRegistry).isAuthorizedOrOwner(msg.sender, agentId),
            "not authorized"
        );
        require(_validations[requestHash].validatorAddress == address(0), "request exists");
        _validations[requestHash] = ValidationStatus({
            validatorAddress: validatorAddress,
            agentId: agentId,
            response: 0,
            responseHash: bytes32(0),
            tag: "",
            lastUpdate: 0,
            hasResponse: false
        });
        _agentValidations[agentId].push(requestHash);
        _validatorRequests[validatorAddress].push(requestHash);
        emit ValidationRequest(validatorAddress, agentId, requestURI, requestHash);
    }

    /// @notice Submit or update a validation response
    /// @dev Only the validator named in the original request may call this.
    ///      May be called multiple times to update the response (e.g. soft → hard finality).
    /// @param requestHash The hash from the original ValidationRequest
    /// @param response Score 0–100 (100 = fully valid, 0 = invalid)
    /// @param responseURI Optional URI with supporting evidence
    /// @param responseHash Optional content hash of response data
    /// @param tag Semantic label for this response (e.g. "soft-finality", "hard-finality", "freshness")
    function validationResponse(
        bytes32 requestHash,
        uint8 response,
        string calldata responseURI,
        bytes32 responseHash,
        string calldata tag
    ) external {
        ValidationStatus storage s = _validations[requestHash];
        require(s.validatorAddress != address(0), "unknown request");
        require(msg.sender == s.validatorAddress, "not validator");
        require(response <= 100, "response > 100");
        s.response = response;
        s.responseHash = responseHash;
        s.tag = tag;
        s.lastUpdate = block.timestamp;
        s.hasResponse = true;
        emit ValidationResponse(msg.sender, s.agentId, requestHash, response, responseURI, responseHash, tag);
    }

    /// @notice Submit a freshness validation on behalf of Self Protocol (built-in validator)
    /// @dev Anyone can call. Uses a day-bucketed requestHash to deduplicate within the same UTC day.
    ///      response=100 if the agent's proof is fresh; response=0 if expired.
    ///      Freshness records are stored in `_freshnessHashes[agentId]`, NOT in `_validatorRequests`.
    ///      Callers should use `getFreshnessHistory()` / `getLatestFreshness()` to query freshness data
    ///      instead of `getSummary(agentId, [address(this)], "freshness")`, which will return 0.
    /// @param agentId The agent to validate
    function submitFreshnessValidation(uint256 agentId) external {
        bool fresh = ISelfAgentRegistryReader(_identityRegistry).isProofFresh(agentId);
        bytes32 requestHash = keccak256(abi.encodePacked("freshness", agentId, block.timestamp / 1 days));

        // Create the request record the first time this day-bucket is used for this agent
        if (_validations[requestHash].validatorAddress == address(0)) {
            _validations[requestHash] = ValidationStatus({
                validatorAddress: address(this),
                agentId: agentId,
                response: 0,
                responseHash: bytes32(0),
                tag: "",
                lastUpdate: 0,
                hasResponse: false
            });
            _agentValidations[agentId].push(requestHash);
            _freshnessHashes[agentId].push(requestHash);
            emit ValidationRequest(address(this), agentId, "", requestHash);
        }

        uint8 response = fresh ? 100 : 0;
        ValidationStatus storage s = _validations[requestHash];
        s.response = response;
        s.tag = "freshness";
        s.lastUpdate = block.timestamp;
        s.hasResponse = true;
        emit ValidationResponse(address(this), agentId, requestHash, response, "", bytes32(0), "freshness");
    }

    /// @notice Return all day-bucket requestHashes recorded by submitFreshnessValidation for an agent
    /// @dev Each entry corresponds to one UTC day on which submitFreshnessValidation was called.
    ///      The requestHash for a given day is keccak256(abi.encodePacked("freshness", agentId, day))
    ///      where day = block.timestamp / 1 days.  Use getValidationStatus(hash) to inspect each entry.
    /// @param agentId The agent whose freshness history to retrieve
    /// @return Array of day-bucket requestHashes in insertion order
    function getFreshnessHistory(uint256 agentId) external view returns (bytes32[] memory) {
        return _freshnessHashes[agentId];
    }

    /// @notice Return the current freshness state for an agent without iterating history
    /// @dev Reads today's day-bucket directly. If today has no entry, falls back to yesterday's
    ///      bucket so callers see the most recent known state even when the daily cron hasn't run yet.
    ///      Returns (false, 0) when no freshness check has ever been recorded for this agent.
    /// @param agentId The agent to query
    /// @return fresh   true when the most recent freshness response was 100 (proof is fresh)
    /// @return lastUpdated  block.timestamp at which that response was written (0 if none found)
    function getLatestFreshness(uint256 agentId) external view returns (bool fresh, uint256 lastUpdated) {
        bytes32 todayHash = keccak256(abi.encodePacked("freshness", agentId, block.timestamp / 1 days));
        ValidationStatus storage s = _validations[todayHash];
        if (!s.hasResponse) {
            // No freshness check today — check yesterday's bucket (guard against day 0 underflow)
            uint256 today = block.timestamp / 1 days;
            if (today == 0) return (false, 0);
            bytes32 yesterdayHash = keccak256(abi.encodePacked("freshness", agentId, today - 1));
            ValidationStatus storage y = _validations[yesterdayHash];
            if (!y.hasResponse) return (false, 0);
            return (y.response == 100, y.lastUpdate);
        }
        return (s.response == 100, s.lastUpdate);
    }
}
