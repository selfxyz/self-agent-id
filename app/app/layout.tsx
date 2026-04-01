// SPDX-FileCopyrightText: 2025-2026 Social Connect Labs, Inc.
// SPDX-License-Identifier: BUSL-1.1
// NOTE: Converts to Apache-2.0 on 2029-06-11 per LICENSE.

import type { Metadata } from "next";
import localFont from "next/font/local";
import "./globals.css";
import { Navbar } from "@/components/Navbar";
import { Footer } from "@/components/Footer";
import { NetworkBanner } from "@/components/NetworkBanner";
import { ClientProviders } from "@/components/ClientProviders";
import { Analytics } from "@vercel/analytics/react";
import { getJsonLd } from "@/lib/agent-discovery";

const geist = localFont({
  src: "./fonts/GeistVF.woff",
  variable: "--font-geist",
});

const geistMono = localFont({
  src: "./fonts/GeistMonoVF.woff",
  variable: "--font-geist-mono",
});

export const metadata: Metadata = {
  title: "Self Agent ID",
  description: "Register AI agents with proof-of-human via Self Protocol",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <head>
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(getJsonLd()) }}
        />
        <meta
          name="agent-registration"
          content={`${process.env.NEXT_PUBLIC_APP_URL || "https://app.ai.self.xyz"}/api/agent/bootstrap`}
        />
        <link
          rel="agent-api"
          href="/api/agent/bootstrap"
          type="application/json"
        />
        <link
          rel="agent-card"
          href="/.well-known/agent-card.json"
          type="application/json"
        />
        <link rel="llms-txt" href="/llms.txt" type="text/plain" />
      </head>
      <body className={`${geist.variable} ${geistMono.variable} antialiased`}>
        <ClientProviders>
          <Navbar />
          <NetworkBanner />
          {children}
          <Footer />
          <Analytics />
        </ClientProviders>
      </body>
    </html>
  );
}
