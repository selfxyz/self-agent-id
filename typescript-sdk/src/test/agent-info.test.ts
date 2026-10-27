// SPDX-FileCopyrightText: 2025-2026 Social Connect Labs, Inc.
// SPDX-License-Identifier: BUSL-1.1
// NOTE: Converts to Apache-2.0 on 2029-06-11 per LICENSE.

/** Tests for `readAgentInfo` (verified = hasHumanProof && isProofFresh, expiry fields). */

import { describe, it } from "node:test";
import assert from "node:assert";
import { readAgentInfo } from "../agent-info";
import type { TypedRegistryContract } from "../contract-types";

const DAY = 86_400;

/** Mock registry for agent 5 with configurable freshness and expiry. */
function registry(opts: {
  fresh?: boolean;
  expiresAt?: bigint;
}): TypedRegistryContract {
  return {
    getAgentId: async () => 5n,
    hasHumanProof: async () => true,
    getHumanNullifier: async () => 9n,
    getAgentCountForHuman: async () => 1n,
    proofExpiresAt: async () => opts.expiresAt ?? 1_700_000_000n,
    isProofFresh: async () => opts.fresh ?? true,
    getAgentsForNullifier: async () => [5n],
  } as unknown as TypedRegistryContract;
}

/** Unix seconds `days` from now (negative = in the past). */
function inDays(days: number): bigint {
  return BigInt(Math.floor(Date.now() / 1000 + days * DAY));
}

describe("readAgentInfo", () => {
  it("isVerified requires a fresh proof", async () => {
    const stale = await readAgentInfo(registry({ fresh: false }), "0xa", "0xk");
    assert.strictEqual(stale.hasHumanProof, true);
    assert.strictEqual(stale.isProofFresh, false);
    assert.strictEqual(stale.isVerified, false);

    const fresh = await readAgentInfo(registry({ fresh: true }), "0xa", "0xk");
    assert.strictEqual(fresh.isVerified, true);
  });

  it("isExpiringSoon matches isProofExpiringSoon (0 < remaining < 30 days)", async () => {
    const soon = await readAgentInfo(
      registry({ expiresAt: inDays(10) }),
      "0xa",
      "0xk",
    );
    assert.strictEqual(soon.isExpiringSoon, true);

    const later = await readAgentInfo(
      registry({ expiresAt: inDays(60) }),
      "0xa",
      "0xk",
    );
    assert.strictEqual(later.isExpiringSoon, false);

    // Expired a few hours ago: no longer "expiring soon" — it has expired.
    const expired = await readAgentInfo(
      registry({ expiresAt: inDays(-0.25), fresh: false }),
      "0xa",
      "0xk",
    );
    assert.strictEqual(expired.isExpiringSoon, false);

    const none = await readAgentInfo(registry({ expiresAt: 0n }), "0xa", "0xk");
    assert.strictEqual(none.isExpiringSoon, false);
    assert.strictEqual(none.daysUntilExpiry, null);
  });

  it("daysUntilExpiry rounds down like the verifier (Math.floor)", async () => {
    const days = async (d: number) =>
      (await readAgentInfo(registry({ expiresAt: inDays(d) }), "0xa", "0xk"))
        .daysUntilExpiry;
    assert.strictEqual(await days(10.5), 10);
    // Truncation toward zero would give 0 and -2 here.
    assert.strictEqual(await days(-0.25), -1);
    assert.strictEqual(await days(-2.5), -3);
  });
});
