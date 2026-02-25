"use client";

import { type ReactNode } from "react";
import { PrivyProvider } from "@privy-io/react-auth";
import { NetworkProvider } from "@/lib/NetworkContext";
import { isPrivyConfigured, getPrivyAppId, PrivyBridge, PrivyDefaults } from "@/lib/privy";

function MaybePrivyProvider({ children }: { children: ReactNode }) {
  if (!isPrivyConfigured()) {
    return <PrivyDefaults>{children}</PrivyDefaults>;
  }

  return (
    <PrivyProvider
      appId={getPrivyAppId()}
      config={{
        appearance: {
          theme: "dark",
        },
        embeddedWallets: {
          createOnLogin: "users-without-wallets",
        },
      }}
    >
      <PrivyBridge>{children}</PrivyBridge>
    </PrivyProvider>
  );
}

export function ClientProviders({ children }: { children: ReactNode }) {
  return (
    <NetworkProvider>
      <MaybePrivyProvider>{children}</MaybePrivyProvider>
    </NetworkProvider>
  );
}
