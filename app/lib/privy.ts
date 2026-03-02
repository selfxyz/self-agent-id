"use client";

import { createContext, useContext, useMemo, type ReactNode } from "react";
import React from "react";
import { usePrivy, useWallets } from "@privy-io/react-auth";

// ---------------------------------------------------------------------------
// Configuration helpers (pure functions, safe to call anywhere)
// ---------------------------------------------------------------------------

export function isPrivyConfigured(): boolean {
  return !!process.env.NEXT_PUBLIC_PRIVY_APP_ID;
}

export function getPrivyAppId(): string {
  return process.env.NEXT_PUBLIC_PRIVY_APP_ID || "";
}

// ---------------------------------------------------------------------------
// Shared state interface surfaced to pages via usePrivyState()
// ---------------------------------------------------------------------------

export interface PrivyState {
  login: (() => void) | null;
  ready: boolean;
  authenticated: boolean;
  wallets: Array<{ address: string; walletClientType: string }>;
}

const defaultState: PrivyState = {
  login: null,
  ready: false,
  authenticated: false,
  wallets: [],
};

const PrivyStateContext = createContext<PrivyState>(defaultState);

/** Consume Privy state unconditionally — safe even without a PrivyProvider. */
export function usePrivyState(): PrivyState {
  return useContext(PrivyStateContext);
}

// ---------------------------------------------------------------------------
// PrivyBridge — renders inside <PrivyProvider>, calls real hooks, forwards
// values through context so downstream pages never call hooks conditionally.
// ---------------------------------------------------------------------------

export function PrivyBridge({ children }: { children: ReactNode }) {
  const { login, ready, authenticated } = usePrivy();
  const { wallets } = useWallets();

  // Stabilise the context value so consumers only re-render when
  // meaningful data changes, not on every PrivyBridge render.
  const walletsKey = wallets.map((w: { address: string }) => w.address).join();
  const value = useMemo<PrivyState>(
    () => ({ login, ready, authenticated, wallets }),
    [login, ready, authenticated, walletsKey],
  );

  return React.createElement(PrivyStateContext.Provider, { value }, children);
}

// ---------------------------------------------------------------------------
// PrivyDefaults — provides no-op defaults when Privy is not configured.
// ---------------------------------------------------------------------------

export function PrivyDefaults({ children }: { children: ReactNode }) {
  return React.createElement(
    PrivyStateContext.Provider,
    { value: defaultState },
    children,
  );
}
