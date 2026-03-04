// SPDX-FileCopyrightText: 2025-2026 Social Connect Labs, Inc.
// SPDX-License-Identifier: BUSL-1.1
// NOTE: Converts to Apache-2.0 on 2029-06-11 per LICENSE.

import { ethers } from "ethers";
import { typedProvider, typedRegistry } from "./contract-types";
import type { NetworkConfig } from "./network";

export interface WriteAgentCardResult {
  cardJson: string;
  verificationStrength: number | null;
}

/**
 * Build and write an A2A agent card on-chain via updateAgentMetadata().
 *
 * Reads the agent's proof provider, verification strength, and credentials
 * from the contract, builds the card JSON, and writes it on-chain.
 */
export async function writeAgentCard(
  agentId: bigint,
  registryAddress: string,
  network: NetworkConfig,
  signer: ethers.Signer,
): Promise<WriteAgentCardResult> {
  const provider = signer.provider!;
  const registryRead = typedRegistry(registryAddress, provider);

  // Read provider strength
  let verificationStrength: number | null = null;
  const providerAddr: string = await registryRead.agentProofProvider(agentId);
  if (providerAddr && providerAddr !== ethers.ZeroAddress) {
    const prov = typedProvider(providerAddr, provider);
    const strength: number = await prov.verificationStrength();
    verificationStrength = Number(strength);
  }

  // Read credentials for card
  let credentials = null;
  try {
    credentials = await registryRead.getAgentCredentials(agentId);
  } catch {
    /* no creds */
  }

  // Build card JSON
  const card = {
    a2aVersion: "0.1",
    name: `Agent #${agentId}`,
    description: "Human-verified AI agent on Self Protocol",
    selfProtocol: {
      agentId: Number(agentId),
      registry: registryAddress,
      chainId: network.chainId,
      proofProvider: providerAddr,
      providerName:
        providerAddr !== ethers.ZeroAddress ? "self" : "unknown",
      verificationStrength: verificationStrength ?? 100,
      trustModel: {
        proofType: "passport",
        sybilResistant: true,
        ofacScreened: credentials?.ofac?.[0] ?? false,
        minimumAgeVerified: credentials ? Number(credentials.olderThan) : 0,
      },
      ...(credentials
        ? {
            credentials: {
              nationality: credentials.nationality || undefined,
              issuingState: credentials.issuingState || undefined,
              olderThan: Number(credentials.olderThan) || undefined,
              ofacClean: credentials.ofac?.[0] ?? undefined,
              hasName: credentials.name?.length > 0 ? true : undefined,
              hasDateOfBirth: credentials.dateOfBirth ? true : undefined,
              hasGender: credentials.gender ? true : undefined,
              documentExpiry: credentials.expiryDate || undefined,
            },
          }
        : {}),
    },
  };

  const cardJson = JSON.stringify(card, null, 2);

  // Write on-chain
  const registryWrite = typedRegistry(registryAddress, signer);
  const tx = await registryWrite.updateAgentMetadata(
    agentId,
    JSON.stringify(card),
  );
  await tx.wait();

  return { cardJson, verificationStrength };
}
