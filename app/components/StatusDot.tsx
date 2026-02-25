// SPDX-FileCopyrightText: 2025-2026 Social Connect Labs, Inc.
// SPDX-License-Identifier: BUSL-1.1
// NOTE: Converts to Apache-2.0 on 2029-06-11 per LICENSE.

const colors: Record<string, string> = {
  verified: "bg-accent-success",
  revoked: "bg-accent-error",
  pending: "bg-accent-warn",
};

interface StatusDotProps {
  status: keyof typeof colors;
  className?: string;
}

export function StatusDot({ status, className = "" }: StatusDotProps) {
  return (
    <span
      className={`inline-block w-2 h-2 rounded-full ${colors[status]} ${className}`}
    />
  );
}
