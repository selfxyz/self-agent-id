// SPDX-FileCopyrightText: 2025-2026 Social Connect Labs, Inc.
// SPDX-License-Identifier: BUSL-1.1
// NOTE: Converts to Apache-2.0 on 2029-06-11 per LICENSE.

"use client";

import { ExternalLink } from "lucide-react";
import { useNetwork } from "@/lib/NetworkContext";

export function Footer() {
  const { network } = useNetwork();

  const blockscoutUrl = `${network.blockExplorer}/address/${network.registryAddress}`;

  return (
    <footer className="border-t border-border bg-surface-1 py-8 px-6">
      <div className="max-w-6xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-4 text-sm text-muted">
        <div className="flex items-center gap-2">
          <span>Built on</span>
          <a
            href="https://self.xyz"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1.5 hover:text-foreground transition-colors"
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/self-icon.png" alt="Self" width={20} height={20} className="rounded" />
            <span>Self Protocol</span>
            <ExternalLink size={10} />
          </a>
          <span>+</span>
          <a
            href="https://celo.org"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1 hover:text-foreground transition-colors"
          >
            <span>Celo</span>
            <ExternalLink size={10} />
          </a>
        </div>
        <div className="flex items-center gap-4">
          <a
            href="https://github.com/selfxyz/self-agent-id"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1 hover:text-foreground transition-colors"
          >
            <span>GitHub</span>
            <ExternalLink size={10} />
          </a>
          <a
            href="https://www.npmjs.com/package/@selfxyz/mcp-server"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1 hover:text-foreground transition-colors"
          >
            <span>MCP Server</span>
            <ExternalLink size={10} />
          </a>
        </div>
        <a
          href={blockscoutUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-1.5 hover:text-foreground transition-colors"
        >
          <span className="font-mono text-xs">
            {network.registryAddress
              ? `${network.registryAddress.slice(0, 6)}...${network.registryAddress.slice(-4)}`
              : "Not deployed"}
          </span>
          {network.isTestnet && (
            <span className="text-xs text-amber-600">(testnet)</span>
          )}
          <ExternalLink size={12} />
        </a>
      </div>
    </footer>
  );
}
