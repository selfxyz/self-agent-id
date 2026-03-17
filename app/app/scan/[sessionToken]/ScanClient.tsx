"use client";

// SPDX-FileCopyrightText: 2025-2026 Social Connect Labs, Inc.
// SPDX-License-Identifier: BUSL-1.1
// NOTE: Converts to Apache-2.0 on 2029-06-11 per LICENSE.

import React, { useState, useEffect, useRef } from "react";
import dynamic from "next/dynamic";
import type { SelfApp } from "@selfxyz/qrcode";

const SelfQRcodeWrapper = dynamic(
  () => import("@selfxyz/qrcode").then((m) => m.SelfQRcodeWrapper),
  { ssr: false },
);

type SessionType = "register" | "identify" | "deregister" | "refresh";
type ScanState = "scanning" | "success" | "error" | "expired";

const COPY: Record<
  SessionType,
  { title: string; subtitle: string; success: string; openButton: string }
> = {
  register: {
    title: "Register Your Agent",
    subtitle:
      "Scan this QR code with the Self app to link your identity to this agent.",
    success: "Agent registered! Your identity is now linked.",
    openButton: "Open Self App to Register",
  },
  identify: {
    title: "Verify Your Identity",
    subtitle: "Scan this QR code with the Self app to prove you're human.",
    success: "Identity verified!",
    openButton: "Open Self App to Verify",
  },
  deregister: {
    title: "Confirm Deregistration",
    subtitle:
      "Scan this QR code to permanently remove this agent. This cannot be undone.",
    success: "Agent deregistered.",
    openButton: "Open Self App to Confirm",
  },
  refresh: {
    title: "Refresh Your Proof",
    subtitle: "Scan this QR code to renew your human verification.",
    success: "Proof refreshed!",
    openButton: "Open Self App to Refresh",
  },
};

interface PollResponse {
  stage?: string;
  sessionToken?: string;
}

interface Props {
  sessionToken: string;
  sessionType: SessionType;
  qrData: SelfApp;
  deepLink: string;
  expiresAt?: string;
}

export default function ScanClient({
  sessionToken: initialToken,
  sessionType,
  qrData,
  deepLink,
  expiresAt,
}: Props) {
  const [state, setState] = useState<ScanState>("scanning");
  const [isMobile, setIsMobile] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const tokenRef = useRef(initialToken);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Mobile detection
  useEffect(() => {
    setIsMobile(/iPhone|iPad|iPod|Android/i.test(navigator.userAgent));
  }, []);

  // Session expiry timer
  useEffect(() => {
    if (!expiresAt) return;
    const msUntilExpiry = new Date(expiresAt).getTime() - Date.now();
    if (msUntilExpiry <= 0) {
      setState("expired");
      return;
    }
    const t = setTimeout(() => setState("expired"), msUntilExpiry);
    return () => clearTimeout(t);
  }, [expiresAt]);

  // Polling: all status endpoints accept Authorization: Bearer <token>
  useEffect(() => {
    if (state !== "scanning") return;

    const statusUrl = `/api/agent/${sessionType}/status`;

    pollRef.current = setInterval(() => {
      void (async () => {
        try {
          const res = await fetch(statusUrl, {
            headers: { Authorization: `Bearer ${tokenRef.current}` },
          });

          if (res.status === 410) {
            clearInterval(pollRef.current!);
            setState("expired");
            return;
          }
          if (!res.ok) return;

          const data = (await res.json()) as PollResponse;

          // Track rotated session token
          if (data.sessionToken) tokenRef.current = data.sessionToken;

          if (data.stage === "completed") {
            clearInterval(pollRef.current!);
            pollRef.current = null;
            setState("success");
          }
        } catch {
          // silently retry on transient errors
        }
      })();
    }, 3000);

    return () => {
      if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
    };
  }, [state, sessionType]);

  const copy = COPY[sessionType] ?? COPY.register;

  // ── Terminal states ──────────────────────────────────────────────────────

  if (state === "expired") {
    return (
      <TerminalScreen
        icon="⏱"
        title="Session Expired"
        body="This QR code has expired. Please ask the agent to start a new session."
      />
    );
  }

  if (state === "success") {
    return (
      <TerminalScreen
        icon={
          <span className="flex items-center justify-center w-16 h-16 rounded-full bg-green-100 text-green-600 text-3xl mx-auto">
            ✓
          </span>
        }
        title={copy.success}
        body="You can now close this page."
        success
      />
    );
  }

  if (state === "error") {
    return (
      <TerminalScreen
        icon="⚠️"
        title="Scan Failed"
        body={errorMsg ?? "Something went wrong. Please try again."}
      />
    );
  }

  // ── Scanning state ───────────────────────────────────────────────────────

  const isDeregister = sessionType === "deregister";

  return (
    <div className="min-h-screen flex items-center justify-center p-5">
      <div className="w-full max-w-sm space-y-5">
        {/* Header */}
        <div className="text-center space-y-2">
          <div className="flex items-center justify-center gap-2 mb-1">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="https://i.postimg.cc/mrmVf9hm/self.png"
              alt="Self"
              className="w-7 h-7 rounded-md"
            />
            <span className="text-sm font-semibold text-gray-500 tracking-wide uppercase">
              Self Agent ID
            </span>
          </div>
          <h1 className="text-2xl font-bold text-gray-900">{copy.title}</h1>
          <p
            className={`text-sm leading-relaxed ${
              isDeregister ? "text-red-600 font-medium" : "text-gray-500"
            }`}
          >
            {copy.subtitle}
          </p>
        </div>

        {/* Main card */}
        <div
          className={`rounded-2xl border bg-white shadow-sm overflow-hidden ${
            isDeregister ? "border-red-200" : "border-gray-200"
          }`}
        >
          <div className="p-6 space-y-5">
            {isMobile ? (
              // Mobile: big button first, small QR as fallback
              <>
                <a
                  href={deepLink}
                  className="block w-full text-center font-semibold py-4 rounded-xl text-base text-white bg-gradient-to-r from-indigo-500 to-sky-500 active:opacity-80 transition-opacity"
                >
                  {copy.openButton}
                </a>
                <Divider label="or scan with another device" />
                <div className="flex justify-center">
                  <div className="rounded-xl overflow-hidden border border-gray-100 p-2 bg-white">
                    <SelfQRcodeWrapper
                      selfApp={qrData}
                      size={160}
                      onSuccess={() => {}}
                      onError={(d: {
                        reason?: string;
                        error_code?: string;
                      }) => {
                        setErrorMsg(d.reason ?? d.error_code ?? null);
                        setState("error");
                      }}
                    />
                  </div>
                </div>
              </>
            ) : (
              // Desktop: big QR first, button as fallback for mobile handoff
              <>
                <div className="flex justify-center">
                  <div className="rounded-xl overflow-hidden border border-gray-100 p-3 bg-white shadow-sm">
                    <SelfQRcodeWrapper
                      selfApp={qrData}
                      size={240}
                      onSuccess={() => {}}
                      onError={(d: {
                        reason?: string;
                        error_code?: string;
                      }) => {
                        setErrorMsg(d.reason ?? d.error_code ?? null);
                        setState("error");
                      }}
                    />
                  </div>
                </div>
                <Divider label="or open on your phone" />
                <a
                  href={deepLink}
                  className={`block w-full text-center font-medium py-3 rounded-xl text-sm transition-colors ${
                    isDeregister
                      ? "border border-red-200 bg-red-50 text-red-700 hover:bg-red-100"
                      : "border border-indigo-200 bg-indigo-50 text-indigo-700 hover:bg-indigo-100"
                  }`}
                >
                  {copy.openButton}
                </a>
              </>
            )}
          </div>
        </div>

        {/* Waiting indicator */}
        <div className="flex items-center justify-center gap-2 text-sm text-gray-400">
          <span className="inline-block w-2 h-2 rounded-full bg-indigo-400 animate-pulse" />
          Waiting for scan…
        </div>
      </div>
    </div>
  );
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function Divider({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-3 text-xs text-gray-400">
      <div className="flex-1 h-px bg-gray-200" />
      {label}
      <div className="flex-1 h-px bg-gray-200" />
    </div>
  );
}

function TerminalScreen({
  icon,
  title,
  body,
  success = false,
}: {
  icon: React.ReactNode;
  title: string;
  body: string;
  success?: boolean;
}) {
  return (
    <div className="min-h-screen flex items-center justify-center p-6">
      <div className="max-w-sm w-full text-center space-y-4">
        {typeof icon === "string" ? (
          <div className="text-5xl mb-2">{icon}</div>
        ) : (
          <div className="mb-2">{icon}</div>
        )}
        <h1
          className={`text-xl font-semibold ${success ? "text-green-700" : "text-gray-900"}`}
        >
          {title}
        </h1>
        <p className="text-gray-500 text-sm">{body}</p>
      </div>
    </div>
  );
}
