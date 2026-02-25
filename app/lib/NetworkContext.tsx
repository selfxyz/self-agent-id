// SPDX-FileCopyrightText: 2025-2026 Social Connect Labs, Inc.
// SPDX-License-Identifier: BUSL-1.1
// NOTE: Converts to Apache-2.0 on 2029-06-11 per LICENSE.

"use client";

import { createContext, useContext, useState, useEffect, type ReactNode } from "react";
import { type NetworkId, type NetworkConfig, getNetwork, isNetworkReady, DEFAULT_NETWORK } from "./network";

interface NetworkContextValue {
  network: NetworkConfig;
  networkId: NetworkId;
  setNetworkId: (id: NetworkId) => void;
}

const NetworkContext = createContext<NetworkContextValue | null>(null);

/** Resolve network from URL ?network= param, falling back to DEFAULT_NETWORK */
function resolveNetworkId(candidate: string | null): NetworkId {
  if (candidate === "celo-mainnet" || candidate === "celo-sepolia") {
    const config = getNetwork(candidate);
    if (isNetworkReady(config)) return candidate;
  }
  const defaultConfig = getNetwork(DEFAULT_NETWORK);
  if (isNetworkReady(defaultConfig)) return DEFAULT_NETWORK;
  return "celo-sepolia";
}

export function NetworkProvider({ children }: { children: ReactNode }) {
  const [networkId, setNetworkIdState] = useState<NetworkId>(() => resolveNetworkId(null));
  const [hydrated, setHydrated] = useState(false);

  // Hydrate from URL query param on mount
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const resolved = resolveNetworkId(params.get("network"));
    setNetworkIdState(resolved);

    // Clean up any old localStorage entry
    try { localStorage.removeItem("self-agent-id:network"); } catch {}

    setHydrated(true);
  }, []);

  const setNetworkId = (id: NetworkId) => {
    const config = getNetwork(id);
    if (!isNetworkReady(config)) return;
    // Update URL query param and reload to clear all cached state
    const url = new URL(window.location.href);
    url.searchParams.set("network", id);
    window.location.href = url.toString();
  };

  const network = getNetwork(networkId);

  // Avoid hydration mismatch — render with default until client hydrates
  if (!hydrated) {
    const safeDefault = resolveNetworkId(null);
    return (
      <NetworkContext.Provider
        value={{ network: getNetwork(safeDefault), networkId: safeDefault, setNetworkId }}
      >
        {children}
      </NetworkContext.Provider>
    );
  }

  return (
    <NetworkContext.Provider value={{ network, networkId, setNetworkId }}>
      {children}
    </NetworkContext.Provider>
  );
}

export function useNetwork(): NetworkContextValue {
  const ctx = useContext(NetworkContext);
  if (!ctx) {
    throw new Error("useNetwork must be used within a NetworkProvider");
  }
  return ctx;
}
