import { describe, expect, it } from "vitest";
import {
  NETWORKS,
  getNetwork,
  isNetworkReady,
  type NetworkConfig,
} from "@/lib/network";
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

describe("getNetwork", () => {
  it("returns correct chainId for celo-mainnet", () => {
    const net = getNetwork("celo-mainnet");
    expect(net.chainId).toBe(42220);
    expect(net.isTestnet).toBe(false);
  });

  it("returns correct chainId for celo-sepolia", () => {
    const net = getNetwork("celo-sepolia");
    expect(net.chainId).toBe(11142220);
    expect(net.isTestnet).toBe(true);
  });
});

describe("isNetworkReady", () => {
  it("returns true when registryAddress is present", () => {
    expect(isNetworkReady(NETWORKS["celo-mainnet"])).toBe(true);
    expect(isNetworkReady(NETWORKS["celo-sepolia"])).toBe(true);
  });

  it("returns false when registryAddress is empty", () => {
    const config = {
      ...NETWORKS["celo-mainnet"],
      registryAddress: "",
    } as NetworkConfig;
    expect(isNetworkReady(config)).toBe(false);
  });
});

describe("CHAIN_CONFIG", () => {
  it("maps string chainIds to rpc and registry", () => {
    expect(CHAIN_CONFIG["42220"]).toEqual({
      rpc: NETWORKS["celo-mainnet"].rpcUrl,
      registry: NETWORKS["celo-mainnet"].registryAddress,
    });
    expect(CHAIN_CONFIG["11142220"]).toEqual({
      rpc: NETWORKS["celo-sepolia"].rpcUrl,
      registry: NETWORKS["celo-sepolia"].registryAddress,
    });
  });

  it("does not contain unknown chain IDs", () => {
    expect(Object.keys(CHAIN_CONFIG)).toHaveLength(2);
  });
});
