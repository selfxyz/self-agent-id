"use client";

import dynamic from "next/dynamic";
import { CheckCircle2, Loader2 } from "lucide-react";

import type { QRState } from "../hooks/useRegistrationState";

const SelfQRcodeWrapper = dynamic(
  () => import("@selfxyz/qrcode").then((mod) => mod.SelfQRcodeWrapper),
  { ssr: false },
);

interface QRPanelProps {
  qrState: QRState;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  qrData?: any;
  agentId?: string | null;
  agentAddress?: string | null;
  deepLink?: string | null;
  onSuccess?: () => void;
  onError?: (data: { error_code?: string; reason?: string }) => void;
}

const noop = () => {};

export function QRPanel({
  qrState,
  qrData,
  agentId,
  agentAddress,
  onSuccess = noop,
  onError = noop,
}: QRPanelProps) {
  if (qrState === "placeholder") {
    return (
      <div className="flex flex-col items-center justify-center gap-4 py-12">
        <div className="h-48 w-48 rounded-xl bg-surface-2 border border-border animate-pulse" />
        <p className="text-sm text-muted text-center">
          Complete the form to generate your QR code
        </p>
      </div>
    );
  }

  if (qrState === "live") {
    return (
      <div className="flex flex-col items-center gap-4">
        <p className="text-sm text-muted text-center">
          Scan with the Self app to verify your identity
        </p>
        {qrData && (
          <div className="rounded-xl overflow-hidden border border-gray-100 p-3 bg-white shadow-sm">
            <SelfQRcodeWrapper
              // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
              selfApp={qrData}
              size={220}
              onSuccess={onSuccess}
              onError={onError}
            />
          </div>
        )}
      </div>
    );
  }

  if (qrState === "scanning") {
    return (
      <div className="flex flex-col items-center gap-4">
        {qrData && (
          <div className="rounded-xl overflow-hidden border border-gray-100 p-3 bg-white shadow-sm">
            <SelfQRcodeWrapper
              // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
              selfApp={qrData}
              size={220}
              onSuccess={onSuccess}
              onError={onError}
            />
          </div>
        )}
        <div className="flex items-center gap-2 text-sm text-muted">
          <Loader2 className="h-4 w-4 animate-spin text-accent" />
          Waiting for passport scan...
        </div>
      </div>
    );
  }

  if (qrState === "success") {
    return (
      <div className="flex flex-col items-center gap-4 py-8">
        <CheckCircle2 className="h-12 w-12 text-accent-success" />
        <p className="text-lg font-semibold text-foreground">
          Registration complete
        </p>
        {agentId && (
          <div className="w-full rounded-lg border border-border bg-surface-1 p-3">
            <p className="text-xs text-muted mb-1">Agent ID</p>
            <p className="text-sm font-mono text-foreground break-all">
              {agentId}
            </p>
          </div>
        )}
        {agentAddress && (
          <div className="w-full rounded-lg border border-border bg-surface-1 p-3">
            <p className="text-xs text-muted mb-1">Agent address</p>
            <p className="text-sm font-mono text-foreground break-all">
              {agentAddress}
            </p>
          </div>
        )}
      </div>
    );
  }

  // "hidden" state — render nothing
  return null;
}
