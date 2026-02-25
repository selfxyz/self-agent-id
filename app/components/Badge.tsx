// SPDX-FileCopyrightText: 2025-2026 Social Connect Labs, Inc.
// SPDX-License-Identifier: BUSL-1.1
// NOTE: Converts to Apache-2.0 on 2029-06-11 per LICENSE.

import { ReactNode } from "react";

const styles: Record<string, string> = {
  success: "bg-accent-success/10 text-accent-success border-accent-success/20",
  warn: "bg-accent-warn/10 text-accent-warn border-accent-warn/20",
  error: "bg-accent-error/10 text-accent-error border-accent-error/20",
  info: "bg-accent-2/10 text-accent-2 border-accent-2/20",
  muted: "bg-surface-2 text-muted border-border",
};

interface BadgeProps {
  children: ReactNode;
  variant?: keyof typeof styles;
  className?: string;
}

export function Badge({ children, variant = "muted", className = "" }: BadgeProps) {
  return (
    <span
      className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium border ${styles[variant]} ${className}`}
    >
      {children}
    </span>
  );
}
