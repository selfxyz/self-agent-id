// SPDX-FileCopyrightText: 2025-2026 Social Connect Labs, Inc.
// SPDX-License-Identifier: BUSL-1.1
// NOTE: Converts to Apache-2.0 on 2029-06-11 per LICENSE.

"use client";

import React, { useState, useMemo } from "react";
import {
  Key, Smartphone, Fingerprint, Terminal, Wallet,
  ChevronDown, ChevronUp, Shield, Zap, Info,
} from "lucide-react";
import { Card } from "@/components/Card";
import { Badge } from "@/components/Badge";
import { PrivyIcon } from "@/components/PrivyIcon";
import { isPrivyConfigured } from "@/lib/privy";
import type { Mode, UserRole, ModeIcon } from "../types";
import { MODE_INFO } from "../types";

/**
 * Decision tree:
 *
 * Q2: Does your agent have Ed25519 keys?
 * ├── Yes
 * │   └── Q3: Link a guardian wallet?
 * │       ├── Yes → ed25519-linked
 * │       └── No  → ed25519
 * └── No / Not sure (we generate a fresh key)
 *     └── Q3: How do you want to secure this?
 *         ├── Connect crypto wallet (guardian) → linked
 *         ├── Face ID / fingerprint (guardian) → smartwallet
 *         ├── Social login (guardian) → privy
 *         └── No wallet / quick start → walletfree
 */

type Question = "has-ed25519" | "guardian-ed25519" | "secure-method";

interface ModeSelectorProps {
  role: UserRole;
  onSelect: (mode: Mode) => void;
  onBack: () => void;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- Lucide icons have complex generic props
const ICON_MAP: Record<ModeIcon, React.ComponentType<any>> = {
  Key,
  Smartphone,
  Fingerprint,
  Privy: PrivyIcon,
  Terminal,
};

const ALL_MODES: Mode[] = [
  "linked", "walletfree", "smartwallet", "privy", "ed25519", "ed25519-linked",
];

function availableModes(): Mode[] {
  return isPrivyConfigured() ? ALL_MODES : ALL_MODES.filter((m) => m !== "privy");
}

export function ModeSelector({ role, onSelect, onBack }: ModeSelectorProps) {
  const [question, setQuestion] = useState<Question>("has-ed25519");
  const [showAll, setShowAll] = useState(false);
  const modes = useMemo(() => availableModes(), []);
  // Always show all modes in comparison table, even if privy isn't configured locally
  const allModesForTable: Mode[] = ALL_MODES;

  return (
    <div className="space-y-6">
      {/* Q2: Does your agent already have signing keys? */}
      {question === "has-ed25519" && (
        <div className="space-y-4">
          <h2 className="text-lg font-semibold text-foreground text-center">
            Does your agent already have signing keys?
          </h2>
          <p className="text-sm text-muted text-center max-w-md mx-auto">
            Agents built with OpenClaw, IronClaw, ZeroClaw, OpenFang etc., or ElizaOS typically have Ed25519 keys.
            Most other frameworks (CrewAI, AutoGen, LangChain, etc.) do not — pick &ldquo;No&rdquo; and we&apos;ll generate keys.
          </p>

          <button
            type="button"
            onClick={onBack}
            className="text-sm text-muted hover:text-foreground transition-colors"
            data-testid="wizard-back"
          >
            &larr; Back
          </button>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <button
              type="button"
              className="rounded-xl border-2 border-border hover:border-accent p-5 text-left transition-colors cursor-pointer"
              onClick={() => setQuestion("guardian-ed25519")}
              data-testid="ed25519-yes"
            >
              <div className="flex items-center gap-2 mb-2">
                <Terminal size={18} className="text-accent" />
                <span className="font-bold text-sm">Yes, my agent has Ed25519 keys</span>
              </div>
              <p className="text-xs text-muted">
                I&apos;ll paste my agent&apos;s existing public key. Common with OpenClaw, ElizaOS, and similar frameworks.
              </p>
            </button>

            <button
              type="button"
              className="rounded-xl border-2 border-border hover:border-accent p-5 text-left transition-colors cursor-pointer"
              onClick={() => setQuestion("secure-method")}
              data-testid="ed25519-no"
            >
              <div className="flex items-center gap-2 mb-2">
                <Key size={18} className="text-accent" />
                <span className="font-bold text-sm">No / Not sure</span>
              </div>
              <p className="text-xs text-muted">
                Works with any agent. We&apos;ll generate keys and you choose how to secure it.
              </p>
            </button>
          </div>
        </div>
      )}

      {/* Q3a: Guardian question for Ed25519 agents */}
      {question === "guardian-ed25519" && (
        <GuardianQuestion
          onYes={() => onSelect("ed25519-linked")}
          onNo={() => onSelect("ed25519")}
          onBack={() => setQuestion("has-ed25519")}
        />
      )}

      {/* Q3b: How do you want to secure this? (fresh EVM key path) */}
      {question === "secure-method" && (
        <div className="space-y-4">
          <h2 className="text-lg font-semibold text-foreground text-center">
            How do you want to secure this?
          </h2>
          <p className="text-sm text-muted text-center max-w-md mx-auto">
            We&apos;ll generate a fresh keypair for your agent.
            Choose how <strong className="text-foreground">you</strong> (the human) want to control it.
          </p>

          <div className="space-y-3">
            {/* Quick start — no wallet */}
            <button
              type="button"
              className="w-full rounded-xl border-2 border-border hover:border-accent p-5 text-left transition-colors cursor-pointer"
              onClick={() => onSelect("walletfree")}
              data-testid="secure-quickstart"
            >
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-full bg-accent/20 shrink-0">
                  <Zap size={20} className="text-accent" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-bold text-sm">Quick start — no wallet needed</span>
                    <Badge variant="success">easiest</Badge>
                  </div>
                  <p className="text-xs text-muted mt-1">
                    No wallet or crypto knowledge needed. Just your passport and the Self app.
                    Revoke anytime by scanning your passport again.
                  </p>
                </div>
              </div>
            </button>

            {/* Face ID / fingerprint */}
            <button
              type="button"
              className="w-full rounded-xl border-2 border-border hover:border-accent p-5 text-left transition-colors cursor-pointer"
              onClick={() => onSelect("smartwallet")}
              data-testid="secure-passkey"
            >
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-full bg-accent/20 shrink-0">
                  <Fingerprint size={20} className="text-accent" />
                </div>
                <div className="flex-1 min-w-0">
                  <span className="font-bold text-sm">Face ID / fingerprint</span>
                  <p className="text-xs text-muted mt-1">
                    Create a passkey-secured smart wallet. No browser extension, no seed phrase.
                    Your passkey becomes the <span className="font-semibold text-accent">guardian</span>.
                  </p>
                </div>
              </div>
            </button>

            {/* Social login */}
            {isPrivyConfigured() ? (
              <button
                type="button"
                className="w-full rounded-xl border-2 border-border hover:border-accent p-5 text-left transition-colors cursor-pointer"
                onClick={() => onSelect("privy")}
                data-testid="secure-privy"
              >
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-full bg-accent/20 shrink-0">
                    <PrivyIcon size={20} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <span className="font-bold text-sm">Social login (email / Google)</span>
                    <p className="text-xs text-muted mt-1">
                      Sign in with your existing account. Privy creates a wallet that becomes the{" "}
                      <span className="font-semibold text-accent">guardian</span>.
                    </p>
                  </div>
                </div>
              </button>
            ) : (
              <div
                className="w-full rounded-xl border-2 border-border p-5 text-left opacity-50 cursor-not-allowed"
                data-testid="secure-privy-disabled"
              >
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-full bg-accent/20 shrink-0">
                    <PrivyIcon size={20} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <span className="font-bold text-sm">Social login (email / Google)</span>
                    <p className="text-xs text-muted mt-1">
                      Available on the hosted site. Requires Privy configuration.
                    </p>
                  </div>
                </div>
              </div>
            )}

            {/* Connect crypto wallet */}
            <button
              type="button"
              className="w-full rounded-xl border-2 border-border hover:border-accent p-5 text-left transition-colors cursor-pointer"
              onClick={() => onSelect("linked")}
              data-testid="secure-wallet"
            >
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-full bg-accent/20 shrink-0">
                  <Wallet size={20} className="text-accent" />
                </div>
                <div className="flex-1 min-w-0">
                  <span className="font-bold text-sm">Connect crypto wallet</span>
                  <p className="text-xs text-muted mt-1">
                    Use MetaMask or another browser wallet. Your wallet becomes the{" "}
                    <span className="font-semibold text-accent">guardian</span> — you can revoke the agent anytime.
                  </p>
                </div>
              </div>
            </button>
          </div>

          <button
            type="button"
            onClick={() => setQuestion("has-ed25519")}
            className="text-sm text-muted hover:text-foreground transition-colors"
          >
            &larr; Back
          </button>
        </div>
      )}

      {/* Show all options toggle */}
      <div className="border-t border-border pt-4">
        <button
          onClick={() => setShowAll((prev) => !prev)}
          className="flex items-center gap-1 text-sm text-accent-2 hover:underline"
          data-testid="show-all-toggle"
        >
          {showAll ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
          {showAll ? "Hide comparison table" : "Show all options"}
        </button>

        {showAll && (
          <Card className="mt-4 overflow-x-auto">
            <table className="w-full text-sm" data-testid="comparison-table">
              <thead>
                <tr className="border-b border-border text-left text-muted">
                  <th className="pb-2 pr-4 font-medium">Mode</th>
                  <th className="pb-2 pr-4 font-medium">Key Type</th>
                  <th className="pb-2 pr-4 font-medium">Revocation</th>
                  <th className="pb-2 font-medium">Best For</th>
                </tr>
              </thead>
              <tbody>
                {allModesForTable.map((m) => {
                  const info = MODE_INFO[m];
                  const revocation: Record<Mode, string> = {
                    linked: "Wallet tx",
                    walletfree: "Passport scan",
                    smartwallet: "Passkey (biometric)",
                    privy: "Social login",
                    ed25519: "Passport scan",
                    "ed25519-linked": "Wallet tx",
                  };
                  return (
                    <tr
                      key={m}
                      className="border-b border-border last:border-0 cursor-pointer hover:bg-surface-2 transition-colors"
                      onClick={() => onSelect(m)}
                      data-testid={`table-row-${m}`}
                    >
                      <td className="py-2 pr-4 font-medium text-foreground">
                        <div className="flex items-center gap-1.5">
                          {React.createElement(ICON_MAP[info.icon], { size: 14 })}
                          {info.label}
                          {info.badge && <Badge variant="success">{info.badge}</Badge>}
                        </div>
                      </td>
                      <td className="py-2 pr-4 text-muted">{info.keyType}</td>
                      <td className="py-2 pr-4 text-muted">{revocation[m]}</td>
                      <td className="py-2 text-muted">{info.bestFor}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </Card>
        )}
      </div>
    </div>
  );
}

/** Guardian question for the Ed25519 path. */
function GuardianQuestion({
  onYes,
  onNo,
  onBack,
}: {
  onYes: () => void;
  onNo: () => void;
  onBack: () => void;
}) {
  const [showInfo, setShowInfo] = useState(false);

  return (
    <div className="space-y-4">
      <h2 className="text-lg font-semibold text-foreground text-center">
        Link a guardian wallet?
      </h2>

      <div className="text-center">
        <button
          type="button"
          onClick={() => setShowInfo((v) => !v)}
          className="text-sm text-accent hover:text-accent-2 transition-colors inline-flex items-center gap-1"
        >
          <Info size={14} />
          {showInfo ? "Hide info" : "What\u2019s a guardian?"}
        </button>
        {showInfo && (
          <p className="text-xs text-muted mt-2 max-w-md mx-auto bg-surface-2 rounded-lg p-3">
            A guardian is your personal wallet that can revoke the agent&apos;s identity at any time.
            This is set at registration and <strong className="text-foreground">cannot be changed later</strong>.
            Without one, you can still revoke by scanning your passport again in the Self app.
          </p>
        )}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <button
          type="button"
          className="rounded-xl border-2 border-border hover:border-accent p-5 text-left transition-colors cursor-pointer"
          onClick={onYes}
          data-testid="guardian-yes"
        >
          <div className="flex items-center gap-2 mb-2">
            <Shield size={18} className="text-accent" />
            <span className="font-bold text-sm">Yes, link my wallet</span>
          </div>
          <p className="text-xs text-muted">
            Connect your browser wallet as guardian. Direct revocation via wallet.
          </p>
        </button>

        <button
          type="button"
          className="rounded-xl border-2 border-border hover:border-accent p-5 text-left transition-colors cursor-pointer"
          onClick={onNo}
          data-testid="guardian-no"
        >
          <div className="flex items-center gap-2 mb-2">
            <Smartphone size={18} className="text-accent" />
            <span className="font-bold text-sm">No guardian needed</span>
          </div>
          <p className="text-xs text-muted">
            The agent owns its own identity. Revoke by scanning your passport again.
          </p>
        </button>
      </div>

      <button
        type="button"
        onClick={onBack}
        className="text-sm text-muted hover:text-foreground transition-colors"
      >
        &larr; Back
      </button>
    </div>
  );
}
