// SPDX-FileCopyrightText: 2025-2026 Social Connect Labs, Inc.
// SPDX-License-Identifier: BUSL-1.1
// NOTE: Converts to Apache-2.0 on 2029-06-11 per LICENSE.

"use client";

import { useEffect, useState } from "react";
import { Card } from "./Card";
import { Badge } from "./Badge";

interface VisaCardProps {
  agentId: number;
  chainId: number;
}

interface TierThresholds {
  minTransactions: number;
  minVolumeUsd: number;
  requiresBoth: boolean;
  requiresManualReview: boolean;
}

interface VisaData {
  tier: number;
  metrics: {
    transactionCount: number;
    volumeUsd: number;
    lastUpdated: number;
  };
  eligibility: Record<number, boolean>;
  thresholds: Record<number, TierThresholds>;
}

const TIER_LABELS: Record<number, string> = {
  0: "None",
  1: "Tourist",
  2: "Work",
  3: "Citizenship",
};

const TIER_BADGE_VARIANT: Record<number, string> = {
  0: "muted",
  1: "info",
  2: "warn",
  3: "success",
};

function ProgressBar({ value, label }: { value: number; label: string }) {
  const pct = Math.min(value, 1) * 100;
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-xs text-muted">
        <span>{label}</span>
        <span className="tabular-nums">{Math.round(pct)}%</span>
      </div>
      <div className="h-1.5 rounded-full bg-surface-2 overflow-hidden">
        <div
          className="h-full rounded-full bg-accent transition-all"
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

export function VisaCard({ agentId, chainId }: VisaCardProps) {
  const [data, setData] = useState<VisaData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError(null);

      try {
        const res = await fetch(`/api/visa/${chainId}/${agentId}`);

        if (!res.ok) {
          if (res.status === 404) {
            setError("Visa not available on this network");
          } else {
            setError("Failed to load visa data");
          }
          return;
        }

        const json = (await res.json()) as VisaData;
        if (!cancelled) setData(json);
      } catch {
        if (!cancelled) setError("Failed to load visa data");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [agentId, chainId]);

  if (loading) {
    return (
      <Card>
        <div className="flex items-center gap-2 text-sm text-muted">
          <span className="inline-block w-3 h-3 border-2 border-accent border-t-transparent rounded-full animate-spin" />
          Loading visa status...
        </div>
      </Card>
    );
  }

  if (error) {
    return (
      <Card>
        <p className="text-sm text-muted">{error}</p>
      </Card>
    );
  }

  if (!data) return null;

  const { tier, metrics, eligibility, thresholds } = data;
  const nextTier = tier < 3 ? tier + 1 : null;
  const nextThresholds = nextTier !== null ? thresholds[nextTier] : null;

  return (
    <Card>
      <div className="space-y-4">
        {/* Header */}
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold">Visa Status</h3>
          <Badge
            variant={
              TIER_BADGE_VARIANT[tier] as "muted" | "info" | "warn" | "success"
            }
          >
            {TIER_LABELS[tier]}
          </Badge>
        </div>

        {/* No Visa state */}
        {tier === 0 && (
          <p className="text-xs text-muted">
            No visa issued. Meet minimum transaction and volume thresholds to
            qualify for Tourist tier.
          </p>
        )}

        {/* Current Metrics */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <p className="text-xs text-muted">Transactions</p>
            <p className="text-sm font-medium tabular-nums">
              {metrics.transactionCount.toLocaleString()}
            </p>
          </div>
          <div>
            <p className="text-xs text-muted">Volume (USD)</p>
            <p className="text-sm font-medium tabular-nums">
              ${metrics.volumeUsd.toLocaleString()}
            </p>
          </div>
        </div>

        {/* Progress to next tier */}
        {nextTier !== null && nextThresholds ? (
          <div className="space-y-2">
            <p className="text-xs text-muted">
              Progress to {TIER_LABELS[nextTier]}
              {nextThresholds.requiresBoth ? " (both required)" : " (either)"}
            </p>
            <ProgressBar
              label="Transactions"
              value={
                nextThresholds.minTransactions > 0
                  ? metrics.transactionCount / nextThresholds.minTransactions
                  : 1
              }
            />
            <ProgressBar
              label="Volume"
              value={
                nextThresholds.minVolumeUsd > 0
                  ? metrics.volumeUsd / nextThresholds.minVolumeUsd
                  : 1
              }
            />
          </div>
        ) : (
          <p className="text-xs text-accent-success">Maximum tier reached</p>
        )}

        {/* Eligibility */}
        <div className="flex items-center gap-2 flex-wrap">
          {[1, 2, 3].map((t) => (
            <span
              key={t}
              className={`text-xs px-2 py-0.5 rounded ${
                eligibility[t]
                  ? "bg-accent-success/10 text-accent-success"
                  : "bg-surface-2 text-muted"
              }`}
            >
              {TIER_LABELS[t]}
              {eligibility[t] ? " \u2713" : ""}
            </span>
          ))}
        </div>
      </div>
    </Card>
  );
}
