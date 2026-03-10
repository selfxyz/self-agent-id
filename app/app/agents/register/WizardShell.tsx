// SPDX-FileCopyrightText: 2025-2026 Social Connect Labs, Inc.
// SPDX-License-Identifier: BUSL-1.1
// NOTE: Converts to Apache-2.0 on 2029-06-11 per LICENSE.

"use client";

import React, { useState, useCallback } from "react";
import Link from "next/link";
import { ChevronLeft, Terminal, Globe, MessageSquare } from "lucide-react";
import { Card } from "@/components/Card";
import type { WizardStep, UserRole, Mode } from "./types";
import WhoAreYouStep from "./steps/WhoAreYouStep";
import { ModeSelector } from "./steps/ModeSelector";

interface WizardShellProps {
  /** If set, skip straight to mode selection (e.g. when returning from connect step). */
  initialStep?: "who" | "mode";
  initialRole?: UserRole;
  onWizardComplete?: (config: { role: UserRole; mode: Mode }) => void;
}

export function WizardShell({ initialStep = "who", initialRole = null, onWizardComplete }: WizardShellProps) {
  const [step, setStep] = useState<"who" | "mode">(initialStep);
  const [role, setRole] = useState<UserRole>(initialRole);

  const goBack = useCallback(() => {
    if (role === "bot") {
      setRole(null);
      setStep("who");
      return;
    }
    if (step === "mode") {
      setStep("who");
    }
  }, [step, role]);

  const handleRoleSelect = useCallback((selectedRole: UserRole) => {
    setRole(selectedRole);
    if (selectedRole === "bot") {
      return; // Show bot info panel
    }
    setStep("mode");
  }, []);

  const handleModeSelect = useCallback((selectedMode: Mode) => {
    onWizardComplete?.({ role, mode: selectedMode });
  }, [onWizardComplete, role]);

  // Bot info panel
  if (role === "bot") {
    return (
      <div className="space-y-6">
        <button
          onClick={goBack}
          className="flex items-center gap-1.5 text-sm text-muted hover:text-foreground transition-colors"
          data-testid="wizard-back"
        >
          <ChevronLeft size={14} />
          Back
        </button>

        <h2 className="text-lg font-semibold text-foreground text-center">
          Register programmatically
        </h2>
        <p className="text-sm text-muted text-center max-w-md mx-auto">
          Bots and agents can register via our API, CLI, or A2A protocol.
          A human will still need to verify their identity with the Self app.
        </p>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <Card className="text-center">
            <Terminal size={24} className="mx-auto mb-2 text-accent" />
            <p className="font-bold text-sm mb-1">CLI</p>
            <p className="text-xs text-muted mb-3">
              Register from the command line with guided prompts.
            </p>
            <Link href="/cli/register" className="text-xs text-accent hover:text-accent-2 underline">
              CLI Registration &rarr;
            </Link>
          </Card>

          <Card className="text-center">
            <Globe size={24} className="mx-auto mb-2 text-accent" />
            <p className="font-bold text-sm mb-1">REST API</p>
            <p className="text-xs text-muted mb-3">
              POST to /api/agent/register with your mode and keys.
            </p>
            <Link href="/api-docs" className="text-xs text-accent hover:text-accent-2 underline">
              API Docs &rarr;
            </Link>
          </Card>

          <Card className="text-center">
            <MessageSquare size={24} className="mx-auto mb-2 text-accent" />
            <p className="font-bold text-sm mb-1">A2A Protocol</p>
            <p className="text-xs text-muted mb-3">
              JSON-RPC over the Agent-to-Agent endpoint.
            </p>
            <Link href="/integration" className="text-xs text-accent hover:text-accent-2 underline">
              Integration Guide &rarr;
            </Link>
          </Card>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Step content */}
      {step === "who" && <WhoAreYouStep onSelect={handleRoleSelect} />}
      {step === "mode" && (
        <ModeSelector role={role} onSelect={handleModeSelect} onBack={goBack} />
      )}
    </div>
  );
}
