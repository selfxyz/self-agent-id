// SPDX-FileCopyrightText: 2025-2026 Social Connect Labs, Inc.
// SPDX-License-Identifier: BUSL-1.1
// NOTE: Converts to Apache-2.0 on 2029-06-11 per LICENSE.

"use client";

import type { ReactNode } from "react";
import { PrivyProvider } from "@privy-io/react-auth";
import { NetworkProvider } from "@/lib/NetworkContext";
import {
  isPrivyConfigured,
  getPrivyAppId,
  PrivyBridge,
  PrivyDefaults,
} from "@/lib/privy";

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
