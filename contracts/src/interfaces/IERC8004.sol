// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import { IERC165 } from "@openzeppelin/contracts/utils/introspection/IERC165.sol";

/// @title IERC8004
/// @notice Base ERC-8004 Identity Registry interface.
/// @dev Implementations MUST also implement ERC-165 and ERC-721.
///      See https://eips.ethereum.org/EIPS/eip-8004
interface IERC8004 is IERC165 {

    // ---- Events ----

    /// @notice Emitted when an agent is registered
    event Registered(uint256 indexed agentId, string agentURI, address indexed owner);

    /// @notice Emitted when an agent URI is updated
    event URIUpdated(uint256 indexed agentId, string newURI, address indexed updatedBy);

    /// @notice Emitted when on-chain metadata is set for an agent
    /// @dev `indexedMetadataKey` is keccak256(metadataKey) stored as a topic (for log filtering).
    ///      `metadataKey` contains the original string (for log reading).
    event MetadataSet(
        uint256 indexed agentId,
        string indexed indexedMetadataKey,
        string metadataKey,
        bytes metadataValue
    );

    // ---- Registration ----

    /// @notice Register an agent with no URI or metadata (base minimum)
    function register() external returns (uint256 agentId);

    /// @notice Register an agent with a URI
    function register(string calldata agentURI) external returns (uint256 agentId);

    /// @notice Register an agent with a URI and initial metadata
    /// @dev MUST revert if metadataKeys.length != metadataValues.length
    function register(
        string calldata agentURI,
        string[] calldata metadataKeys,
        bytes[] calldata metadataValues
    ) external returns (uint256 agentId);

    // ---- Agent URI ----

    /// @notice Update the agentURI for an agent
    function setAgentURI(uint256 agentId, string calldata newURI) external;

    // ---- Metadata ----

    /// @notice Get a metadata value for an agent
    function getMetadata(uint256 agentId, string memory key) external view returns (bytes memory);

    /// @notice Set a metadata value for an agent (caller must own the NFT)
    function setMetadata(uint256 agentId, string calldata key, bytes calldata value) external;

    // ---- Agent Wallet ----

    /// @notice Set a payment wallet address for an agent (requires EIP-712 signature from newWallet)
    function setAgentWallet(
        uint256 agentId,
        address newWallet,
        uint256 deadline,
        bytes calldata signature
    ) external;

    /// @notice Get the payment wallet address for an agent (returns address(0) if unset)
    function getAgentWallet(uint256 agentId) external view returns (address);

    /// @notice Clear the payment wallet address for an agent
    function unsetAgentWallet(uint256 agentId) external;
}
