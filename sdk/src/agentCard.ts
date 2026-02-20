import { ethers } from "ethers";
import { REGISTRY_ABI, PROVIDER_ABI } from "./constants";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface AgentSkill {
  name: string;
  description?: string;
}

export interface TrustModel {
  proofType: string; // "passport", "kyc", "govt_id", "liveness"
  sybilResistant: boolean;
  ofacScreened: boolean;
  minimumAgeVerified: number; // 0, 18, or 21
}

export interface CardCredentials {
  nationality?: string;
  issuingState?: string;
  olderThan?: number;
  ofacClean?: boolean;
  hasName?: boolean;
  hasDateOfBirth?: boolean;
  hasGender?: boolean;
  documentExpiry?: string;
}

export interface SelfProtocolExtension {
  agentId: number;
  registry: string;
  chainId: number;
  proofProvider: string;
  providerName: string;
  verificationStrength: number; // 0-100, from provider contract
  trustModel: TrustModel;
  credentials?: CardCredentials;
}

export interface A2AAgentCard {
  a2aVersion: "0.1";
  name: string;
  description?: string;
  url?: string;
  capabilities?: string[];
  skills?: AgentSkill[];
  selfProtocol: SelfProtocolExtension;
}

// ─── Provider Scoring ────────────────────────────────────────────────────────

export const PROVIDER_LABELS: Record<number, string> = {
  100: "passport",
  80: "kyc",
  60: "govt_id",
  40: "liveness",
};

export function getProviderLabel(strength: number): string {
  if (strength >= 100) return PROVIDER_LABELS[100];
  if (strength >= 80) return PROVIDER_LABELS[80];
  if (strength >= 60) return PROVIDER_LABELS[60];
  if (strength >= 40) return PROVIDER_LABELS[40];
  return "unknown";
}

export function getStrengthColor(
  strength: number
): "green" | "blue" | "amber" | "gray" {
  if (strength >= 80) return "green";
  if (strength >= 60) return "blue";
  if (strength >= 40) return "amber";
  return "gray";
}

// ─── Build Card from On-Chain Data ───────────────────────────────────────────

export async function buildAgentCard(
  agentId: number,
  registry: ethers.Contract,
  provider: ethers.Contract,
  userFields: {
    name: string;
    description?: string;
    url?: string;
    skills?: AgentSkill[];
  }
): Promise<A2AAgentCard> {
  const [
    providerName,
    verificationStrength,
    credentials,
    registryAddress,
    chainId,
    proofProviderAddress,
  ] = await Promise.all([
    provider.providerName() as Promise<string>,
    provider.verificationStrength() as Promise<number>,
    registry.getAgentCredentials(agentId).catch(() => null),
    registry.getAddress() as Promise<string>,
    (registry.runner?.provider
      ?.getNetwork()
      .then((n: ethers.Network) => Number(n.chainId)) ?? Promise.resolve(0)
    ).catch(() => 0),
    provider.getAddress() as Promise<string>,
  ]);

  const proofType = getProviderLabel(Number(verificationStrength));
  const strength = Number(verificationStrength);

  const trustModel: TrustModel = {
    proofType,
    sybilResistant: true,
    ofacScreened: false,
    minimumAgeVerified: 0,
  };

  let cardCredentials: CardCredentials | undefined;

  if (credentials) {
    const olderThan = Number(credentials.olderThan ?? 0);
    const ofac = credentials.ofac ?? [false, false, false];
    const ofacScreened = ofac[0] === true;

    trustModel.ofacScreened = ofacScreened;
    trustModel.minimumAgeVerified = olderThan;

    cardCredentials = {
      nationality: credentials.nationality || undefined,
      issuingState: credentials.issuingState || undefined,
      olderThan: olderThan || undefined,
      ofacClean: ofacScreened || undefined,
      hasName: (credentials.name?.length ?? 0) > 0 ? true : undefined,
      hasDateOfBirth: credentials.dateOfBirth ? true : undefined,
      hasGender: credentials.gender ? true : undefined,
      documentExpiry: credentials.expiryDate || undefined,
    };
  }

  return {
    a2aVersion: "0.1",
    name: userFields.name,
    description: userFields.description,
    url: userFields.url,
    skills: userFields.skills,
    selfProtocol: {
      agentId,
      registry: registryAddress,
      chainId,
      proofProvider: proofProviderAddress,
      providerName,
      verificationStrength: strength,
      trustModel,
      credentials: cardCredentials,
    },
  };
}
