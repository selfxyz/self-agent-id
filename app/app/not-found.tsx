// SPDX-FileCopyrightText: 2025-2026 Social Connect Labs, Inc.
// SPDX-License-Identifier: BUSL-1.1
// NOTE: Converts to Apache-2.0 on 2029-06-11 per LICENSE.

import Link from "next/link";
import { Button } from "@/components/Button";

export default function NotFound() {
  return (
    <main className="min-h-[60vh] flex items-center justify-center px-6">
      <div className="text-center max-w-md">
        <h1 className="text-4xl font-bold text-foreground mb-2">404</h1>
        <p className="text-muted mb-6">
          This page doesn&apos;t exist. Here are some useful links:
        </p>

        <div className="flex flex-col sm:flex-row gap-3 justify-center mb-8">
          <Link href="/agents/register">
            <Button as="span" variant="primary" size="sm">
              Register Agent
            </Button>
          </Link>
          <Link href="/agents">
            <Button as="span" variant="secondary" size="sm">
              My Agents
            </Button>
          </Link>
          <Link href="/">
            <Button as="span" variant="secondary" size="sm">
              Home
            </Button>
          </Link>
        </div>

        {/* Machine-readable discovery hints (visually subtle) */}
        <p className="text-xs text-subtle">
          Developers:{" "}
          <Link
            href="/api-docs"
            className="text-accent hover:text-accent-2 underline underline-offset-2"
          >
            API Docs
          </Link>
          {" · "}
          <Link
            href="/llms.txt"
            className="text-accent hover:text-accent-2 underline underline-offset-2"
          >
            llms.txt
          </Link>
          {" · "}
          <Link
            href="/api/agent/bootstrap"
            className="text-accent hover:text-accent-2 underline underline-offset-2"
          >
            Bootstrap API
          </Link>
        </p>
      </div>
    </main>
  );
}
