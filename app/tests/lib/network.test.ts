// SPDX-FileCopyrightText: 2025-2026 Social Connect Labs, Inc.
// SPDX-License-Identifier: BUSL-1.1
// NOTE: Converts to Apache-2.0 on 2029-06-11 per LICENSE.

/** Tests for NETWORKS and DEFAULT_NETWORK (lib/network) and the CHAIN_CONFIG derived from them. */

import { afterEach, describe, expect, it, vi } from "vitest";
import { NETWORKS } from "@/lib/network";
import { CHAIN_CONFIG } from "@/lib/chain-config";

describe("NETWORKS", () => {
  it("contains celo-mainnet", () => {
    expect(NETWORKS).toHaveProperty("celo-mainnet");
    expect(NETWORKS["celo-mainnet"].id).toBe("celo-mainnet");
  });

  it("contains celo-sepolia", () => {
    expect(NETWORKS).toHaveProperty("celo-sepolia");
    expect(NETWORKS["celo-sepolia"].id).toBe("celo-sepolia");
  });
});

describe("DEFAULT_NETWORK", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  /**
   * Re-import lib/network with NEXT_PUBLIC_DEFAULT_NETWORK set.
   *
   * @param value - Env value to stub.
   * @returns The freshly evaluated DEFAULT_NETWORK.
   */
  async function defaultFor(value: string) {
    vi.resetModules();
    vi.stubEnv("NEXT_PUBLIC_DEFAULT_NETWORK", value);
    return (await import("@/lib/network")).DEFAULT_NETWORK;
  }

  it("uses NEXT_PUBLIC_DEFAULT_NETWORK when it names a known network", async () => {
    expect(await defaultFor("celo-sepolia")).toBe("celo-sepolia");
  });

  it.each(["celo-mainnet-typo", "testnet", "", "__proto__", "toString"])(
    "falls back to celo-mainnet for %j",
    async (value) => {
      expect(await defaultFor(value)).toBe("celo-mainnet");
    },
  );
});

describe("CHAIN_CONFIG", () => {
  it("maps string chainIds to rpc, registry and visa", () => {
    expect(CHAIN_CONFIG["42220"]).toEqual({
      rpc: NETWORKS["celo-mainnet"].rpcUrl,
      registry: NETWORKS["celo-mainnet"].registryAddress,
      visa: NETWORKS["celo-mainnet"].visaAddress,
    });
    expect(CHAIN_CONFIG["11142220"]).toEqual({
      rpc: NETWORKS["celo-sepolia"].rpcUrl,
      registry: NETWORKS["celo-sepolia"].registryAddress,
      visa: NETWORKS["celo-sepolia"].visaAddress,
    });
  });

  it("does not contain unknown chain IDs", () => {
    expect(Object.keys(CHAIN_CONFIG)).toHaveLength(2);
  });
});
