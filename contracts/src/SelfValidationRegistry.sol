// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import { ImplRoot } from "./upgradeable/ImplRoot.sol";
import { ISelfAgentRegistryReader } from "./interfaces/ISelfAgentRegistryReader.sol";

/**
 * @title SelfValidationRegistry
 * @author Self Protocol
 * @notice ERC-8004 Validation Registry. Records validation requests and responses for agents.
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
 * @dev Self Protocol acts as a built-in validator via submitFreshnessValidation():
 *      response=100 when the agent's human proof is fresh, response=0 when expired.
 *      External validators can participate by responding to validation requests.
 */
contract SelfValidationRegistry is ImplRoot {

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
    // Structs
    // ====================================================

    /// @notice On-chain state of a single validation request/response pair
    struct ValidationStatus {
        address validatorAddress;
        uint256 agentId;
        uint8 response;
        bytes32 responseHash;
        string tag;
        uint256 lastUpdate;
        bool hasResponse;
    }

    // ====================================================
    // ERC-7201 Namespaced Storage
    // ====================================================

    /// @notice Central storage struct for all validation registry state (ERC-7201 namespaced)
    /// @custom:storage-location erc7201:self.storage.SelfValidationRegistry
    struct SelfValidationRegistryStorage {
        address identityRegistry;
        mapping(bytes32 => ValidationStatus) validations;
        mapping(uint256 => bytes32[]) agentValidations;
        mapping(address => bytes32[]) validatorRequests;
        mapping(uint256 => bytes32[]) freshnessHashes;
    }

    /// @dev keccak256(abi.encode(uint256(keccak256("self.storage.SelfValidationRegistry")) - 1)) & ~bytes32(uint256(0xff))
    bytes32 private constant SELFVALIDATIONREGISTRY_STORAGE_LOCATION =
        0xf29cfc1bc704e28fc8a6cee86a23220f2c463c2f2682ac69308c61b238211500;

    function _getSelfValidationRegistryStorage() private pure returns (SelfValidationRegistryStorage storage $) {
        assembly { $.slot := SELFVALIDATIONREGISTRY_STORAGE_LOCATION }
    }

    // ====================================================
    // Constructor & Initializer
    // ====================================================

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    /// @notice Initialize the validation registry with the linked identity registry and owner
    /// @param identityRegistry_ Address of the deployed SelfAgentRegistry proxy
    /// @param initialOwner Address that receives SECURITY_ROLE and OPERATIONS_ROLE
    function initialize(address identityRegistry_, address initialOwner) external initializer {
        __ImplRoot_init(initialOwner);
        require(identityRegistry_ != address(0), "bad identity");
        _getSelfValidationRegistryStorage().identityRegistry = identityRegistry_;
    }

    // ====================================================
    // External — View
    // ====================================================

    /// @notice Returns the address of the linked identity registry
    function getIdentityRegistry() external view returns (address) {
        return _getSelfValidationRegistryStorage().identityRegistry;
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
        SelfValidationRegistryStorage storage $ = _getSelfValidationRegistryStorage();
        ValidationStatus memory s = $.validations[requestHash];
        require(s.validatorAddress != address(0), "unknown request");
        return (s.validatorAddress, s.agentId, s.response, s.responseHash, s.tag, s.lastUpdate, s.hasResponse);
    }

    /// @notice Return all requestHashes for a given agent
    function getAgentValidations(uint256 agentId) external view returns (bytes32[] memory) {
        return _getSelfValidationRegistryStorage().agentValidations[agentId];
    }

    /// @notice Return all requestHashes assigned to a given validator
    function getValidatorRequests(address validatorAddress) external view returns (bytes32[] memory) {
        return _getSelfValidationRegistryStorage().validatorRequests[validatorAddress];
    }

    /// @notice Aggregate responses for an agent across a set of validators, optionally filtered by tag
    function getSummary(uint256 agentId, address[] calldata validatorAddresses, string calldata tag)
        external
        view
        returns (uint64 count, uint8 avgResponse)
    {
        SelfValidationRegistryStorage storage $ = _getSelfValidationRegistryStorage();
        uint256 total;
        for (uint256 i = 0; i < validatorAddresses.length; i++) {
            bytes32[] storage reqs = $.validatorRequests[validatorAddresses[i]];
            for (uint256 j = 0; j < reqs.length; j++) {
                ValidationStatus storage s = $.validations[reqs[j]];
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
    function validationRequest(
        address validatorAddress,
        uint256 agentId,
        string calldata requestURI,
        bytes32 requestHash
    ) external {
        SelfValidationRegistryStorage storage $ = _getSelfValidationRegistryStorage();
        require(
            ISelfAgentRegistryReader($.identityRegistry).isAuthorizedOrOwner(msg.sender, agentId),
            "not authorized"
        );
        require($.validations[requestHash].validatorAddress == address(0), "request exists");
        $.validations[requestHash] = ValidationStatus({
            validatorAddress: validatorAddress,
            agentId: agentId,
            response: 0,
            responseHash: bytes32(0),
            tag: "",
            lastUpdate: 0,
            hasResponse: false
        });
        $.agentValidations[agentId].push(requestHash);
        $.validatorRequests[validatorAddress].push(requestHash);
        emit ValidationRequest(validatorAddress, agentId, requestURI, requestHash);
    }

    /// @notice Submit or update a validation response
    function validationResponse(
        bytes32 requestHash,
        uint8 response,
        string calldata responseURI,
        bytes32 responseHash,
        string calldata tag
    ) external {
        SelfValidationRegistryStorage storage $ = _getSelfValidationRegistryStorage();
        ValidationStatus storage s = $.validations[requestHash];
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
    function submitFreshnessValidation(uint256 agentId) external {
        SelfValidationRegistryStorage storage $ = _getSelfValidationRegistryStorage();
        bool fresh = ISelfAgentRegistryReader($.identityRegistry).isProofFresh(agentId);
        bytes32 requestHash = keccak256(abi.encodePacked("freshness", agentId, block.timestamp / 1 days));

        if ($.validations[requestHash].validatorAddress == address(0)) {
            $.validations[requestHash] = ValidationStatus({
                validatorAddress: address(this),
                agentId: agentId,
                response: 0,
                responseHash: bytes32(0),
                tag: "",
                lastUpdate: 0,
                hasResponse: false
            });
            $.agentValidations[agentId].push(requestHash);
            $.freshnessHashes[agentId].push(requestHash);
            emit ValidationRequest(address(this), agentId, "", requestHash);
        }

        uint8 response = fresh ? 100 : 0;
        ValidationStatus storage s = $.validations[requestHash];
        s.response = response;
        s.tag = "freshness";
        s.lastUpdate = block.timestamp;
        s.hasResponse = true;
        emit ValidationResponse(address(this), agentId, requestHash, response, "", bytes32(0), "freshness");
    }

    /// @notice Return all day-bucket requestHashes recorded by submitFreshnessValidation for an agent
    function getFreshnessHistory(uint256 agentId) external view returns (bytes32[] memory) {
        return _getSelfValidationRegistryStorage().freshnessHashes[agentId];
    }

    /// @notice Return the current freshness state for an agent without iterating history
    function getLatestFreshness(uint256 agentId) external view returns (bool fresh, uint256 lastUpdated) {
        SelfValidationRegistryStorage storage $ = _getSelfValidationRegistryStorage();
        bytes32 todayHash = keccak256(abi.encodePacked("freshness", agentId, block.timestamp / 1 days));
        ValidationStatus storage s = $.validations[todayHash];
        if (!s.hasResponse) {
            uint256 today = block.timestamp / 1 days;
            if (today == 0) return (false, 0);
            bytes32 yesterdayHash = keccak256(abi.encodePacked("freshness", agentId, today - 1));
            ValidationStatus storage y = $.validations[yesterdayHash];
            if (!y.hasResponse) return (false, 0);
            return (y.response == 100, y.lastUpdate);
        }
        return (s.response == 100, s.lastUpdate);
    }
}
