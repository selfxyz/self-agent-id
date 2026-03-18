// SPDX-FileCopyrightText: 2025-2026 Social Connect Labs, Inc.
// SPDX-License-Identifier: BUSL-1.1
// NOTE: Converts to Apache-2.0 on 2029-06-11 per LICENSE.

"use client";

import { useEffect, useState } from "react";
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
  agentId: number;
  chainId: number;
}

export function VisaBadge({ agentId, chainId }: VisaBadgeProps) {
  const [tier, setTier] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/visa/${chainId}/${agentId}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (!cancelled && data) setTier(data.tier);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [agentId, chainId]);

  if (tier === null || tier === 0) return null;

  return (
    <Badge variant={TIER_VARIANTS[tier] ?? "muted"}>
      {TIER_NAMES[tier] ?? "Visa"} Visa
    </Badge>
  );
}
