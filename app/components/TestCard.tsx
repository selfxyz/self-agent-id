// SPDX-FileCopyrightText: 2025-2026 Social Connect Labs, Inc.
// SPDX-License-Identifier: BUSL-1.1
// NOTE: Converts to Apache-2.0 on 2029-06-11 per LICENSE.

"use client";

import { type ReactNode, useState } from "react";
import {
  ChevronDown,
  ChevronUp,
  Check,
  X,
  Loader2,
  type LucideIcon,
} from "lucide-react";
import CodeBlock from "./CodeBlock";
import CardMatrixOverlay from "./CardMatrixReveal";

export type StepStatus = "pending" | "active" | "done" | "error";

export interface StepEntry {
  label: string;
  status: StepStatus;
  /** Elapsed time in ms, shown when step completes */
  durationMs?: number;
}

interface TestCardProps {
  title: string;
  icon: LucideIcon;
  description: string;
  steps: StepEntry[];
  status: "idle" | "running" | "success" | "error";
  result: ReactNode | null;
  error: string | null;
  codeSnippet?: string;
  codeLanguage?: string;
}

function StepIcon({ status }: { status: StepStatus }) {
  switch (status) {
    case "pending":
      return (
        <span className="w-4 h-4 rounded-full border border-gray-600 inline-block" />
      );
    case "active":
      return <Loader2 size={16} className="text-accent-success animate-spin" />;
    case "done":
      return <Check size={16} className="text-accent-success" />;
    case "error":
      return <X size={16} className="text-accent-error" />;
  }
}

export default function TestCard({
  title,
  icon: Icon,
  description,
  steps,
  status,
  result,
  error,
  codeSnippet,
  codeLanguage = "typescript",
}: TestCardProps) {
  const [showCode, setShowCode] = useState(false);

  return (
    <div className="relative rounded-xl border border-border bg-surface-1 overflow-hidden">
      <CardMatrixOverlay
        active={status === "success"}
        duration={1800}
        fadeOut={600}
      />
      {/* Header */}
      <div className="p-4 border-b border-border">
        <div className="flex items-center gap-2 mb-1">
          <Icon size={18} className="text-accent" />
          <h3 className="font-semibold text-sm">{title}</h3>
          {status === "success" && (
            <span className="ml-auto text-xs text-accent-success font-medium">
              PASS
            </span>
          )}
          {status === "error" && (
            <span className="ml-auto text-xs text-accent-error font-medium">
              FAIL
            </span>
          )}
        </div>
        <p className="text-xs text-muted">{description}</p>
      </div>

      {/* Step log */}
      <div className="relative p-4 bg-[#0d0d14] font-mono text-xs space-y-2 min-h-[120px]">
        {status === "idle" ? (
          <p className="text-gray-600">Waiting to run...</p>
        ) : (
          steps.map((step, i) => (
            <div key={i} className="flex items-center gap-2">
              <StepIcon status={step.status} />
              <span
                className={
                  step.status === "active"
                    ? "text-accent-success"
                    : step.status === "done"
                      ? "text-muted"
                      : step.status === "error"
                        ? "text-accent-error"
                        : "text-gray-600"
                }
              >
                {step.label}
              </span>
              {step.durationMs != null && step.status === "done" && (
                <span className="ml-auto text-[10px] text-gray-500 tabular-nums">
                  {step.durationMs}ms
                </span>
              )}
            </div>
          ))
        )}

        {error && (
          <div className="mt-2 p-2 rounded bg-accent-error/10 text-accent-error text-xs">
            {error}
          </div>
        )}

        {/* Result shown inline below steps on success */}
        {status === "success" && result && (
          <div className="mt-3 pt-3 border-t border-gray-800">{result}</div>
        )}
      </div>

      {/* View Code toggle */}
      {codeSnippet && (
        <div className="border-t border-border">
          <button
            onClick={() => setShowCode(!showCode)}
            className="w-full px-4 py-2 flex items-center justify-between text-xs text-muted hover:text-foreground transition-colors"
          >
            <span>View Code</span>
            {showCode ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
          </button>
          {showCode && (
            <div className="px-2 pb-2">
              <CodeBlock
                tabs={[
                  {
                    label: codeLanguage,
                    language: codeLanguage,
                    code: codeSnippet,
                  },
                ]}
              />
            </div>
          )}
        </div>
      )}
    </div>
  );
}
