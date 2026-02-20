// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import { Ownable } from "@openzeppelin/contracts/access/Ownable.sol";

/// @title ISelfAgentRegistryReader
/// @notice Minimal read interface for SelfAgentRegistry
interface ISelfAgentRegistryValidation {
    function hasHumanProof(uint256 agentId) external view returns (bool);
    function getProofProvider(uint256 agentId) external view returns (address);
    function agentRegisteredAt(uint256 agentId) external view returns (uint256);
}

/// @title SelfValidationProvider
/// @notice ERC-8004 compatible real-time proof validation with freshness checks.
/// @dev Stateless view-only wrapper over SelfAgentRegistry.
///      Freshness is measured in blocks since registration.
///      Celo ~5s/block -> ~6.3M blocks/year.
contract SelfValidationProvider is Ownable {
    ISelfAgentRegistryValidation public immutable registry;

    /// @notice Configurable freshness threshold (blocks). Default: ~1 year of Celo blocks.
    uint256 public freshnessThreshold;

    /// @dev ~6.3M blocks/year on Celo (5s block time)
    uint256 private constant DEFAULT_FRESHNESS = 6_307_200;

    constructor(address _registry) Ownable(msg.sender) {
        registry = ISelfAgentRegistryValidation(_registry);
        freshnessThreshold = DEFAULT_FRESHNESS;
    }

    /// @notice Validate an agent's current proof status.
    function validateAgent(uint256 agentId)
        external
        view
        returns (bool valid, bool fresh, uint256 registeredAt, uint256 blockAge, address proofProvider)
    {
        valid = registry.hasHumanProof(agentId);
        registeredAt = registry.agentRegisteredAt(agentId);
        proofProvider = registry.getProofProvider(agentId);

        if (registeredAt > 0 && registeredAt <= block.number) {
            blockAge = block.number - registeredAt;
        }
        fresh = valid && registeredAt > 0 && blockAge <= freshnessThreshold;
    }

    /// @notice Quick boolean check — is this agent valid and fresh?
    function isValidAgent(uint256 agentId) external view returns (bool) {
        if (!registry.hasHumanProof(agentId)) return false;
        uint256 registeredAt = registry.agentRegisteredAt(agentId);
        if (registeredAt == 0 || registeredAt > block.number) return false;
        return (block.number - registeredAt) <= freshnessThreshold;
    }

    /// @notice Set the freshness threshold (owner-only).
    function setFreshnessThreshold(uint256 blocks) external onlyOwner {
        freshnessThreshold = blocks;
    }

    /// @notice Batch validation.
    function validateBatch(uint256[] calldata agentIds) external view returns (bool[] memory valid) {
        valid = new bool[](agentIds.length);
        for (uint256 i; i < agentIds.length; ++i) {
            if (!registry.hasHumanProof(agentIds[i])) continue;
            uint256 registeredAt = registry.agentRegisteredAt(agentIds[i]);
            if (registeredAt == 0 || registeredAt > block.number) continue;
            valid[i] = (block.number - registeredAt) <= freshnessThreshold;
        }
    }

    /// @notice Provider metadata.
    function name() external pure returns (string memory) {
        return "Self Protocol";
    }

    function version() external pure returns (string memory) {
        return "1.0";
    }
}
