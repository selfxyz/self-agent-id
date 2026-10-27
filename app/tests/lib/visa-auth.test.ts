// SPDX-FileCopyrightText: 2025-2026 Social Connect Labs, Inc.
// SPDX-License-Identifier: BUSL-1.1
// NOTE: Converts to Apache-2.0 on 2029-06-11 per LICENSE.

/** Tests for visa request messages, input parsing and tier thresholds (lib/visa-auth). */

import { describe, expect, it } from "vitest";
import {
  buildVisaRequestMessage,
  meetsTierThresholds,
  parseTier,
  parseVisaAgentId,
} from "@/lib/visa-auth";

describe("buildVisaRequestMessage", () => {
  // SDKs and docs reproduce these strings byte for byte; changing them is a
  // breaking API change.
  it("formats claim and request-review messages", () => {
    expect(
      buildVisaRequestMessage({
        action: "claim",
        chainId: "11142220",
        agentId: 61n,
        targetTier: 2,
        timestamp: 1761478000000,
      }),
    ).toBe(
      "Self Agent ID visa request\naction: claim\nchainId: 11142220\nagentId: 61\ntargetTier: 2\ntimestamp: 1761478000000",
    );
  });

  it("formats migrate messages with newAgentId", () => {
    expect(
      buildVisaRequestMessage({
        action: "migrate",
        chainId: "42220",
        agentId: 747004818220740875488380804190029610205218411419n,
        newAgentId: 61n,
        targetTier: 1,
        timestamp: 1761478000000,
      }),
    ).toBe(
      "Self Agent ID visa request\naction: migrate\nchainId: 42220\nagentId: 747004818220740875488380804190029610205218411419\nnewAgentId: 61\ntargetTier: 1\ntimestamp: 1761478000000",
    );
  });
});

describe("parseVisaAgentId and parseTier", () => {
  it("accepts canonical decimal strings and safe integers only", () => {
    expect(parseVisaAgentId("61")).toBe(61n);
    expect(parseVisaAgentId(61)).toBe(61n);
    for (const bad of ["0x3d", "061", " 61", 2 ** 53, 1.5, null, "0"]) {
      expect(parseVisaAgentId(bad)).toBeNull();
    }
  });

  it("accepts integer tiers in range only", () => {
    expect(parseTier(2)).toBe(2);
    expect(parseTier(1, 2)).toBeNull();
    for (const bad of ["2", 2.5, 0, 4, null]) expect(parseTier(bad)).toBeNull();
  });
});

describe("meetsTierThresholds (mirrors CeloAgentVisa._checkEligibility)", () => {
  const t = {
    minTransactions: 10n,
    minVolumeUsd: 0n,
    requiresBoth: false,
    requiresManualReview: false,
  };

  it("treats a zero threshold as met, like the contract", () => {
    expect(
      meetsTierThresholds({ transactionCount: 0n, volumeUsd: 0n }, t, false),
    ).toBe(true);
  });

  it("applies requiresBoth and the manual-review gate", () => {
    const m = { transactionCount: 0n, volumeUsd: 0n };
    expect(meetsTierThresholds(m, { ...t, requiresBoth: true }, false)).toBe(
      false,
    );
    expect(
      meetsTierThresholds(m, { ...t, requiresManualReview: true }, false),
    ).toBe(false);
    expect(
      meetsTierThresholds(m, { ...t, requiresManualReview: true }, true),
    ).toBe(true);
  });
});
