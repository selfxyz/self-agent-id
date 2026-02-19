"use client";

import { createContext, useContext, useState, useEffect, type ReactNode } from "react";
import { type NetworkId, type NetworkConfig, getNetwork, isNetworkReady, DEFAULT_NETWORK } from "./network";

const STORAGE_KEY = "self-agent-id:network";

interface NetworkContextValue {
  network: NetworkConfig;
  networkId: NetworkId;
  setNetworkId: (id: NetworkId) => void;
}

const NetworkContext = createContext<NetworkContextValue | null>(null);

/** Validate a stored network ID: must be a known ID AND have required config (registry address) */
function resolveNetworkId(candidate: string | null): NetworkId {
  if (candidate === "celo-mainnet" || candidate === "celo-sepolia") {
    const config = getNetwork(candidate);
    if (isNetworkReady(config)) return candidate;
  }
  // Fall back to default, or ultimately to celo-sepolia if default isn't ready either
  const defaultConfig = getNetwork(DEFAULT_NETWORK);
  if (isNetworkReady(defaultConfig)) return DEFAULT_NETWORK;
  return "celo-sepolia";
}

export function NetworkProvider({ children }: { children: ReactNode }) {
  const [networkId, setNetworkIdState] = useState<NetworkId>(() => resolveNetworkId(null));
  const [hydrated, setHydrated] = useState(false);

  // Hydrate from localStorage on mount
  useEffect(() => {
    const stored = localStorage.getItem(STORAGE_KEY);
    const resolved = resolveNetworkId(stored);
    setNetworkIdState(resolved);
    // If stored value was invalid/unready, clean it up
    if (stored && stored !== resolved) {
      localStorage.setItem(STORAGE_KEY, resolved);
    }
    setHydrated(true);
  }, []);

  const setNetworkId = (id: NetworkId) => {
    // Only allow switching to a network that's actually configured
    const config = getNetwork(id);
    if (!isNetworkReady(config)) return;
    setNetworkIdState(id);
    localStorage.setItem(STORAGE_KEY, id);
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
