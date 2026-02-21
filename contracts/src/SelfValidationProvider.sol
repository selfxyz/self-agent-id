// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import { Ownable } from "@openzeppelin/contracts/access/Ownable.sol";
import { ISelfAgentRegistryReader } from "./interfaces/ISelfAgentRegistryReader.sol";

/// @title SelfValidationProvider
/// @notice ERC-8004 compatible real-time proof validation with freshness checks.
/// @dev Stateless view-only wrapper over SelfAgentRegistry.
///      Freshness is measured in blocks since registration.
///      Celo ~5s/block -> ~6.3M blocks/year.
contract SelfValidationProvider is Ownable {
    ISelfAgentRegistryReader public immutable registry;

    /// @notice Configurable freshness threshold (blocks). Default: ~1 year of Celo blocks.
    uint256 public freshnessThreshold;

    /// @dev ~6.3M blocks/year on Celo (5s block time)
    uint256 private constant DEFAULT_FRESHNESS = 6_307_200;

    /// @param _registry Address of the deployed SelfAgentRegistry
    constructor(address _registry) Ownable(msg.sender) {
        registry = ISelfAgentRegistryReader(_registry);
        freshnessThreshold = DEFAULT_FRESHNESS;
    }

    /// @notice Validate an agent's current proof status with full details.
    /// @param agentId The agent to validate
    /// @return valid Whether the agent has an active human proof
    /// @return fresh Whether the proof is within the freshness threshold
    /// @return registeredAt The block number at which the agent was registered
    /// @return blockAge Number of blocks since registration
    /// @return proofProvider The address of the provider that verified the agent
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
    /// @param agentId The agent to check
    /// @return True if the agent has a valid proof within the freshness threshold
    function isValidAgent(uint256 agentId) external view returns (bool) {
        if (!registry.hasHumanProof(agentId)) return false;
        uint256 registeredAt = registry.agentRegisteredAt(agentId);
        if (registeredAt == 0 || registeredAt > block.number) return false;
        return (block.number - registeredAt) <= freshnessThreshold;
    }

    /// @notice Set the freshness threshold (owner-only).
    /// @param blocks The new threshold in blocks (0 = no freshness requirement)
    function setFreshnessThreshold(uint256 blocks) external onlyOwner {
        freshnessThreshold = blocks;
    }

    /// @notice Batch validation — check multiple agents at once.
    /// @param agentIds Array of agent IDs to validate
    /// @return valid Array of booleans indicating if each agent is valid and fresh
    function validateBatch(uint256[] calldata agentIds) external view returns (bool[] memory valid) {
        valid = new bool[](agentIds.length);
        for (uint256 i; i < agentIds.length; ++i) {
            if (!registry.hasHumanProof(agentIds[i])) continue;
            uint256 registeredAt = registry.agentRegisteredAt(agentIds[i]);
            if (registeredAt == 0 || registeredAt > block.number) continue;
            valid[i] = (block.number - registeredAt) <= freshnessThreshold;
        }
    }

    /// @notice Provider metadata — returns the provider name.
    /// @return The provider name string
    function name() external pure returns (string memory) {
        return "Self Protocol";
    }

    /// @notice Provider metadata — returns the provider version.
    /// @return The version string
    function version() external pure returns (string memory) {
        return "1.0";
    }
}
