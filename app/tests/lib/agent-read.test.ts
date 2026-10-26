// SPDX-FileCopyrightText: 2025-2026 Social Connect Labs, Inc.
// SPDX-License-Identifier: BUSL-1.1
// NOTE: Converts to Apache-2.0 on 2029-06-11 per LICENSE.

/** Tests for the agent read helpers in lib/agent-read (disclosure, key parsing, Multicall ID scan). */

import { ethers } from "ethers";
import { describe, expect, it } from "vitest";
import {
  agentAddressFromKey,
  disclosed,
  parseAgentTarget,
  scanAgentIds,
} from "@/lib/agent-read";
import { deriveEd25519Address } from "@/lib/ed25519";

describe("disclosed", () => {
  it("treats NUL padding, separators-only and UNAVAILABLE as not disclosed", () => {
    for (const v of [
      "",
      "\u0000\u0000\u0000",
      "\u0000\u0000-\u0000\u0000-\u0000\u0000",
      "  ",
      "UNAVAILABLE",
      undefined,
      null,
    ]) {
      expect(disclosed(v), JSON.stringify(v)).toBeNull();
    }
  });

  it("keeps real values, stripping trailing NULs", () => {
    expect(disclosed("IND")).toBe("IND");
    expect(disclosed("DEU\u0000")).toBe("DEU");
    expect(disclosed("31-12-29")).toBe("31-12-29");
  });
});

describe("agentAddressFromKey", () => {
  it("unpads ECDSA agent keys to their address", () => {
    expect(
      agentAddressFromKey(
        "0x00000000000000000000000059489da9e1eb1f162b0d8eeeadc0314f49ad759a",
      ),
    ).toBe("0x59489DA9E1EB1f162b0d8eeeaDC0314f49Ad759A");
  });

  it("derives the address of Ed25519 keys like the contract", () => {
    const pubkey =
      "d75a980182b10ab7d54bfed3c964073a0ee172f3daa62325af021a68f707511a";
    expect(agentAddressFromKey("0x" + pubkey)).toBe(
      deriveEd25519Address(pubkey),
    );
  });
});

describe("parseAgentTarget", () => {
  it("accepts canonical ids on supported chains", () => {
    const parsed = parseAgentTarget("11142220", "83");
    expect(parsed.ok && parsed.target.agentId).toBe(83n);
  });

  it("returns 400 / 404 responses for bad input", () => {
    /**
     * Parse a target and reduce the outcome to a status code.
     *
     * @param c - Chain ID path segment.
     * @param a - Agent ID path segment.
     * @returns 200 when parsed, else the error response's status.
     */
    const status = (c: string, a: string) => {
      const parsed = parseAgentTarget(c, a);
      return parsed.ok ? 200 : parsed.response.status;
    };
    expect(status("1", "1")).toBe(400);
    expect(status("toString", "1")).toBe(400);
    expect(status("42220", "%201")).toBe(400);
    expect(status("42220", "9007199254740991")).toBe(200);
    expect(status("42220", "9007199254740992")).toBe(404);
  });
});

describe("scanAgentIds", () => {
  const REGISTRY = "0xaC3DF9ABf80d0F5c020C06B04Cced27763355944";
  const OWNER = "0x2da338827F94a835107451192Abfa702a1c50259";
  const OTHER = "0x0000000000000000000000000000000000000001";
  const iface = new ethers.Interface([
    "function ownerOf(uint256) view returns (address)",
    "function agentRegisteredAt(uint256) view returns (uint256)",
    "function aggregate3((address target, bool allowFailure, bytes callData)[] calls) view returns ((bool success, bytes returnData)[])",
  ]);

  /**
   * Build a fake Multicall3 runner that answers ownerOf / agentRegisteredAt.
   *
   * @param owners - Owner per agent ID (index 0 = ID 1); null = burned,
   *   IDs beyond the array are unminted.
   * @returns `{ runner, calls }`: the ContractRunner and a counter of aggregate3 calls.
   */
  function runner(owners: (string | null)[]) {
    let calls = 0;
    /**
     * Decode one aggregate3 call and answer each sub-call from `owners`.
     *
     * @param tx - The eth_call transaction.
     * @returns ABI-encoded aggregate3 results.
     */
    const call = async (tx: { data: string }) => {
      calls++;
      const [requests] = iface.decodeFunctionData(
        "aggregate3",
        tx.data,
      ) as unknown as [[string, boolean, string][]];
      const results = requests.map(([, , data]) => {
        const fn = iface.parseTransaction({ data })!;
        const id = Number(fn.args[0]);
        const minted = id >= 1 && id <= owners.length;
        if (fn.name === "agentRegisteredAt") {
          return [
            true,
            iface.encodeFunctionResult(fn.fragment, [minted ? 100 + id : 0]),
          ];
        }
        const owner = minted ? owners[id - 1] : null;
        return owner
          ? [true, iface.encodeFunctionResult(fn.fragment, [owner])]
          : [false, "0x"];
      });
      return iface.encodeFunctionResult("aggregate3", [results]);
    };
    return {
      runner: { call } as unknown as ethers.ContractRunner,
      calls: () => calls,
    };
  }

  it("finds owned ids across pages and stops once all are found", async () => {
    const owners = Array.from({ length: 600 }, () => OTHER as string | null);
    owners[4] = OWNER; // id 5
    owners[3] = null; // id 4 burned
    owners[299] = OWNER; // id 300 (second page)
    const fake = runner(owners);
    const ids = await scanAgentIds(
      fake.runner,
      REGISTRY,
      "ownerOf",
      OWNER.toLowerCase(),
      2,
    );
    expect(ids).toEqual([5n, 300n]);
    expect(fake.calls()).toBe(2);
  });

  it("stops at the first page without minted ids", async () => {
    const fake = runner([OWNER, OTHER]);
    const ids = await scanAgentIds(fake.runner, REGISTRY, "ownerOf", OWNER, 5);
    expect(ids).toEqual([1n]);
    expect(fake.calls()).toBe(1);
  });
});
