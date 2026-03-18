// SPDX-FileCopyrightText: 2025-2026 Social Connect Labs, Inc.
// SPDX-License-Identifier: BUSL-1.1
// NOTE: Converts to Apache-2.0 on 2029-06-11 per LICENSE.

"use client";

import { Badge } from "./Badge";

const TIER_NAMES: Record<number, string> = {
  1: "Tourist",
  2: "Work",
  3: "Citizen",
};

const TIER_VARIANTS: Record<number, "info" | "warn" | "success" | "muted"> = {
  0: "muted",
  1: "info",
  2: "warn",
  3: "success",
};

interface VisaBadgeProps {
  tier: number;
}

/** Renders a visa tier badge. Pass tier=0 or omit to render nothing. */
export function VisaBadge({ tier }: VisaBadgeProps) {
  if (!tier) return null;

  return (
    <Badge variant={TIER_VARIANTS[tier] ?? "muted"}>
      {TIER_NAMES[tier] ?? "Visa"} Visa
    </Badge>
  );
}
