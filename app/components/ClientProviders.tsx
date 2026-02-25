"use client";

import { type ReactNode } from "react";
import { NetworkProvider } from "@/lib/NetworkContext";
import { isPrivyConfigured, getPrivyAppId } from "@/lib/privy";

function MaybePrivyProvider({ children }: { children: ReactNode }) {
  if (!isPrivyConfigured()) {
    return <>{children}</>;
  }

  // Dynamic require to avoid build errors when @privy-io/react-auth is not installed
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { PrivyProvider } = require("@privy-io/react-auth");

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
      {children}
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
