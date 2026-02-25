// SPDX-License-Identifier: MIT

pragma solidity 0.8.28;

import { IHumanProofProvider } from "./interfaces/IHumanProofProvider.sol";
import { ISelfAgentRegistryReader } from "./interfaces/ISelfAgentRegistryReader.sol";

/// @title SelfReputationSignal
/// @author Self Protocol
/// @notice ERC-8004 compatible reputation scoring — reads verification strength from proof providers.
/// @dev Stateless view-only wrapper over SelfAgentRegistry + IHumanProofProvider.
///      Score comes from the provider that verified the agent, not computed here.
contract SelfReputationSignal {
    /// @notice The SelfAgentRegistry used for agent and provider lookups
    ISelfAgentRegistryReader public immutable registry;

    /// @param _registry Address of the deployed SelfAgentRegistry
    constructor(address _registry) {
        registry = ISelfAgentRegistryReader(_registry);
    }

    /// @notice Get reputation score for an agent (0-100).
    /// @dev Reads verificationStrength() from the provider that verified this agent.
    ///      Returns 0 if agent has no human proof.
    /// @param agentId The agent to query
    /// @return score The reputation score (0-100), or 0 if unverified
    function getReputationScore(uint256 agentId) external view returns (uint8 score) {
        if (!registry.hasHumanProof(agentId)) return 0;
        address provider = registry.getProofProvider(agentId);
        if (provider == address(0)) return 0;
        return IHumanProofProvider(provider).verificationStrength();
    }

    /// @notice Get full reputation details for an agent.
    /// @param agentId The agent to query
    /// @return score The reputation score (0-100)
    /// @return providerName The name of the proof provider (e.g. "Self Protocol")
    /// @return hasProof Whether the agent has an active human proof
    /// @return registeredAtBlock The block number at which the agent was registered
    function getReputation(uint256 agentId)
        external
        view
        returns (uint8 score, string memory providerName, bool hasProof, uint256 registeredAtBlock)
    {
        hasProof = registry.hasHumanProof(agentId);
        registeredAtBlock = registry.agentRegisteredAt(agentId);
        if (!hasProof) return (0, "", false, registeredAtBlock);

        address provider = registry.getProofProvider(agentId);
        if (provider == address(0)) return (0, "", true, registeredAtBlock);

        score = IHumanProofProvider(provider).verificationStrength();
        providerName = IHumanProofProvider(provider).providerName();
    }

    /// @notice Batch query — get reputation scores for multiple agents at once.
    /// @param agentIds Array of agent IDs to query
    /// @return scores Array of reputation scores (0-100), matching agentIds order
    function getReputationBatch(uint256[] calldata agentIds) external view returns (uint8[] memory scores) {
        scores = new uint8[](agentIds.length);
        for (uint256 i; i < agentIds.length; ++i) {
            if (!registry.hasHumanProof(agentIds[i])) continue;
            address provider = registry.getProofProvider(agentIds[i]);
            if (provider == address(0)) continue;
            scores[i] = IHumanProofProvider(provider).verificationStrength();
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
