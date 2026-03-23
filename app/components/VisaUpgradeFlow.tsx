// SPDX-FileCopyrightText: 2025-2026 Social Connect Labs, Inc.
// SPDX-License-Identifier: BUSL-1.1
// NOTE: Converts to Apache-2.0 on 2029-06-11 per LICENSE.

"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { Card } from "./Card";
import { Button } from "./Button";
import { Badge } from "./Badge";
import { Loader2, CheckCircle2, ExternalLink, ArrowLeft } from "lucide-react";
import type { SelfApp } from "@selfxyz/qrcode";
import dynamic from "next/dynamic";

// Dynamic import to avoid SSR issues with QR code library
const SelfQRcodeWrapper = dynamic(
  () => import("@selfxyz/qrcode").then((mod) => mod.SelfQRcodeWrapper),
  { ssr: false },
);

interface VisaUpgradeFlowProps {
  oldAgentId: string;
  chainId: number;
  walletAddress: string;
  blockExplorer?: string;
  onComplete: () => void;
  onCancel: () => void;
}

type FlowStage =
  | "init"
  | "qr-ready"
  | "scanning"
  | "registering"
  | "migrating"
  | "success"
  | "error";

interface RegistrationSession {
  sessionToken: string;
  qrData: SelfApp;
  deepLink: string;
  agentAddress: string;
}

interface MigrationResult {
  newAgentId: string;
  newTier: number;
  mintTxHash: string;
}

export function VisaUpgradeFlow({
  oldAgentId,
  chainId,
  walletAddress,
  blockExplorer,
  onComplete,
  onCancel,
}: VisaUpgradeFlowProps) {
  const [stage, setStage] = useState<FlowStage>("init");
  const [error, setError] = useState<string | null>(null);
  const [session, setSession] = useState<RegistrationSession | null>(null);
  const [migrationResult, setMigrationResult] =
    useState<MigrationResult | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const explorerTxUrl = (hash: string) =>
    blockExplorer ? `${blockExplorer}/tx/${hash}` : null;

  // Step 1: Initiate Self registration
  const startRegistration = useCallback(async () => {
    setStage("init");
    setError(null);
    try {
      const network = chainId === 42220 ? "mainnet" : "testnet";
      const res = await fetch("/api/agent/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode: "linked",
          network,
          humanAddress: walletAddress,
          disclosures: {
            minimumAge: 18,
            nationality: true,
            ofac: true,
          },
        }),
      });
      if (!res.ok) {
        const data = (await res.json()) as { error?: string };
        throw new Error(data.error ?? "Failed to start registration");
      }
      const data = (await res.json()) as {
        sessionToken: string;
        qrData: SelfApp;
        deepLink: string;
        agentAddress: string;
      };
      setSession({
        sessionToken: data.sessionToken,
        qrData: data.qrData,
        deepLink: data.deepLink,
        agentAddress: data.agentAddress,
      });
      setStage("qr-ready");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Registration failed");
      setStage("error");
    }
  }, [chainId, walletAddress]);

  // Step 2: Poll for registration completion
  const startPolling = useCallback(() => {
    if (!session?.sessionToken) return;
    const token = session.sessionToken;
    setStage("registering");

    pollRef.current = setInterval(async () => {
      try {
        const res = await fetch("/api/agent/register/status", {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!res.ok) return;
        const data = (await res.json()) as { agentId?: number };
        if (data.agentId) {
          if (pollRef.current) clearInterval(pollRef.current);
          void runMigration(String(data.agentId));
        }
      } catch {
        // Polling errors are transient — keep polling
      }
    }, 3000);
  }, [session]);

  // Step 3: Migrate visa data to new agentId
  // Retries up to 2 times if registration hasn't landed on-chain yet
  const runMigration = async (registryAgentId: string, retryCount = 0) => {
    setStage("migrating");
    try {
      const res = await fetch("/api/visa/migrate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chainId: String(chainId),
          oldAgentId,
          newAgentId: registryAgentId,
          connectedWallet: walletAddress,
          targetTier: 2,
        }),
      });
      const data = (await res.json()) as {
        success?: boolean;
        error?: string;
        newTier?: number;
        mintTxHash?: string;
      };
      if (!res.ok) {
        // Retry if registration hasn't landed on-chain yet
        if (data.error?.includes("not registered") && retryCount < 2) {
          await new Promise((r) => setTimeout(r, 5000));
          return runMigration(registryAgentId, retryCount + 1);
        }
        throw new Error(data.error ?? "Migration failed");
      }
      setMigrationResult({
        newAgentId: registryAgentId,
        newTier: data.newTier ?? 2,
        mintTxHash: data.mintTxHash ?? "",
      });
      setStage("success");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Migration failed");
      setStage("error");
    }
  };

  // Cleanup polling on unmount
  useEffect(() => {
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, []);

  // Auto-start registration on mount only
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    void startRegistration();
  }, []);

  // QR callback handlers
  const handleQRSuccess = () => {
    setStage("scanning");
    startPolling();
  };

  const handleQRError = () => {
    setError("QR scan failed — please try again");
    setStage("error");
  };

  // ── Render ─────────────────────────────────────────────────

  if (stage === "success" && migrationResult) {
    return (
      <Card>
        <div className="space-y-4 text-center py-4">
          <CheckCircle2 className="h-10 w-10 text-accent-success mx-auto" />
          <div>
            <h3 className="text-lg font-semibold">Work Visa Claimed</h3>
            <p className="text-xs text-muted mt-1">
              Your identity is verified and your visa has been upgraded
            </p>
          </div>
          <div className="text-xs text-muted space-y-1">
            <p>New Agent ID: {migrationResult.newAgentId}</p>
            {migrationResult.mintTxHash &&
              (() => {
                const url = explorerTxUrl(migrationResult.mintTxHash);
                return url ? (
                  <a
                    href={url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-accent hover:underline"
                  >
                    View transaction <ExternalLink className="h-3 w-3" />
                  </a>
                ) : null;
              })()}
          </div>
          <Button variant="secondary" size="sm" onClick={onComplete}>
            Back to Visa Status
          </Button>
        </div>
      </Card>
    );
  }

  if (stage === "error") {
    return (
      <Card>
        <div className="space-y-3 text-center py-4">
          <p className="text-sm text-accent-error">{error}</p>
          <div className="flex items-center justify-center gap-2">
            <Button variant="secondary" size="sm" onClick={onCancel}>
              <ArrowLeft className="h-3 w-3 mr-1" /> Back
            </Button>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => void startRegistration()}
            >
              Retry
            </Button>
          </div>
        </div>
      </Card>
    );
  }

  return (
    <Card>
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold">
            Verify Identity to Upgrade
          </h3>
          <Badge variant="info">
            Step{" "}
            {stage === "qr-ready" || stage === "scanning" ? "1" : "2"} of 2
          </Badge>
        </div>

        {stage === "init" && (
          <div className="flex items-center justify-center gap-2 py-8 text-muted">
            <Loader2 className="h-4 w-4 animate-spin" />
            Preparing verification...
          </div>
        )}

        {(stage === "qr-ready" || stage === "scanning") &&
          session != null && (
            <div className="space-y-3">
              <p className="text-xs text-muted text-center">
                Scan this QR code with the{" "}
                <span className="font-medium text-foreground">
                  Self app
                </span>{" "}
                to verify your identity
              </p>
              <div className="flex justify-center">
                <SelfQRcodeWrapper
                  selfApp={session.qrData}
                  size={280}
                  onSuccess={handleQRSuccess}
                  onError={handleQRError}
                />
              </div>
              {session.deepLink && (
                <p className="text-center">
                  <a
                    href={session.deepLink}
                    className="text-xs text-accent hover:underline"
                  >
                    Open Self app on this device
                  </a>
                </p>
              )}
              {stage === "scanning" && (
                <div className="flex items-center justify-center gap-2 text-xs text-muted">
                  <Loader2 className="h-3 w-3 animate-spin" />
                  Waiting for passport scan...
                </div>
              )}
            </div>
          )}

        {stage === "registering" && (
          <div className="flex flex-col items-center gap-2 py-8 text-muted">
            <Loader2 className="h-4 w-4 animate-spin" />
            <p className="text-xs">
              Confirming registration on-chain...
            </p>
          </div>
        )}

        {stage === "migrating" && (
          <div className="flex flex-col items-center gap-2 py-8 text-muted">
            <Loader2 className="h-4 w-4 animate-spin" />
            <p className="text-xs">
              Migrating your visa and upgrading to Work tier...
            </p>
          </div>
        )}

        <div className="flex justify-start">
          <Button variant="secondary" size="sm" onClick={onCancel}>
            <ArrowLeft className="h-3 w-3 mr-1" /> Cancel
          </Button>
        </div>
      </div>
    </Card>
  );
}
