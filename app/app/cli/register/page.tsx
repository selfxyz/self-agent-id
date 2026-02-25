// SPDX-FileCopyrightText: 2025-2026 Social Connect Labs, Inc.
// SPDX-License-Identifier: BUSL-1.1
// NOTE: Converts to Apache-2.0 on 2029-06-11 per LICENSE.

"use client";

import React, { useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import { Fingerprint, Loader2, AlertTriangle, CheckCircle2, Smartphone } from "lucide-react";
import { Card } from "@/components/Card";
import { Button } from "@/components/Button";
import MatrixText from "@/components/MatrixText";
import { createPasskeyWallet, isPasskeySupported } from "@/lib/aa";
import { NETWORKS, type NetworkConfig } from "@/lib/network";

const SelfQRcodeWrapper = dynamic(
  () => import("@selfxyz/qrcode").then((mod) => mod.SelfQRcodeWrapper),
  { ssr: false }
);

let SelfAppBuilderClass: typeof import("@selfxyz/qrcode").SelfAppBuilder | null = null;

type HandoffMode = "verified-wallet" | "agent-identity" | "wallet-free" | "smart-wallet";
type HandoffOperation = "register" | "deregister";

interface CliDisclosures {
  minimumAge?: 0 | 18 | 21;
  ofac?: boolean;
  nationality?: boolean;
  name?: boolean;
  date_of_birth?: boolean;
  gender?: boolean;
  issuing_state?: boolean;
}

interface SmartWalletTemplate {
  agentAddress: string;
  r: string;
  s: string;
  v: number;
  configIndex: number;
}

interface CliHandoffPayload {
  version: 1;
  operation: HandoffOperation;
  sessionId: string;
  stateToken: string;
  callbackUrl: string;
  mode: HandoffMode;
  chainId: number;
  registryAddress: string;
  endpointType: "celo" | "staging_celo";
  appName: string;
  scope: string;
  humanIdentifier: string;
  expectedAgentAddress: string;
  disclosures?: CliDisclosures;
  userDefinedData?: string;
  smartWalletTemplate?: SmartWalletTemplate;
  expiresAt: number;
}

function decodeBase64UrlJson<T>(value: string): T {
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
  const json = decodeURIComponent(
    Array.from(atob(padded))
      .map((ch) => `%${ch.charCodeAt(0).toString(16).padStart(2, "0")}`)
      .join("")
  );
  return JSON.parse(json) as T;
}

function getNetworkByChainId(chainId: number): NetworkConfig | null {
  const all = Object.values(NETWORKS);
  return all.find((n) => n.chainId === chainId) ?? null;
}

function buildDisclosures(input?: CliDisclosures): Record<string, boolean | number> {
  if (!input) return {};
  const out: Record<string, boolean | number> = {};
  if (input.nationality) out.nationality = true;
  if (input.name) out.name = true;
  if (input.date_of_birth) out.date_of_birth = true;
  if (input.gender) out.gender = true;
  if (input.issuing_state) out.issuing_state = true;
  if (input.ofac) out.ofac = true;
  if ((input.minimumAge ?? 0) > 0) out.minimumAge = input.minimumAge as number;
  return out;
}

function configIndexDigit(idx: number): string {
  if (!Number.isInteger(idx) || idx < 0 || idx > 5) throw new Error("Invalid config index");
  return String(idx);
}

function buildSmartWalletUserDefinedData(
  tpl: SmartWalletTemplate,
  guardianAddress: string
): string {
  const cfg = configIndexDigit(tpl.configIndex);
  const agentHex = tpl.agentAddress.slice(2).toLowerCase();
  const guardianHex = guardianAddress.slice(2).toLowerCase();
  const rHex = tpl.r.replace(/^0x/, "").toLowerCase();
  const sHex = tpl.s.replace(/^0x/, "").toLowerCase();
  const vHex = tpl.v.toString(16).padStart(2, "0");
  return "W" + cfg + agentHex + guardianHex + rHex + sHex + vHex;
}

export default function CliRegisterHandoffPage() {
  const [payload, setPayload] = useState<CliHandoffPayload | null>(null);
  const [network, setNetwork] = useState<NetworkConfig | null>(null);
  const [error, setError] = useState<string>("");
  const [selfApp, setSelfApp] = useState<ReturnType<
    InstanceType<typeof import("@selfxyz/qrcode").SelfAppBuilder>["build"]
  > | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [completed, setCompleted] = useState<boolean>(false);
  const [passkeySupported, setPasskeySupported] = useState<boolean>(true);
  const [guardianAddress, setGuardianAddress] = useState<string | null>(null);
  const [callbackPosted, setCallbackPosted] = useState<boolean>(false);

  useEffect(() => {
    setPasskeySupported(isPasskeySupported());
  }, []);

  useEffect(() => {
    import("@selfxyz/qrcode")
      .then((mod) => {
        SelfAppBuilderClass = mod.SelfAppBuilder;
      })
      .catch((err) => {
        setError(`Failed to load Self SDK: ${String(err)}`);
      });
  }, []);

  useEffect(() => {
    try {
      const params = new URLSearchParams(window.location.search);
      const encoded = params.get("payload");
      if (!encoded) {
        setError("Missing payload query parameter.");
        return;
      }

      const parsed = decodeBase64UrlJson<CliHandoffPayload>(encoded);
      if (!parsed.operation) parsed.operation = "register";
      if (parsed.version !== 1) {
        setError(`Unsupported payload version: ${String(parsed.version)}`);
        return;
      }
      if (Date.now() > parsed.expiresAt) {
        setError("This CLI session has expired. Re-run `register init` or `deregister init` in the CLI.");
        return;
      }

      const net = getNetworkByChainId(parsed.chainId);
      if (!net) {
        setError(`Unsupported chain ID: ${String(parsed.chainId)}`);
        return;
      }
      if (net.registryAddress.toLowerCase() !== parsed.registryAddress.toLowerCase()) {
        setError("Payload registry does not match supported network configuration.");
        return;
      }

      setPayload(parsed);
      setNetwork(net);
    } catch (err) {
      setError(`Invalid payload: ${err instanceof Error ? err.message : String(err)}`);
    }
  }, []);

  const canBuildSimpleFlow = useMemo(() => {
    if (!payload) return false;
    if (payload.operation === "deregister") return true;
    return payload.mode !== "smart-wallet";
  }, [payload]);

  useEffect(() => {
    if (!canBuildSimpleFlow || !payload || !SelfAppBuilderClass) return;
    if (!payload.userDefinedData) {
      setError("Missing userDefinedData for this CLI flow.");
      return;
    }

    try {
      const built = new SelfAppBuilderClass({
        version: 2,
        appName: payload.appName,
        scope: payload.scope,
        endpoint: payload.registryAddress,
        logoBase64: "https://i.postimg.cc/mrmVf9hm/self.png",
        userId: payload.humanIdentifier,
        endpointType: payload.endpointType,
        userIdType: "hex",
        userDefinedData: payload.userDefinedData,
        disclosures: buildDisclosures(payload.disclosures),
      }).build();
      setSelfApp(built);
    } catch (err) {
      setError(`Failed to build Self app payload: ${err instanceof Error ? err.message : String(err)}`);
    }
  }, [canBuildSimpleFlow, payload]);

  const postCallback = async (status: "success" | "error", callbackError?: string): Promise<void> => {
    if (!payload || callbackPosted) return;

    try {
      const res = await fetch(payload.callbackUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          version: 1,
          operation: payload.operation,
          sessionId: payload.sessionId,
          stateToken: payload.stateToken,
          status,
          chainId: payload.chainId,
          mode: payload.mode,
          expectedAgentAddress: payload.expectedAgentAddress,
          guardianAddress: guardianAddress ?? undefined,
          error: callbackError,
          timestamp: Date.now(),
        }),
      });

      if (!res.ok) {
        const text = await res.text().catch(() => "");
        setError(`Callback failed (${res.status}): ${text || "unknown error"}`);
        return;
      }

      setCallbackPosted(true);
    } catch (err) {
      setError(`Callback error: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  const handleSmartWalletPrepare = async () => {
    if (!payload || !network) return;
    if (payload.mode !== "smart-wallet") return;
    if (!payload.smartWalletTemplate) {
      setError("Missing smart wallet template payload.");
      return;
    }
    if (!passkeySupported) {
      setError("Passkeys are not supported in this browser.");
      return;
    }
    if (!SelfAppBuilderClass) {
      setError("Self SDK is still loading. Please retry.");
      return;
    }

    setLoading(true);
    setError("");
    try {
      const { walletAddress } = await createPasskeyWallet("Self Agent ID", network);
      setGuardianAddress(walletAddress);

      const userDefinedData = buildSmartWalletUserDefinedData(
        payload.smartWalletTemplate,
        walletAddress
      );

      const built = new SelfAppBuilderClass({
        version: 2,
        appName: payload.appName,
        scope: payload.scope,
        endpoint: payload.registryAddress,
        logoBase64: "https://i.postimg.cc/mrmVf9hm/self.png",
        userId: payload.humanIdentifier,
        endpointType: payload.endpointType,
        userIdType: "hex",
        userDefinedData,
        disclosures: buildDisclosures(payload.disclosures),
      }).build();
      setSelfApp(built);
    } catch (err) {
      setError(`Failed to prepare smart wallet flow: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setLoading(false);
    }
  };

  const onSuccess = async () => {
    await postCallback("success");
    setCompleted(true);
  };

  const onError = async (err: unknown) => {
    const message = err instanceof Error ? err.message : String(err);
    await postCallback("error", message);
    setError(`Verification failed: ${message}`);
  };

  return (
    <main className="min-h-screen max-w-xl mx-auto px-6 pt-20 pb-12">
      <div className="flex justify-center mb-6">
        <MatrixText text={payload?.operation === "deregister" ? "CLI Deregistration" : "CLI Registration"} fontSize={38} />
      </div>

      {!payload || !network ? (
        <Card variant="error">
          <div className="flex items-center gap-2">
            <AlertTriangle size={16} className="text-accent-error shrink-0" />
            <p className="text-sm text-accent-error">{error || "Preparing registration session..."}</p>
          </div>
        </Card>
      ) : completed ? (
        <Card>
          <div className="flex items-center gap-2 mb-2">
            <CheckCircle2 size={18} className="text-accent-success shrink-0" />
            <p className="font-bold text-accent-success">
              {payload.operation === "deregister" ? "Deregistration Submitted" : "Registration Submitted"}
            </p>
          </div>
          <p className="text-sm text-muted">
            Passport proof submission succeeded. Return to your terminal and run{" "}
            <code className="bg-surface-2 px-1 rounded text-accent-2">
              {payload.operation === "deregister" ? "deregister wait" : "register wait"}
            </code>{" "}
            (or keep it running) to confirm on-chain {payload.operation}.
          </p>
        </Card>
      ) : (
        <div className="flex flex-col gap-4">
          <Card>
            <p className="font-bold text-sm mb-2">Session</p>
            <p className="text-xs text-muted mb-1">
              Operation: <span className="text-foreground font-mono">{payload.operation}</span>
            </p>
            <p className="text-xs text-muted mb-1">
              Mode: <span className="text-foreground font-mono">{payload.mode}</span>
            </p>
            <p className="text-xs text-muted mb-1">
              Chain: <span className="text-foreground">{network.label} ({payload.chainId})</span>
            </p>
            <p className="text-xs text-muted">
              Agent:{" "}
              <span className="text-foreground font-mono">
                {payload.expectedAgentAddress}
              </span>
            </p>
          </Card>

          {payload.mode === "smart-wallet" && payload.operation === "register" && !selfApp ? (
            <Card>
              <div className="flex items-center gap-2 mb-2">
                <Fingerprint size={16} className="text-accent-success shrink-0" />
                <p className="font-bold text-sm">Smart Wallet Setup</p>
              </div>
              <p className="text-sm text-muted mb-3">
                Create the passkey smart wallet first. It becomes the guardian for this agent.
              </p>
              <Button
                onClick={handleSmartWalletPrepare}
                variant="primary"
                size="lg"
                disabled={loading || !passkeySupported}
              >
                {loading ? (
                  <>
                    <Loader2 size={18} className="animate-spin" />
                    Creating Passkey...
                  </>
                ) : (
                  <>
                    <Fingerprint size={18} />
                    Create Passkey Wallet
                  </>
                )}
              </Button>
              {!passkeySupported && (
                <p className="text-xs text-accent-error mt-2">
                  Passkeys are not available in this browser.
                </p>
              )}
            </Card>
          ) : (
            <Card>
              <div className="flex items-center gap-2 mb-3">
                <Smartphone size={16} className="text-accent shrink-0" />
                <p className="font-bold text-sm">Scan with the Self App</p>
              </div>
              <p className="text-sm text-muted mb-3">
                Complete your passport disclosure proof. This page will notify your local CLI when successful.
              </p>
              {selfApp ? (
                <div className="rounded-xl p-4 bg-white mx-auto w-fit">
                  <SelfQRcodeWrapper selfApp={selfApp} onSuccess={onSuccess} onError={onError} />
                </div>
              ) : (
                <div className="w-64 h-64 bg-surface-2 animate-pulse rounded-lg flex items-center justify-center mx-auto">
                  <p className="text-muted text-sm">Preparing QR code...</p>
                </div>
              )}
            </Card>
          )}

          {error && (
            <Card variant="error">
              <div className="flex items-center gap-2">
                <AlertTriangle size={16} className="text-accent-error shrink-0" />
                <p className="text-sm text-accent-error">{error}</p>
              </div>
            </Card>
          )}
        </div>
      )}
    </main>
  );
}
