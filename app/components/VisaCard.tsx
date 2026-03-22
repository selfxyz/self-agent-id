// SPDX-FileCopyrightText: 2025-2026 Social Connect Labs, Inc.
// SPDX-License-Identifier: BUSL-1.1
// NOTE: Converts to Apache-2.0 on 2029-06-11 per LICENSE.

"use client";

import { useEffect, useState, useCallback } from "react";
import { Card } from "./Card";
import { Badge } from "./Badge";
import { Button } from "./Button";
import { CheckCircle2, ArrowUp, Loader2, ExternalLink } from "lucide-react";

interface VisaCardProps {
  agentId: number;
  chainId: number;
  blockExplorer?: string;
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
  reviewRequestedTier: number;
  manualReviewApproved: boolean;
}

interface ClaimResult {
  newTier: number;
  txHash: string;
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

const TIER_BENEFITS: Record<number, string[]> = {
  1: [
    "Co-marketing support from Celo Core Co.",
    "Mentorship from ecosystem founders and partners",
  ],
  2: [
    "Featured placement on UpDown's perpetual DEX",
    "DeFi incentives across Uniswap, Aave, Mento, and Velodrome",
  ],
  3: [
    "Liquidity support for agent token launches",
    "Access to 13M+ MiniPay users",
  ],
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

export function VisaCard({ agentId, chainId, blockExplorer }: VisaCardProps) {
  const explorerTxUrl = (hash: string) =>
    blockExplorer ? `${blockExplorer}/tx/${hash}` : null;

  const [data, setData] = useState<VisaData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const [claiming, setClaiming] = useState(false);
  const [requesting, setRequesting] = useState(false);
  const [claimResult, setClaimResult] = useState<ClaimResult | null>(null);

  const loadVisa = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/visa/${chainId}/${agentId}`);
      if (!res.ok) {
        setError(
          res.status === 404
            ? "Visa not available on this network"
            : "Failed to load visa data",
        );
        return;
      }
      setData((await res.json()) as VisaData);
    } catch {
      setError("Failed to load visa data");
    } finally {
      setLoading(false);
    }
  }, [agentId, chainId]);

  useEffect(() => {
    void loadVisa();
  }, [loadVisa]);

  async function handleRefresh() {
    setChecking(true);
    setError(null);
    try {
      await loadVisa();
    } finally {
      setChecking(false);
    }
  }

  async function handleClaim(targetTier: number) {
    setClaiming(true);
    setError(null);
    try {
      const res = await fetch("/api/visa/claim", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chainId: String(chainId),
          agentId: String(agentId),
          targetTier,
        }),
      });
      const result = (await res.json()) as {
        success?: boolean;
        newTier?: number;
        txHash?: string;
        error?: string;
      };
      if (!res.ok) {
        setError(result.error ?? "Claim failed");
        return;
      }
      setClaimResult({
        newTier: result.newTier ?? targetTier,
        txHash: result.txHash ?? "",
      });
      await loadVisa();
    } catch {
      setError("Claim failed — please try again");
    } finally {
      setClaiming(false);
    }
  }

  async function handleRequestReview(targetTier: number) {
    setRequesting(true);
    setError(null);
    try {
      const res = await fetch("/api/visa/request-review", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chainId: String(chainId),
          agentId: String(agentId),
          targetTier,
        }),
      });
      if (!res.ok) {
        const result = (await res.json()) as { error?: string };
        setError(result.error ?? "Review request failed");
        return;
      }
      await loadVisa();
    } catch {
      setError("Review request failed — please try again");
    } finally {
      setRequesting(false);
    }
  }

  if (loading) {
    return (
      <Card>
        <div className="flex items-center gap-2 text-sm text-muted">
          <Loader2 className="h-3 w-3 animate-spin" />
          Loading visa status...
        </div>
      </Card>
    );
  }

  if (error) {
    return (
      <Card>
        <p className="text-sm text-accent-error">{error}</p>
        <Button variant="secondary" size="sm" onClick={() => void loadVisa()}>
          Retry
        </Button>
      </Card>
    );
  }

  if (!data) return null;

  const { tier, metrics, eligibility, thresholds } = data;
  const nextTier = tier < 3 ? tier + 1 : null;
  const nextThresholds = nextTier !== null ? thresholds[nextTier] : null;
  const canUpgrade = nextTier !== null && eligibility[nextTier];

  // Success screen after claiming
  if (claimResult) {
    return (
      <Card>
        <div className="space-y-4 text-center py-4">
          <CheckCircle2 className="h-10 w-10 text-accent-success mx-auto" />
          <div>
            <h3 className="text-lg font-semibold">
              {TIER_LABELS[claimResult.newTier]} Visa Claimed
            </h3>
            <p className="text-xs text-muted mt-1">
              Your Celo Agent Visa has been upgraded
            </p>
          </div>
          {TIER_BENEFITS[claimResult.newTier] && (
            <div className="text-left space-y-1.5 bg-surface-1 rounded-lg p-3">
              <p className="text-xs font-medium text-foreground">
                Tier Benefits
              </p>
              {TIER_BENEFITS[claimResult.newTier].map((b) => (
                <p key={b} className="text-xs text-muted">
                  {b}
                </p>
              ))}
            </div>
          )}
          {claimResult.txHash &&
            (() => {
              const url = explorerTxUrl(claimResult.txHash);
              return url ? (
                <a
                  href={url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-xs text-accent hover:underline"
                >
                  View transaction
                  <ExternalLink className="h-3 w-3" />
                </a>
              ) : (
                <p className="text-[10px] text-muted font-mono break-all">
                  tx: {claimResult.txHash}
                </p>
              );
            })()}
          <Button
            variant="secondary"
            size="sm"
            onClick={() => setClaimResult(null)}
          >
            Back to Visa Status
          </Button>
        </div>
      </Card>
    );
  }

  return (
    <Card>
      <div className="space-y-4">
        {/* Header */}
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold">Celo Agent Visa</h3>
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
            No visa issued yet. Meet the minimum transaction threshold to
            qualify for a Tourist visa.
          </p>
        )}

        {/* Upgrade Available banner */}
        {canUpgrade && (
          <div className="flex items-center gap-2 rounded-lg bg-accent/10 px-3 py-2">
            <ArrowUp className="h-4 w-4 text-accent" />
            <p className="text-xs font-medium text-accent">
              Upgrade available — you qualify for{" "}
              {nextTier !== null ? TIER_LABELS[nextTier] : ""} Visa
            </p>
          </div>
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
        ) : tier === 3 ? (
          <p className="text-xs text-accent-success">Maximum tier reached</p>
        ) : null}

        {/* Tier benefits */}
        {tier > 0 && TIER_BENEFITS[tier] && (
          <div className="space-y-1.5 bg-surface-1 rounded-lg p-3">
            <p className="text-xs font-medium text-foreground">
              {TIER_LABELS[tier]} Benefits
            </p>
            {TIER_BENEFITS[tier].map((b) => (
              <p key={b} className="text-xs text-muted">
                {b}
              </p>
            ))}
          </div>
        )}

        {/* Eligibility indicators */}
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
            onClick={() => void handleRefresh()}
            disabled={checking}
          >
            {checking ? "Refreshing..." : "Refresh Status"}
          </Button>

          {nextTier !== null &&
            nextTier >= 2 &&
            nextThresholds?.requiresManualReview &&
            !data.manualReviewApproved &&
            (data.reviewRequestedTier > 0 ? (
              <Badge variant="info">Review Pending</Badge>
            ) : (
              <Button
                size="sm"
                variant="secondary"
                onClick={() => void handleRequestReview(nextTier)}
                disabled={requesting}
              >
                {requesting ? (
                  <>
                    <Loader2 className="h-3 w-3 animate-spin mr-1" />
                    Requesting...
                  </>
                ) : (
                  `Request Review for ${TIER_LABELS[nextTier]}`
                )}
              </Button>
            ))}

          {canUpgrade &&
            nextTier !== null &&
            (!nextThresholds?.requiresManualReview ||
              data.manualReviewApproved) && (
              <Button
                size="sm"
                onClick={() => void handleClaim(nextTier)}
                disabled={claiming}
              >
                {claiming ? (
                  <>
                    <Loader2 className="h-3 w-3 animate-spin mr-1" />
                    Claiming...
                  </>
                ) : (
                  `Claim ${TIER_LABELS[nextTier]} Visa`
                )}
              </Button>
            )}
        </div>

        {/* Last updated */}
        {metrics.lastUpdated > 0 && (
          <p className="text-[10px] text-muted">
            Metrics updated{" "}
            {new Date(metrics.lastUpdated * 1000).toLocaleDateString()}
          </p>
        )}
      </div>
    </Card>
  );
}
