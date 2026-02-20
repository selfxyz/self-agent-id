// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import { IHumanProofProvider } from "./interfaces/IHumanProofProvider.sol";

/// @title ISelfAgentRegistryReader
/// @notice Minimal read interface for SelfAgentRegistry
interface ISelfAgentRegistryReader {
    function hasHumanProof(uint256 agentId) external view returns (bool);
    function getProofProvider(uint256 agentId) external view returns (address);
    function agentRegisteredAt(uint256 agentId) external view returns (uint256);
}

/// @title SelfReputationProvider
/// @notice ERC-8004 compatible reputation scoring — reads verification strength from proof providers.
/// @dev Stateless view-only wrapper over SelfAgentRegistry + IHumanProofProvider.
///      Score comes from the provider that verified the agent, not computed here.
contract SelfReputationProvider {
    ISelfAgentRegistryReader public immutable registry;

    constructor(address _registry) {
        registry = ISelfAgentRegistryReader(_registry);
    }

    /// @notice Get reputation score for an agent (0-100).
    /// @dev Reads verificationStrength() from the provider that verified this agent.
    ///      Returns 0 if agent has no human proof.
    function getReputationScore(uint256 agentId) external view returns (uint8 score) {
        if (!registry.hasHumanProof(agentId)) return 0;
        address provider = registry.getProofProvider(agentId);
        if (provider == address(0)) return 0;
        return IHumanProofProvider(provider).verificationStrength();
    }

    /// @notice Get full reputation details.
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

    /// @notice Batch query — check multiple agents at once.
    function getReputationBatch(uint256[] calldata agentIds) external view returns (uint8[] memory scores) {
        scores = new uint8[](agentIds.length);
        for (uint256 i; i < agentIds.length; ++i) {
            if (!registry.hasHumanProof(agentIds[i])) continue;
            address provider = registry.getProofProvider(agentIds[i]);
            if (provider == address(0)) continue;
            scores[i] = IHumanProofProvider(provider).verificationStrength();
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
