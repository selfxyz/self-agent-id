// SPDX-FileCopyrightText: 2025-2026 Social Connect Labs, Inc.
// SPDX-License-Identifier: BUSL-1.1
// NOTE: Converts to Apache-2.0 on 2029-06-11 per LICENSE.

"use client";

import { useEffect, useState, useCallback } from "react";
import { Card } from "./Card";
import { Badge } from "./Badge";
import { Button } from "./Button";

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
  tierName: string;
  metrics: {
    transactionCount: number;
    volumeUsd: number;
    lastUpdated: number;
  };
  eligibility: Record<number, boolean>;
  thresholds: Record<number, TierThresholds>;
}

/** Scoring service base URL — configurable via env, defaults to localhost for dev */
const SCORING_URL = process.env.NEXT_PUBLIC_SCORING_SERVICE_URL || "";

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
  const [checking, setChecking] = useState(false);

  const loadVisa = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/visa/${chainId}/${agentId}`);
      if (!res.ok) {
        setError(res.status === 404 ? "Visa not available on this network" : "Failed to load visa data");
        return;
      }
      setData((await res.json()) as VisaData);
    } catch {
      setError("Failed to load visa data");
    } finally {
      setLoading(false);
    }
  }, [agentId, chainId]);

  useEffect(() => { void loadVisa(); }, [loadVisa]);

  async function handleCheckEligibility() {
    if (!SCORING_URL) {
      // No scoring service configured — just refresh on-chain data
      await loadVisa();
      return;
    }
    setChecking(true);
    try {
      const res = await fetch(`${SCORING_URL}/push/${agentId}`, { method: "POST" });
      if (!res.ok) throw new Error("Push failed");
      // Refresh visa data after push
      await loadVisa();
    } catch {
      setError("Eligibility check failed — scoring service may be offline");
    } finally {
      setChecking(false);
    }
  }

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

        {/* Actions */}
        <div className="flex items-center gap-2 pt-1">
          <Button
            variant="secondary"
            size="sm"
            onClick={handleCheckEligibility}
            disabled={checking}
          >
            {checking ? "Checking..." : "Check Eligibility"}
          </Button>
          {nextTier !== null && eligibility[nextTier] && (
            <Button size="sm" disabled>
              Claim {TIER_LABELS[nextTier]} Visa
            </Button>
          )}
        </div>

        {/* Last updated */}
        {metrics.lastUpdated > 0 && (
          <p className="text-[10px] text-muted">
            Metrics last updated{" "}
            {new Date(metrics.lastUpdated * 1000).toLocaleDateString()}
          </p>
        )}
      </div>
    </Card>
  );
}
