"use client";

import { useState } from "react";
import { X } from "lucide-react";
import { useNetwork } from "@/lib/NetworkContext";

export function NetworkBanner() {
  const { network } = useNetwork();
  const [dismissed, setDismissed] = useState(false);

  if (!network.isTestnet || dismissed) return null;

  return (
    <div className="fixed top-[60px] left-0 right-0 z-40 bg-amber-500/10 border-b border-amber-500/20 px-4 py-1.5">
      <div className="max-w-6xl mx-auto flex items-center justify-between">
        <p className="text-xs text-amber-400">
          You&apos;re on Celo Sepolia (testnet). Registration uses mock passport documents.
        </p>
        <button
          onClick={() => setDismissed(true)}
          className="text-amber-400/60 hover:text-amber-400 transition-colors ml-4 shrink-0"
          aria-label="Dismiss"
        >
          <X size={14} />
        </button>
      </div>
    </div>
  );
}
