// SPDX-FileCopyrightText: 2025-2026 Social Connect Labs, Inc.
// SPDX-License-Identifier: BUSL-1.1
// NOTE: Converts to Apache-2.0 on 2029-06-11 per LICENSE.

/** Privy logo rendered as an <img> sized to match lucide icon conventions. */
export function PrivyIcon({ size = 16, className }: { size?: number; className?: string }) {
  return (
    <img
      src="/privy-logo.png"
      alt="Privy"
      width={size}
      height={size}
      className={className}
      style={{ objectFit: "contain" }}
    />
  );
}
