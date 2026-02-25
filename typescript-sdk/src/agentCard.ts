// SPDX-FileCopyrightText: 2025-2026 Social Connect Labs, Inc.
// SPDX-License-Identifier: BUSL-1.1
// NOTE: Converts to Apache-2.0 on 2029-06-11 per LICENSE.

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

// ─── A2A Agent Card sub-types ────────────────────────────────────────────────

export interface A2ACapabilities {
  streaming: boolean;
  pushNotifications: boolean;
}

export interface A2AProvider {
  name: string;
  url?: string;
  email?: string;
}

export interface A2ASecurityScheme {
  type: "bearer" | "apiKey" | "oauth2" | "none";
  description?: string;
}

// ─── ERC-8004 service entry ───────────────────────────────────────────────────

export interface ERC8004Service {
  name: "web" | "A2A" | "MCP" | "OASF" | "ENS" | "DID" | "email" | string;
  endpoint: string;
  version?: string;
}

// ─── Cross-chain registration reference (CAIP-10) ────────────────────────────

export interface ERC8004Registration {
  agentId: number;
  agentRegistry: string; // CAIP-10: eip155:<chainId>:<address>
}

// ─── The combined ERC-8004 + A2A document ────────────────────────────────────

export interface ERC8004AgentDocument {
  // ── ERC-8004 required ──
  type: "https://eips.ethereum.org/EIPS/eip-8004#registration-v1";
  name: string;
  description: string;
  image: string;
  services: ERC8004Service[];

  // ── ERC-8004 optional ──
  active?: boolean;
  registrations?: ERC8004Registration[];
  supportedTrust?: ("reputation" | "crypto-economic" | "tee-attestation")[];

  // ── A2A optional (when present, makes this a valid A2A Agent Card) ──
  version?: string; // agent software version, e.g. "0.1.0"
  url?: string; // A2A primary endpoint — MUST equal services[name="A2A"].endpoint
  provider?: A2AProvider;
  capabilities?: A2ACapabilities;
  securitySchemes?: A2ASecurityScheme[];
  defaultInputModes?: string[]; // MIME types, e.g. ["text/plain", "application/json"]
  defaultOutputModes?: string[]; // MIME types

  // ── Self Protocol extension (on-chain proof metadata) ──
  selfProtocol?: SelfProtocolExtension;

  // ── A2A skills ──
  skills?: AgentSkill[];
}

// Backward-compat alias
export type A2AAgentCard = ERC8004AgentDocument;

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
    image?: string;
    url?: string;
    services?: ERC8004Service[];
    skills?: AgentSkill[];
    version?: string;
    agentProvider?: A2AProvider;
    capabilities?: A2ACapabilities;
    securitySchemes?: A2ASecurityScheme[];
  }
): Promise<ERC8004AgentDocument> {
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
    type: "https://eips.ethereum.org/EIPS/eip-8004#registration-v1",
    name: userFields.name,
    description: userFields.description ?? "",
    image: userFields.image ?? "",
    services:
      userFields.services ??
      (userFields.url
        ? [{ name: "A2A", endpoint: userFields.url, version: "1.0" }]
        : []),
    url: userFields.url,
    version: userFields.version,
    provider: userFields.agentProvider,
    capabilities: userFields.capabilities,
    securitySchemes: userFields.securitySchemes,
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

// ─── Synchronous Registration JSON Builder ───────────────────────────────────

export interface GenerateRegistrationJSONOptions {
  // ERC-8004 required
  name: string;
  description: string;
  image: string;
  services: ERC8004Service[];

  // ERC-8004 optional
  active?: boolean;
  registrations?: ERC8004Registration[];
  supportedTrust?: ERC8004AgentDocument["supportedTrust"];

  // A2A optional — include to make the document also a valid A2A Agent Card
  a2a?: {
    version: string;
    url: string; // MUST match services[name="A2A"].endpoint
    provider: A2AProvider;
    capabilities?: A2ACapabilities;
    securitySchemes?: A2ASecurityScheme[];
    defaultInputModes?: string[];
    defaultOutputModes?: string[];
    skills?: AgentSkill[];
  };
}

export function generateRegistrationJSON(
  options: GenerateRegistrationJSONOptions
): ERC8004AgentDocument {
  return {
    type: "https://eips.ethereum.org/EIPS/eip-8004#registration-v1",
    name: options.name,
    description: options.description,
    image: options.image,
    services: options.services,
    active: options.active,
    registrations: options.registrations,
    supportedTrust: options.supportedTrust,
    ...(options.a2a && {
      version: options.a2a.version,
      url: options.a2a.url,
      provider: options.a2a.provider,
      capabilities: options.a2a.capabilities ?? {
        streaming: false,
        pushNotifications: false,
      },
      securitySchemes: options.a2a.securitySchemes ?? [{ type: "none" }],
      defaultInputModes: options.a2a.defaultInputModes,
      defaultOutputModes: options.a2a.defaultOutputModes,
      skills: options.a2a.skills,
    }),
  };
}
