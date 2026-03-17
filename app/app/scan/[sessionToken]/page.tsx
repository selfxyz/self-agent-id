// SPDX-FileCopyrightText: 2025-2026 Social Connect Labs, Inc.
// SPDX-License-Identifier: BUSL-1.1
// NOTE: Converts to Apache-2.0 on 2029-06-11 per LICENSE.

// /scan/[sessionToken] — Hosted QR scan page
//
// Server component: decrypts the session token, extracts QR data and the
// deep link, then hands off to the client component for rendering and polling.
//
// This page is the single URL an AI agent shares with a human to complete
// any Self Protocol flow (register, identify, deregister, refresh).
// No app install, no wallet, no SDK required — just open the link.

import type { Metadata } from "next";
import { getUniversalLink } from "@selfxyz/qrcode";
import type { SelfApp } from "@selfxyz/qrcode";
import { decryptAndValidateSession } from "@/lib/agent-api-helpers";
import ScanClient from "./ScanClient";

export const metadata: Metadata = {
  title: "Scan to Verify — Self Agent ID",
  description: "Scan this QR code with the Self app to verify your identity.",
};

export default async function ScanPage({
  params,
}: {
  params: Promise<{ sessionToken: string }>;
}) {
  const { sessionToken } = await params;

  let qrData: SelfApp;
  let deepLink: string;
  let sessionType: string;
  let expiresAt: string | undefined;

  try {
    const { session } = decryptAndValidateSession(sessionToken);
    qrData = session.qrData as SelfApp;
    deepLink = getUniversalLink(qrData);
    sessionType = session.type;
    expiresAt = session.expiresAt;

    if (!qrData) throw new Error("No QR data");
  } catch (err) {
    const expired = err instanceof Error && err.message.includes("expired");

    return (
      <div className="min-h-screen flex items-center justify-center p-6">
        <div className="max-w-sm w-full text-center space-y-4">
          <div className="text-5xl mb-2">{expired ? "⏱" : "⚠️"}</div>
          <h1 className="text-xl font-semibold text-gray-900">
            {expired ? "Session Expired" : "Invalid Link"}
          </h1>
          <p className="text-gray-500 text-sm">
            {expired
              ? "This QR code has expired. Please ask the agent to start a new session."
              : "This link is invalid or has already been used."}
          </p>
        </div>
      </div>
    );
  }

  return (
    <ScanClient
      sessionToken={sessionToken}
      sessionType={
        sessionType as "register" | "identify" | "deregister" | "refresh"
      }
      qrData={qrData}
      deepLink={deepLink}
      expiresAt={expiresAt}
    />
  );
}
