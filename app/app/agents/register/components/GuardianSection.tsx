"use client";

import { Fingerprint, Mail, Wallet } from "lucide-react";
import type { ReactNode } from "react";

import type { GuardianMethod } from "../hooks/useRegistrationState";

interface GuardianSectionProps {
  wantsGuardian: boolean | null;
  guardianMethod: GuardianMethod;
  onWantsGuardianChange: (value: boolean) => void;
  onGuardianMethodChange: (method: "passkey" | "social" | "wallet") => void;
}

const METHODS: {
  key: "passkey" | "social" | "wallet";
  icon: ReactNode;
  title: string;
  description: string;
}[] = [
  {
    key: "passkey",
    icon: <Fingerprint className="h-5 w-5" />,
    title: "Face ID / fingerprint",
    description:
      "Create a passkey-secured smart wallet. No browser extension, no seed phrase.",
  },
  {
    key: "social",
    icon: <Mail className="h-5 w-5" />,
    title: "Social login (email / Google)",
    description:
      "Sign in with your existing account. Privy creates a wallet that becomes the guardian.",
  },
  {
    key: "wallet",
    icon: <Wallet className="h-5 w-5" />,
    title: "Connect crypto wallet",
    description:
      "Use MetaMask or another browser wallet. Your wallet becomes the guardian.",
  },
];

export function GuardianSection({
  wantsGuardian,
  guardianMethod,
  onWantsGuardianChange,
  onGuardianMethodChange,
}: GuardianSectionProps) {
  return (
    <section className="space-y-6">
      <h2 className="text-lg font-semibold text-foreground">
        Do you want a guardian?
      </h2>

      <details className="text-sm text-muted">
        <summary className="cursor-pointer hover:text-foreground transition-colors">
          What is a guardian?
        </summary>
        <p className="mt-2 pl-4 text-subtle leading-relaxed">
          A Guardian is an account that can perform admin actions such as
          deregistering an agent or refreshing your agent&apos;s registration.
          This can always be done via doing another disclosure proof via your
          Self mobile app, the Guardian just lets you manage your agents easier.
        </p>
      </details>

      <div className="flex gap-3">
        <button
          type="button"
          onClick={() =>
            onWantsGuardianChange(wantsGuardian === true ? false : true)
          }
          className={`px-5 py-2 rounded-full text-sm font-medium transition-all ${
            wantsGuardian === true
              ? "bg-accent text-white"
              : "bg-surface-2 text-muted border border-border hover:border-border-strong"
          }`}
        >
          Yes
        </button>
        <button
          type="button"
          onClick={() => onWantsGuardianChange(false)}
          className={`px-5 py-2 rounded-full text-sm font-medium transition-all ${
            wantsGuardian === false
              ? "bg-accent text-white"
              : "bg-surface-2 text-muted border border-border hover:border-border-strong"
          }`}
        >
          No
        </button>
      </div>

      {wantsGuardian && (
        <div className="space-y-3">
          {METHODS.map((m) => {
            const selected = guardianMethod === m.key;
            return (
              <button
                key={m.key}
                type="button"
                onClick={() => onGuardianMethodChange(m.key)}
                className={`w-full text-left rounded-xl border p-4 transition-all ${
                  selected
                    ? "border-accent shadow-[var(--glow-accent)]"
                    : "border-border hover:border-border-strong"
                } bg-surface-1`}
              >
                <div className="flex items-start gap-3">
                  <span
                    className={`mt-0.5 ${selected ? "text-accent" : "text-muted"}`}
                  >
                    {m.icon}
                  </span>
                  <div>
                    <p className="font-medium text-foreground">{m.title}</p>
                    <p className="text-sm text-muted mt-1">{m.description}</p>
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      )}
    </section>
  );
}
