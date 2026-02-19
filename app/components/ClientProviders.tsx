"use client";

import { type ReactNode } from "react";
import { NetworkProvider } from "@/lib/NetworkContext";

export function ClientProviders({ children }: { children: ReactNode }) {
  return <NetworkProvider>{children}</NetworkProvider>;
}
