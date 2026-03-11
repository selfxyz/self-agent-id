"use client";

import React from "react";
import { Shield, AlertTriangle } from "lucide-react";
import { useNetwork } from "@/lib/NetworkContext";
import { Button } from "@/components/Button";

interface NetworkStepProps {
  onContinue: () => void;
  onBack: () => void;
}

export default function NetworkStep({ onContinue, onBack }: NetworkStepProps) {
  const { networkId, setNetworkId } = useNetwork();

  return (
    <div className="space-y-6">
      <p className="text-muted text-sm">
        Choose which network to register on. Mainnet uses your real passport.
      </p>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {/* Celo Mainnet card */}
        <button
          type="button"
          className={`rounded-xl border-2 p-5 text-left transition-colors cursor-pointer ${
            networkId === "celo-mainnet"
              ? "border-accent bg-surface-2"
              : "border-border hover:border-border-strong"
          }`}
          onClick={() => setNetworkId("celo-mainnet")}
        >
          <div className="flex items-center gap-3 mb-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-full bg-accent/20">
              <Shield className="h-5 w-5 text-accent" />
            </div>
            <span className="font-bold text-sm">Celo Mainnet</span>
            <span className="inline-flex items-center rounded-full bg-green-500/10 px-2 py-0.5 text-xs font-medium text-green-500">
              default
            </span>
          </div>
          <p className="text-muted text-xs">
            Use your real passport via the Self app. Your agent gets a
            production-grade verified identity.
          </p>
        </button>

        {/* Celo Sepolia card */}
        <button
          type="button"
          className={`rounded-xl border-2 p-5 text-left transition-colors cursor-pointer ${
            networkId === "celo-sepolia"
              ? "border-accent bg-surface-2"
              : "border-border hover:border-border-strong"
          }`}
          onClick={() => setNetworkId("celo-sepolia")}
        >
          <div className="flex items-center gap-3 mb-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-full bg-accent/20">
              <AlertTriangle className="h-5 w-5 text-accent" />
            </div>
            <span className="font-bold text-sm">Celo Sepolia (Testnet)</span>
          </div>
          <p className="text-muted text-xs">
            For testing. Generate mock documents in the Self app instead of
            using your real passport.
          </p>
        </button>
      </div>

      <div className="flex justify-end pt-2">
        <Button onClick={onContinue}>Continue</Button>
      </div>
    </div>
  );
}
