// SPDX-FileCopyrightText: 2025-2026 Social Connect Labs, Inc.
// SPDX-License-Identifier: BUSL-1.1
// NOTE: Converts to Apache-2.0 on 2029-06-11 per LICENSE.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  getProviderLabel,
  getStrengthColor,
  generateRegistrationJSON,
  buildAgentCard,
} from "../agentCard";
import { isProofExpiringSoon, EXPIRY_WARNING_THRESHOLD_SECS } from "../types";

// ─── getProviderLabel ────────────────────────────────────────────────────────

describe("getProviderLabel", () => {
  it("returns 'passport' for strength >= 100", () => {
    assert.equal(getProviderLabel(100), "passport");
  });

  it("returns 'passport' for strength = 255", () => {
    assert.equal(getProviderLabel(255), "passport");
  });

  it("returns 'kyc' for strength 80-99", () => {
    assert.equal(getProviderLabel(80), "kyc");
    assert.equal(getProviderLabel(90), "kyc");
    assert.equal(getProviderLabel(99), "kyc");
  });

  it("returns 'govt_id' for strength 60-79", () => {
    assert.equal(getProviderLabel(60), "govt_id");
    assert.equal(getProviderLabel(70), "govt_id");
    assert.equal(getProviderLabel(79), "govt_id");
  });

  it("returns 'liveness' for strength 40-59", () => {
    assert.equal(getProviderLabel(40), "liveness");
    assert.equal(getProviderLabel(50), "liveness");
    assert.equal(getProviderLabel(59), "liveness");
  });

  it("returns 'unknown' for strength < 40", () => {
    assert.equal(getProviderLabel(39), "unknown");
    assert.equal(getProviderLabel(20), "unknown");
    assert.equal(getProviderLabel(1), "unknown");
  });

  it("returns 'unknown' for strength = 0", () => {
    assert.equal(getProviderLabel(0), "unknown");
  });

  it("handles exact boundary values correctly", () => {
    assert.equal(getProviderLabel(40), "liveness");
    assert.equal(getProviderLabel(60), "govt_id");
    assert.equal(getProviderLabel(80), "kyc");
    assert.equal(getProviderLabel(100), "passport");
  });
});

// ─── getStrengthColor ────────────────────────────────────────────────────────

describe("getStrengthColor", () => {
  it("returns 'green' for strength >= 80", () => {
    assert.equal(getStrengthColor(80), "green");
    assert.equal(getStrengthColor(100), "green");
    assert.equal(getStrengthColor(255), "green");
  });

  it("returns 'blue' for strength 60-79", () => {
    assert.equal(getStrengthColor(60), "blue");
    assert.equal(getStrengthColor(70), "blue");
    assert.equal(getStrengthColor(79), "blue");
  });

  it("returns 'amber' for strength 40-59", () => {
    assert.equal(getStrengthColor(40), "amber");
    assert.equal(getStrengthColor(50), "amber");
    assert.equal(getStrengthColor(59), "amber");
  });

  it("returns 'gray' for strength < 40", () => {
    assert.equal(getStrengthColor(0), "gray");
    assert.equal(getStrengthColor(20), "gray");
    assert.equal(getStrengthColor(39), "gray");
  });

  it("handles exact boundary values correctly", () => {
    assert.equal(getStrengthColor(40), "amber");
    assert.equal(getStrengthColor(60), "blue");
    assert.equal(getStrengthColor(80), "green");
  });
});

// ─── generateRegistrationJSON ────────────────────────────────────────────────

describe("generateRegistrationJSON", () => {
  it("generates minimal ERC-8004 document with required fields only", () => {
    const doc = generateRegistrationJSON({
      name: "TestAgent",
      description: "A test agent",
      image: "https://example.com/avatar.png",
      services: [{ name: "web", endpoint: "https://example.com" }],
    });

    assert.equal(
      doc.type,
      "https://eips.ethereum.org/EIPS/eip-8004#registration-v1",
    );
    assert.equal(doc.name, "TestAgent");
    assert.equal(doc.description, "A test agent");
    assert.equal(doc.image, "https://example.com/avatar.png");
    assert.deepEqual(doc.services, [
      { name: "web", endpoint: "https://example.com" },
    ]);

    // A2A fields should NOT be present
    assert.equal(doc.version, undefined);
    assert.equal(doc.url, undefined);
    assert.equal(doc.provider, undefined);
    assert.equal(doc.capabilities, undefined);
    assert.equal(doc.securitySchemes, undefined);
    assert.equal(doc.skills, undefined);
  });

  it("generates full ERC-8004 + A2A document with a2a option", () => {
    const doc = generateRegistrationJSON({
      name: "A2AAgent",
      description: "An A2A-capable agent",
      image: "https://example.com/a2a.png",
      services: [
        {
          name: "A2A",
          endpoint: "https://agent.example.com/a2a",
          version: "1.0",
        },
      ],
      a2a: {
        version: "0.1.0",
        url: "https://agent.example.com/a2a",
        provider: { name: "TestCo", url: "https://testco.com" },
        skills: [{ name: "translate", description: "Translate text" }],
      },
    });

    // ERC-8004 fields
    assert.equal(
      doc.type,
      "https://eips.ethereum.org/EIPS/eip-8004#registration-v1",
    );
    assert.equal(doc.name, "A2AAgent");
    assert.equal(doc.description, "An A2A-capable agent");
    assert.equal(doc.image, "https://example.com/a2a.png");
    assert.ok(Array.isArray(doc.services));

    // A2A fields
    assert.equal(doc.version, "0.1.0");
    assert.equal(doc.url, "https://agent.example.com/a2a");
    assert.deepEqual(doc.provider, {
      name: "TestCo",
      url: "https://testco.com",
    });
    assert.deepEqual(doc.skills, [
      { name: "translate", description: "Translate text" },
    ]);

    // A2A defaults
    assert.deepEqual(doc.capabilities, {
      streaming: false,
      pushNotifications: false,
    });
    assert.deepEqual(doc.securitySchemes, [{ type: "none" }]);
  });

  it("includes optional ERC-8004 fields when provided", () => {
    const doc = generateRegistrationJSON({
      name: "ActiveAgent",
      description: "Active agent",
      image: "https://example.com/img.png",
      services: [],
      active: true,
      registrations: [
        {
          agentId: 42,
          agentRegistry:
            "eip155:42220:0xABCDEF1234567890abcdef1234567890ABCDEF12",
        },
      ],
      supportedTrust: ["reputation", "crypto-economic"],
    });

    assert.equal(doc.active, true);
    assert.deepEqual(doc.registrations, [
      {
        agentId: 42,
        agentRegistry:
          "eip155:42220:0xABCDEF1234567890abcdef1234567890ABCDEF12",
      },
    ]);
    assert.deepEqual(doc.supportedTrust, ["reputation", "crypto-economic"]);
  });

  it("services array contains A2A entry with matching endpoint", () => {
    const a2aEndpoint = "https://agent.example.com/a2a";
    const doc = generateRegistrationJSON({
      name: "SvcAgent",
      description: "Service test",
      image: "",
      services: [{ name: "A2A", endpoint: a2aEndpoint, version: "1.0" }],
      a2a: {
        version: "0.1.0",
        url: a2aEndpoint,
        provider: { name: "TestCo" },
      },
    });

    const a2aService = doc.services.find((s) => s.name === "A2A");
    assert.ok(a2aService, "A2A service entry should exist");
    assert.equal(a2aService.endpoint, a2aEndpoint);
    assert.equal(doc.url, a2aEndpoint);
  });
});

// ─── buildAgentCard ──────────────────────────────────────────────────────────

describe("buildAgentCard", () => {
  const REGISTRY_ADDRESS = "0xaC3DF9ABf80d0F5c020C06B04Cced27763355944";
  const PROVIDER_ADDRESS = "0x4b036aFD959B457A208F676cf44Ea3ef73Ea3E3d";

  function createMockRegistry(options?: { throwOnCredentials?: boolean }) {
    return {
      getAgentCredentials: options?.throwOnCredentials
        ? async () => {
            throw new Error("No credentials");
          }
        : async () => ({
            issuingState: "US",
            name: ["Test User"],
            idNumber: "",
            nationality: "US",
            dateOfBirth: "1990-01-01",
            gender: "M",
            expiryDate: "2030-01-01",
            olderThan: 21n,
            ofac: [true, false, false],
          }),
      getAddress: async () => REGISTRY_ADDRESS,
      runner: {
        provider: {
          getNetwork: async () => ({ chainId: 42220n }),
        },
      },
    } as any;
  }

  function createMockProvider() {
    return {
      providerName: async () => "Self Protocol",
      verificationStrength: async () => 100,
      getAddress: async () => PROVIDER_ADDRESS,
    } as any;
  }

  it("builds a complete card with credentials from on-chain data", async () => {
    const card = await buildAgentCard(
      1,
      createMockRegistry(),
      createMockProvider(),
      {
        name: "TestAgent",
        description: "A test agent",
      },
    );

    // selfProtocol identity
    assert.equal(card.selfProtocol?.agentId, 1);
    assert.equal(card.selfProtocol?.registry, REGISTRY_ADDRESS);
    assert.equal(card.selfProtocol?.chainId, 42220);
    assert.equal(card.selfProtocol?.proofProvider, PROVIDER_ADDRESS);
    assert.equal(card.selfProtocol?.providerName, "Self Protocol");
    assert.equal(card.selfProtocol?.verificationStrength, 100);

    // trustModel
    assert.equal(card.selfProtocol?.trustModel.proofType, "passport");
    assert.equal(card.selfProtocol?.trustModel.sybilResistant, true);
    assert.equal(card.selfProtocol?.trustModel.ofacScreened, true);
    assert.equal(card.selfProtocol?.trustModel.minimumAgeVerified, 21);

    // credentials
    assert.ok(card.selfProtocol?.credentials);
    assert.equal(card.selfProtocol?.credentials?.nationality, "US");
    assert.equal(card.selfProtocol?.credentials?.olderThan, 21);
    assert.equal(card.selfProtocol?.credentials?.ofacClean, true);
    assert.equal(card.selfProtocol?.credentials?.issuingState, "US");
    assert.equal(card.selfProtocol?.credentials?.hasName, true);
    assert.equal(card.selfProtocol?.credentials?.hasDateOfBirth, true);
    assert.equal(card.selfProtocol?.credentials?.hasGender, true);
    assert.equal(card.selfProtocol?.credentials?.documentExpiry, "2030-01-01");
  });

  it("builds card without credentials when getAgentCredentials throws", async () => {
    const card = await buildAgentCard(
      2,
      createMockRegistry({ throwOnCredentials: true }),
      createMockProvider(),
      { name: "NoCredsAgent" },
    );

    assert.equal(card.selfProtocol?.agentId, 2);
    assert.equal(card.selfProtocol?.providerName, "Self Protocol");

    // trustModel defaults (no credentials to override)
    assert.equal(card.selfProtocol?.trustModel.proofType, "passport");
    assert.equal(card.selfProtocol?.trustModel.sybilResistant, true);
    assert.equal(card.selfProtocol?.trustModel.ofacScreened, false);
    assert.equal(card.selfProtocol?.trustModel.minimumAgeVerified, 0);

    // No credentials
    assert.equal(card.selfProtocol?.credentials, undefined);
  });

  it("auto-populates services with A2A entry when url is provided", async () => {
    const card = await buildAgentCard(
      3,
      createMockRegistry(),
      createMockProvider(),
      {
        name: "UrlAgent",
        url: "https://agent.example.com/a2a",
      },
    );

    assert.ok(Array.isArray(card.services));
    assert.equal(card.services.length, 1);
    assert.equal(card.services[0].name, "A2A");
    assert.equal(card.services[0].endpoint, "https://agent.example.com/a2a");
    assert.equal(card.services[0].version, "1.0");
    assert.equal(card.url, "https://agent.example.com/a2a");
  });

  it("uses explicit services when provided instead of auto-populating", async () => {
    const explicitServices = [
      { name: "web" as const, endpoint: "https://example.com" },
      { name: "MCP" as const, endpoint: "https://example.com/mcp" },
    ];

    const card = await buildAgentCard(
      4,
      createMockRegistry(),
      createMockProvider(),
      {
        name: "ExplicitSvcAgent",
        url: "https://agent.example.com/a2a",
        services: explicitServices,
      },
    );

    assert.deepEqual(card.services, explicitServices);
    assert.equal(card.services.length, 2);
    assert.equal(card.services[0].name, "web");
    assert.equal(card.services[1].name, "MCP");
  });
});

// ─── isProofExpiringSoon ─────────────────────────────────────────────────────

describe("isProofExpiringSoon", () => {
  it("returns true when proof expires in 15 days", () => {
    const fifteenDays = 15 * 24 * 60 * 60 * 1000;
    const expiresAt = new Date(Date.now() + fifteenDays);
    assert.equal(isProofExpiringSoon(expiresAt), true);
  });

  it("returns false when proof expires in 45 days", () => {
    const fortyFiveDays = 45 * 24 * 60 * 60 * 1000;
    const expiresAt = new Date(Date.now() + fortyFiveDays);
    assert.equal(isProofExpiringSoon(expiresAt), false);
  });

  it("returns false when proof already expired (negative time)", () => {
    const pastDate = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000);
    assert.equal(isProofExpiringSoon(pastDate), false);
  });

  it("returns false when proof expires in exactly 30 days (boundary)", () => {
    const exactlyThreshold = EXPIRY_WARNING_THRESHOLD_SECS * 1000;
    const expiresAt = new Date(Date.now() + exactlyThreshold);
    assert.equal(isProofExpiringSoon(expiresAt), false);
  });

  it("returns true when proof expires in 29 days", () => {
    const twentyNineDays = 29 * 24 * 60 * 60 * 1000;
    const expiresAt = new Date(Date.now() + twentyNineDays);
    assert.equal(isProofExpiringSoon(expiresAt), true);
  });

  it("returns true with custom threshold of 7 days, expiring in 5 days", () => {
    const fiveDays = 5 * 24 * 60 * 60 * 1000;
    const sevenDaysSecs = 7 * 24 * 60 * 60;
    const expiresAt = new Date(Date.now() + fiveDays);
    assert.equal(isProofExpiringSoon(expiresAt, sevenDaysSecs), true);
  });

  it("returns false with custom threshold of 7 days, expiring in 10 days", () => {
    const tenDays = 10 * 24 * 60 * 60 * 1000;
    const sevenDaysSecs = 7 * 24 * 60 * 60;
    const expiresAt = new Date(Date.now() + tenDays);
    assert.equal(isProofExpiringSoon(expiresAt, sevenDaysSecs), false);
  });
});

// ─── ERC-8004 Agent Card schema validation ───────────────────────────────────

describe("ERC-8004 Agent Card schema validation", () => {
  it("generated card has the correct type field", () => {
    const doc = generateRegistrationJSON({
      name: "SchemaAgent",
      description: "Schema test",
      image: "",
      services: [],
    });

    assert.equal(
      doc.type,
      "https://eips.ethereum.org/EIPS/eip-8004#registration-v1",
    );
  });

  it("services is always an array", () => {
    const minimal = generateRegistrationJSON({
      name: "MinAgent",
      description: "",
      image: "",
      services: [],
    });
    assert.ok(Array.isArray(minimal.services));

    const withServices = generateRegistrationJSON({
      name: "SvcAgent",
      description: "",
      image: "",
      services: [{ name: "web", endpoint: "https://example.com" }],
    });
    assert.ok(Array.isArray(withServices.services));
    assert.equal(withServices.services.length, 1);
  });

  it("A2A card url matches the A2A service endpoint", () => {
    const endpoint = "https://agent.example.com/a2a";
    const doc = generateRegistrationJSON({
      name: "A2AMatch",
      description: "",
      image: "",
      services: [{ name: "A2A", endpoint }],
      a2a: {
        version: "0.1.0",
        url: endpoint,
        provider: { name: "TestCo" },
      },
    });

    assert.equal(doc.url, endpoint);
    const a2aService = doc.services.find((s) => s.name === "A2A");
    assert.ok(a2aService);
    assert.equal(doc.url, a2aService.endpoint);
  });
});
