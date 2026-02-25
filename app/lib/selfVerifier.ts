// SPDX-FileCopyrightText: 2025-2026 Social Connect Labs, Inc.
// SPDX-License-Identifier: BUSL-1.1
// NOTE: Converts to Apache-2.0 on 2029-06-11 per LICENSE.

import { SelfAgentVerifier } from "@selfxyz/agent-sdk";
import { getNetwork, type NetworkId } from "@/lib/network";

type VerifierProfile = {
  maxAgentsPerHuman: number;
  includeCredentials: boolean;
  enableReplayProtection?: boolean;
  replayCacheMaxEntries?: number;
};

const verifierCache = new Map<string, SelfAgentVerifier>();

function cacheKey(networkId: NetworkId, profile: VerifierProfile): string {
  return [
    networkId,
    profile.maxAgentsPerHuman,
    profile.includeCredentials ? "creds" : "no-creds",
    (profile.enableReplayProtection ?? true) ? "replay-on" : "replay-off",
    profile.replayCacheMaxEntries ?? 10_000,
  ].join(":");
}

/**
 * Reuse verifier instances so in-memory caches (especially replay cache)
 * survive across requests in the running server process.
 */
export function getCachedVerifier(
  networkId: NetworkId,
  profile: VerifierProfile,
): SelfAgentVerifier {
  const key = cacheKey(networkId, profile);
  const existing = verifierCache.get(key);
  if (existing) return existing;

  const network = getNetwork(networkId);
  const builder = SelfAgentVerifier.create()
    .registry(network.registryAddress)
    .rpc(network.rpcUrl)
    .sybilLimit(profile.maxAgentsPerHuman)
    .replayProtection(profile.enableReplayProtection ?? true);

  if (profile.includeCredentials) {
    builder.includeCredentials();
  }

  const verifier = builder.build();
  verifierCache.set(key, verifier);
  return verifier;
}
