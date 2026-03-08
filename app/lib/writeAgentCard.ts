// SPDX-FileCopyrightText: 2025-2026 Social Connect Labs, Inc.
// SPDX-License-Identifier: BUSL-1.1
// NOTE: Converts to Apache-2.0 on 2029-06-11 per LICENSE.

import { ethers } from "ethers";
import { typedProvider, typedRegistry } from "./contract-types";
import type { NetworkConfig } from "./network";
import type {
  ERC8004AgentDocument,
  ERC8004Service,
  SelfProtocolExtension,
  TrustModel,
  CardCredentials,
  AgentInterface,
} from "@selfxyz/agent-sdk";
import { getProviderLabel } from "@selfxyz/agent-sdk";

export interface WriteAgentCardResult {
  cardJson: string;
  verificationStrength: number | null;
}

/**
 * Build and write an ERC-8004 + A2A agent card on-chain via updateAgentMetadata().
 *
 * Reads the agent's proof provider, verification strength, and credentials
 * from the contract, builds the card JSON in the new ERC-8004 format with
 * optional A2A fields, and writes it on-chain.
 *
 * When `a2aUrl` is provided, the card includes `supportedInterfaces`, `url`,
 * and an A2A service entry — making it a valid A2A Agent Card.
 */
export async function writeAgentCard(
  agentId: bigint,
  registryAddress: string,
  network: NetworkConfig,
  signer: ethers.Signer,
  options?: {
    /** Display name for the agent. Defaults to "Agent #<id>". */
    name?: string;
    /** Human-readable description. */
    description?: string;
    /** Agent image/icon URL. */
    image?: string;
    /** A2A endpoint URL. When provided, the card becomes A2A-compatible. */
    a2aUrl?: string;
    /** Agent software version. */
    version?: string;
  },
): Promise<WriteAgentCardResult> {
  const provider = signer.provider!;
  const registryRead = typedRegistry(registryAddress, provider);

  // Read provider strength (may fail on older contract versions)
  let verificationStrength: number | null = null;
  let providerAddr = ethers.ZeroAddress;
  let providerName = "unknown";
  try {
    providerAddr = await registryRead.agentProofProvider(agentId);
    if (providerAddr && providerAddr !== ethers.ZeroAddress) {
      const prov = typedProvider(providerAddr, provider);
      const [strength, name] = await Promise.all([
        prov.verificationStrength(),
        prov.providerName(),
      ]);
      verificationStrength = Number(strength);
      providerName = name;
    }
  } catch {
    /* agentProofProvider not available for this agent */
  }

  // Read credentials for card
  let credentials = null;
  try {
    credentials = await registryRead.getAgentCredentials(agentId);
  } catch {
    /* no creds */
  }

  // Read chain ID
  let chainId = network.chainId;
  try {
    const net = await provider.getNetwork();
    chainId = Number(net.chainId);
  } catch {
    /* use configured chainId */
  }

  const strength = verificationStrength ?? 100;
  const proofType = getProviderLabel(strength);

  const trustModel: TrustModel = {
    proofType,
    sybilResistant: true,
    ofacScreened: credentials?.ofac?.[0] ?? false,
    minimumAgeVerified: credentials ? Number(credentials.olderThan) : 0,
  };

  let cardCredentials: CardCredentials | undefined;
  if (credentials) {
    cardCredentials = {
      nationality: credentials.nationality || undefined,
      issuingState: credentials.issuingState || undefined,
      olderThan: Number(credentials.olderThan) || undefined,
      ofacClean: credentials.ofac?.[0] ?? undefined,
      hasName: credentials.name?.length > 0 ? true : undefined,
      hasDateOfBirth: credentials.dateOfBirth ? true : undefined,
      hasGender: credentials.gender ? true : undefined,
      documentExpiry: credentials.expiryDate || undefined,
    };
  }

  const selfProtocol: SelfProtocolExtension = {
    agentId: Number(agentId),
    registry: registryAddress,
    chainId,
    proofProvider: providerAddr,
    providerName,
    verificationStrength: strength,
    trustModel,
    credentials: cardCredentials,
  };

  const agentName = options?.name ?? `Agent #${agentId}`;
  const agentDescription =
    options?.description ?? "Human-verified AI agent on Self Protocol";
  const agentImage = options?.image ?? "";

  // Build services array
  const services: ERC8004Service[] = [];
  const a2aUrl = options?.a2aUrl;
  if (a2aUrl) {
    services.push({
      name: "A2A",
      endpoint: a2aUrl,
      version: options?.version ?? "0.3.0",
    });
  }

  // Build supportedInterfaces when A2A is enabled
  let supportedInterfaces: AgentInterface[] | undefined;
  if (a2aUrl) {
    supportedInterfaces = [
      {
        url: a2aUrl,
        protocolBinding: "JSONRPC",
        protocolVersion: "0.3.0",
      },
    ];
  }

  // Build the ERC-8004 + A2A card
  const card: ERC8004AgentDocument = {
    type: "https://eips.ethereum.org/EIPS/eip-8004#registration-v1",
    name: agentName,
    description: agentDescription,
    image: agentImage,
    services,
    selfProtocol,
    ...(a2aUrl && {
      url: a2aUrl,
      version: options?.version,
      supportedInterfaces,
      iconUrl: agentImage || undefined,
      capabilities: {
        streaming: false,
        pushNotifications: false,
        stateTransitionHistory: false,
        extendedAgentCard: false,
      },
    }),
  };

  const cardJson = JSON.stringify(card, null, 2);

  // Write on-chain (compact JSON for gas efficiency)
  const registryWrite = typedRegistry(registryAddress, signer);
  const tx = await registryWrite.updateAgentMetadata(
    agentId,
    JSON.stringify(card),
  );
  await tx.wait();

  return { cardJson, verificationStrength };
}
