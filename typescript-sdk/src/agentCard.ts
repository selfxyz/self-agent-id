// SPDX-FileCopyrightText: 2025-2026 Social Connect Labs, Inc.
// SPDX-License-Identifier: BUSL-1.1
// NOTE: Converts to Apache-2.0 on 2029-06-11 per LICENSE.

/**
 * ERC-8004 agent document / A2A Agent Card types and builders.
 *
 * `buildAgentCard` reads proof data from chain; `generateRegistrationJSON`
 * builds a document from plain options with no chain access.
 */

import type { ethers } from "ethers";
import type {
  TypedRegistryContract,
  TypedProviderContract,
} from "./contract-types";

// ─── Types ───────────────────────────────────────────────────────────────────

/** A capability or skill that the agent can perform, used in A2A Agent Cards. */
export interface AgentSkill {
  /** Unique identifier for this skill (required per A2A v0.3.0). */
  id: string;
  /** Human-readable skill name. */
  name: string;
  description?: string;
  /** Freeform tags for categorization. */
  tags?: string[];
  /** Example prompts or inputs that exercise this skill. */
  examples?: string[];
  /** MIME types this skill accepts as input. Overrides card-level defaultInputModes. */
  inputModes?: string[];
  /** MIME types this skill can produce. Overrides card-level defaultOutputModes. */
  outputModes?: string[];
}

/** Trust characteristics derived from the on-chain proof provider. */
export interface TrustModel {
  /** Provider label: "passport", "kyc", "govt_id", "liveness" or "unknown". */
  proofType: string;
  /** The agent has an on-chain human proof (`hasHumanProof`), i.e. a nullifier-bound human behind it. */
  sybilResistant: boolean;
  ofacScreened: boolean;
  /** Verified minimum age (`olderThan` from chain): 0, 18 or 21. */
  minimumAgeVerified: number;
}

/** Optional credential disclosures extracted from on-chain agent registration data. */
export interface CardCredentials {
  nationality?: string;
  /** Issuing state of the identity document. */
  issuingState?: string;
  olderThan?: number;
  ofacClean?: boolean;
  /** The has* flags say a field was disclosed without revealing its value. */
  hasName?: boolean;
  hasDateOfBirth?: boolean;
  hasGender?: boolean;
  /** Identity document expiry date, as stored on-chain. */
  documentExpiry?: string;
}

/** On-chain proof metadata attached to an agent document via the Self Protocol. */
export interface SelfProtocolExtension {
  agentId: number;
  /** Registry contract address. */
  registry: string;
  /** Chain ID, or 0 if the runner had no provider to ask. */
  chainId: number;
  /** Proof provider contract address. */
  proofProvider: string;
  providerName: string;
  /** 0-100, from the provider contract. */
  verificationStrength: number;
  trustModel: TrustModel;
  credentials?: CardCredentials;
}

// ─── A2A Agent Card sub-types ────────────────────────────────────────────────

/** A2A v0.3.0 agent interface declaration describing a protocol endpoint. */
export interface AgentInterface {
  /** The URL of this interface endpoint. */
  url: string;
  /** The protocol binding used by this interface. */
  protocolBinding: "JSONRPC" | "GRPC" | "HTTP+JSON";
  /** The A2A protocol version, e.g. "0.3.0". */
  protocolVersion: string;
}

/** Feature flags describing what the A2A agent endpoint supports. */
export interface A2ACapabilities {
  /** Supports `message/stream` (SSE). */
  streaming: boolean;
  /** Supports push notification configs. */
  pushNotifications: boolean;
  /** Whether the agent exposes full task state transition history. */
  stateTransitionHistory?: boolean;
  /** Whether the agent supports an extended agent card endpoint. */
  extendedAgentCard?: boolean;
}

/** Organization or individual that operates the A2A agent. */
export interface A2AProvider {
  name: string;
  url?: string;
  email?: string;
}

// ─── Security Scheme types (A2A v0.3.0 / OpenAPI-style) ─────────────────────

/** API Key authentication scheme. */
export interface APIKeySecurityScheme {
  type: "apiKey";
  name: string;
  in: "header" | "query" | "cookie";
  description?: string;
}

/** HTTP authentication scheme (e.g. Bearer). */
export interface HTTPAuthSecurityScheme {
  type: "http";
  /** HTTP auth scheme name, e.g. "bearer". */
  scheme: string;
  bearerFormat?: string;
  description?: string;
}

/** OAuth2 authentication scheme. */
export interface OAuth2SecurityScheme {
  type: "oauth2";
  flows: Record<string, unknown>;
  description?: string;
}

/** OpenID Connect authentication scheme. */
export interface OpenIdConnectSecurityScheme {
  type: "openIdConnect";
  openIdConnectUrl: string;
  description?: string;
}

/** Discriminated union of all supported A2A security scheme types. */
export type SecurityScheme =
  | APIKeySecurityScheme
  | HTTPAuthSecurityScheme
  | OAuth2SecurityScheme
  | OpenIdConnectSecurityScheme;

/**
 * Named map of security schemes (OpenAPI-style).
 * Keys are scheme names referenced by SecurityRequirement entries.
 */
export type SecuritySchemes = Record<string, SecurityScheme>;

/**
 * A security requirement entry: maps a scheme name to a list of scopes.
 * For non-OAuth2 schemes the scopes array is typically empty.
 */
export type SecurityRequirement = Record<string, string[]>;

// ─── Signatures & Extensions ─────────────────────────────────────────────────

/** RFC 7515 JWS signature attached to the agent card. */
export interface JWSSignature {
  /** The protected header (Base64url-encoded). */
  protected: string;
  /** The JWS signature value (Base64url-encoded). */
  signature: string;
  /** Optional unprotected header parameters. */
  header?: Record<string, unknown>;
}

/** An agent card extension declaration. */
export interface AgentExtension {
  /** URI identifying the extension specification. */
  uri: string;
  /** Extension-specific data. */
  [key: string]: unknown;
}

// ─── ERC-8004 service entry ───────────────────────────────────────────────────

/** A service endpoint entry in the ERC-8004 agent document. */
export interface ERC8004Service {
  /** Service kind; well-known values listed, any string allowed. */
  name:
    | "web"
    | "A2A"
    | "MCP"
    | "OASF"
    | "ENS"
    | "DID"
    | "email"
    | (string & {});
  endpoint: string;
  version?: string;
}

// ─── Cross-chain registration reference (CAIP-10) ────────────────────────────

/** Cross-chain registration reference using CAIP-10 addressing. */
export interface ERC8004Registration {
  agentId: number;
  /** CAIP-10 registry reference: `eip155:<chainId>:<address>`. */
  agentRegistry: string;
}

// ─── The combined ERC-8004 + A2A document ────────────────────────────────────

/**
 * Combined ERC-8004 registration document with optional A2A Agent Card fields
 * and Self Protocol on-chain proof metadata.
 */
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
  /** Agent software version, e.g. "0.1.0". */
  version?: string;
  /** A2A primary endpoint; MUST equal `services[name="A2A"].endpoint`. */
  url?: string;
  provider?: A2AProvider;
  capabilities?: A2ACapabilities;

  /**
   * Named map of security schemes (A2A v0.3.0 / OpenAPI-style).
   * Keys are scheme names referenced by `security` entries.
   */
  securitySchemes?: SecuritySchemes;

  /**
   * Security requirements for accessing the agent.
   * Each entry maps a scheme name (from securitySchemes) to required scopes.
   */
  security?: SecurityRequirement[];

  /** Accepted input MIME types, e.g. ["text/plain", "application/json"]. */
  defaultInputModes?: string[];
  /** Produced output MIME types. */
  defaultOutputModes?: string[];

  /** A2A v0.3.0 structured interface declarations. */
  supportedInterfaces?: AgentInterface[];

  /** URL to agent icon/avatar. Maps to/from ERC-8004 `image`. */
  iconUrl?: string;

  /** URL to agent documentation. */
  documentationUrl?: string;

  /** RFC 7515 JWS signatures attached to this card. */
  signatures?: JWSSignature[];

  /** Agent card extension declarations. */
  extensions?: AgentExtension[];

  // ── Self Protocol extension (on-chain proof metadata) ──
  selfProtocol?: SelfProtocolExtension;

  // ── A2A skills ──
  skills?: AgentSkill[];
}

/** Backward-compatible alias for `ERC8004AgentDocument`. */
export type A2AAgentCard = ERC8004AgentDocument;

/** A2A protocol version this SDK implements; used for auto-added A2A services and interfaces. */
export const A2A_PROTOCOL_VERSION = "0.3.0";

// ─── Provider Scoring ────────────────────────────────────────────────────────

/** Provider label for each verification strength threshold. */
export const PROVIDER_LABELS: Record<number, string> = {
  100: "passport",
  80: "kyc",
  60: "govt_id",
  40: "liveness",
};

/**
 * Map a numeric verification strength to a human-readable provider label.
 *
 * @param strength - Verification strength score (0-100) from the proof provider contract.
 * @returns A label such as "passport", "kyc", "govt_id", "liveness", or "unknown".
 */
export function getProviderLabel(strength: number): string {
  if (strength >= 100) return PROVIDER_LABELS[100];
  if (strength >= 80) return PROVIDER_LABELS[80];
  if (strength >= 60) return PROVIDER_LABELS[60];
  if (strength >= 40) return PROVIDER_LABELS[40];
  return "unknown";
}

/**
 * Map a numeric verification strength to a UI-friendly color tier.
 *
 * @param strength - Verification strength score (0-100).
 * @returns A color string: "green" (>=80), "blue" (>=60), "amber" (>=40), or "gray".
 */
export function getStrengthColor(
  strength: number,
): "green" | "blue" | "amber" | "gray" {
  if (strength >= 80) return "green";
  if (strength >= 60) return "blue";
  if (strength >= 40) return "amber";
  return "gray";
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Slugify a string into a URL/ID-safe lowercase-hyphenated form.
 * Used to auto-generate skill `id` values when not explicitly provided.
 *
 * @param s - Input text.
 * @returns Lowercase string of `[a-z0-9-]` with no leading/trailing hyphen.
 */
function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

/**
 * Fill in missing skill IDs from the skill name (shared by both builders).
 *
 * @param skills - Caller-supplied skills, possibly without `id`.
 * @returns New skill objects, each with an `id`; undefined when `skills` is.
 */
function withSkillIds(skills?: AgentSkill[]): AgentSkill[] | undefined {
  return skills?.map((skill) => ({
    ...skill,
    id: skill.id || slugify(skill.name),
  }));
}

// ─── Build Card from On-Chain Data ───────────────────────────────────────────

/**
 * Build a complete ERC-8004 agent document by reading on-chain registry and provider data.
 *
 * Fetches the provider name, verification strength, and credential disclosures from
 * the contracts and merges them with the caller-supplied display fields.
 * If `services` is omitted and `url` is set, a single A2A service entry is added
 * (its `version` is the A2A protocol version, {@link A2A_PROTOCOL_VERSION}).
 * Skills without an `id` get one generated from the name, and
 * `trustModel.sybilResistant` is the agent's on-chain `hasHumanProof` (as in
 * the cards served by the Self Agent ID API).
 *
 * @param agentId - On-chain agent ID.
 * @param registry - Typed SelfAgentRegistry contract.
 * @param provider - Typed IHumanProofProvider contract for the agent's proof provider.
 * @param userFields - Display and service fields supplied by the caller (`name` required).
 * @returns A fully populated {@link ERC8004AgentDocument}.
 * @throws If reading the provider name, strength, `hasHumanProof` or either
 *   contract address fails (credential and chain ID lookups fall back silently).
 */
export async function buildAgentCard(
  agentId: number,
  registry: TypedRegistryContract,
  provider: TypedProviderContract,
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
    securitySchemes?: SecuritySchemes;
    security?: SecurityRequirement[];
    supportedInterfaces?: AgentInterface[];
    iconUrl?: string;
    documentationUrl?: string;
    signatures?: JWSSignature[];
    extensions?: AgentExtension[];
  },
): Promise<ERC8004AgentDocument> {
  const [
    providerName,
    verificationStrength,
    credentials,
    registryAddress,
    chainId,
    proofProviderAddress,
    hasHumanProof,
  ] = await Promise.all([
    provider.providerName(),
    provider.verificationStrength(),
    registry.getAgentCredentials(BigInt(agentId)).catch(() => null),
    registry.getAddress(),
    (
      registry.runner?.provider
        ?.getNetwork()
        .then((n: ethers.Network) => Number(n.chainId)) ?? Promise.resolve(0)
    ).catch(() => 0),
    provider.getAddress(),
    registry.hasHumanProof(BigInt(agentId)),
  ]);

  const proofType = getProviderLabel(Number(verificationStrength));
  const strength = Number(verificationStrength);

  const trustModel: TrustModel = {
    proofType,
    sybilResistant: hasHumanProof,
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
        ? [
            {
              name: "A2A",
              endpoint: userFields.url,
              version: A2A_PROTOCOL_VERSION,
            },
          ]
        : []),
    url: userFields.url,
    version: userFields.version,
    provider: userFields.agentProvider,
    capabilities: userFields.capabilities,
    securitySchemes: userFields.securitySchemes,
    security: userFields.security,
    supportedInterfaces: userFields.supportedInterfaces,
    iconUrl: userFields.iconUrl,
    documentationUrl: userFields.documentationUrl,
    signatures: userFields.signatures,
    extensions: userFields.extensions,
    skills: withSkillIds(userFields.skills),
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

/**
 * Options for building an ERC-8004 registration JSON document without on-chain reads.
 * Include the optional `a2a` field to make the document double as a valid A2A Agent Card.
 */
export interface GenerateRegistrationJSONOptions {
  // ── ERC-8004 required ──
  name: string;
  description: string;
  image: string;
  services: ERC8004Service[];

  // ── ERC-8004 optional ──
  active?: boolean;
  registrations?: ERC8004Registration[];
  supportedTrust?: ERC8004AgentDocument["supportedTrust"];

  /** A2A fields; include to make the document also a valid A2A Agent Card. */
  a2a?: {
    /** The agent's own software version (card `version`), not the A2A protocol version. */
    version: string;
    /** MUST match `services[name="A2A"].endpoint` (an A2A service is added if missing). */
    url: string;
    provider: A2AProvider;
    capabilities?: A2ACapabilities;

    /** Named map of security schemes (A2A v0.3.0). */
    securitySchemes?: SecuritySchemes;

    /** Security requirements referencing securitySchemes keys. */
    security?: SecurityRequirement[];

    defaultInputModes?: string[];
    defaultOutputModes?: string[];
    skills?: AgentSkill[];

    /** Structured interface declarations. If omitted, auto-generated from url. */
    supportedInterfaces?: AgentInterface[];

    /** URL to agent icon/avatar. If omitted, uses top-level image field. */
    iconUrl?: string;

    /** URL to agent documentation. */
    documentationUrl?: string;

    /** RFC 7515 JWS signatures. */
    signatures?: JWSSignature[];

    /** Extension declarations. */
    extensions?: AgentExtension[];
  };
}

/**
 * Build an ERC-8004 registration JSON document synchronously from plain options.
 *
 * Unlike {@link buildAgentCard}, this does not read from on-chain contracts.
 * When `options.a2a` is provided, the returned document is also a valid A2A Agent Card.
 * Skills without an explicit `id` will have one auto-generated from the skill name.
 * An auto-added A2A service and the default `supportedInterfaces` entry use the
 * A2A protocol version ({@link A2A_PROTOCOL_VERSION}), not `a2a.version` (the
 * agent's own software version). It sets no `selfProtocol` block (no chain access).
 *
 * @param options - Document fields and optional A2A configuration.
 * @returns A populated {@link ERC8004AgentDocument}.
 */
export function generateRegistrationJSON(
  options: GenerateRegistrationJSONOptions,
): ERC8004AgentDocument {
  const a2a = options.a2a;

  const skills = withSkillIds(a2a?.skills);

  // Auto-generate supportedInterfaces from url if not explicitly provided
  const supportedInterfaces: AgentInterface[] | undefined = a2a
    ? (a2a.supportedInterfaces ?? [
        {
          url: a2a.url,
          protocolBinding: "JSONRPC" as const,
          protocolVersion: A2A_PROTOCOL_VERSION,
        },
      ])
    : undefined;

  // Ensure services array contains an A2A entry when a2a is provided
  let services = options.services;
  if (a2a && !services.some((s) => s.name === "A2A")) {
    services = [
      ...services,
      { name: "A2A", endpoint: a2a.url, version: A2A_PROTOCOL_VERSION },
    ];
  }

  return {
    type: "https://eips.ethereum.org/EIPS/eip-8004#registration-v1",
    name: options.name,
    description: options.description,
    image: options.image,
    services,
    active: options.active,
    registrations: options.registrations,
    supportedTrust: options.supportedTrust,
    ...(a2a && {
      version: a2a.version,
      url: a2a.url,
      provider: a2a.provider,
      capabilities: a2a.capabilities ?? {
        streaming: false,
        pushNotifications: false,
        stateTransitionHistory: false,
        extendedAgentCard: false,
      },
      ...(a2a.securitySchemes && {
        securitySchemes: a2a.securitySchemes,
      }),
      ...(a2a.security && { security: a2a.security }),
      defaultInputModes: a2a.defaultInputModes,
      defaultOutputModes: a2a.defaultOutputModes,
      supportedInterfaces,
      iconUrl: a2a.iconUrl ?? options.image,
      documentationUrl: a2a.documentationUrl,
      signatures: a2a.signatures,
      extensions: a2a.extensions,
      skills,
    }),
  };
}
