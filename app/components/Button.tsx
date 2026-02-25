// SPDX-FileCopyrightText: 2025-2026 Social Connect Labs, Inc.
// SPDX-License-Identifier: BUSL-1.1
// NOTE: Converts to Apache-2.0 on 2029-06-11 per LICENSE.

import type { ButtonHTMLAttributes, ReactNode } from "react";

const variants: Record<string, string> = {
  primary:
    "bg-gradient-to-r from-accent to-accent-2 text-white hover:opacity-90",
  secondary:
    "bg-surface-2 border border-border text-foreground hover:border-border-strong hover:translate-y-[-1px]",
  ghost: "bg-transparent text-muted hover:text-foreground hover:bg-surface-1",
  danger:
    "bg-accent-error/10 border border-accent-error/20 text-accent-error hover:bg-accent-error/20",
};

const sizes: Record<string, string> = {
  sm: "px-3 py-1.5 text-sm",
  md: "px-4 py-2 text-sm",
  lg: "px-6 py-3 text-base",
};

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  children: ReactNode;
  variant?: keyof typeof variants;
  size?: "sm" | "md" | "lg";
}

export function Button({
  children,
  variant = "primary",
  size = "md",
  className = "",
  ...props
}: ButtonProps) {
  return (
    <button
      className={`inline-flex items-center justify-center gap-2 rounded-lg font-medium transition-all disabled:opacity-50 disabled:pointer-events-none ${variants[variant]} ${sizes[size]} ${className}`}
      {...props}
    >
      {children}
    </button>
  );
}
