// SPDX-FileCopyrightText: 2025-2026 Social Connect Labs, Inc.
// SPDX-License-Identifier: BUSL-1.1
// NOTE: Converts to Apache-2.0 on 2029-06-11 per LICENSE.

"use client";

import React, { useState, useEffect } from "react";
import Link from "next/link";
import { Loader2, ArrowLeft, Copy, Check } from "lucide-react";
import { useNetwork } from "@/lib/NetworkContext";
import { Card } from "@/components/Card";
import { Badge } from "@/components/Badge";
import { VisaCard } from "@/components/VisaCard";

interface AgentInfo {
  agentId: number;
  chainId: number;
  agentKey: string;
  agentAddress: string;
  isVerified: boolean;
  proofProvider: string;
  verificationStrength: number;
  strengthLabel: string;
  credentials: {
    nationality: string;
    olderThan: number;
    ofac: boolean[];
  };
  registeredAt: number;
  network: string;
}

function truncateAddress(address: string): string {
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

function formatDate(timestamp: number): string {
  if (!timestamp) return "Unknown";
  const date = new Date(timestamp * 1000);
  return date.toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function CopyableAddress({ address }: { address: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    void navigator.clipboard.writeText(address);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <button
      onClick={handleCopy}
      className="inline-flex items-center gap-1.5 font-mono text-sm hover:text-accent transition-colors"
    >
      {truncateAddress(address)}
      {copied ? (
        <Check className="w-3.5 h-3.5 text-accent-success" />
      ) : (
        <Copy className="w-3.5 h-3.5 text-muted" />
      )}
    </button>
  );
}

export default function AgentDetailPage({
  params,
}: {
  params: { agentId: string };
}) {
  const { agentId } = params;
  const { network } = useNetwork();
  const chainId = network.chainId;

  const [agent, setAgent] = useState<AgentInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError(null);

      try {
        const res = await fetch(`/api/agent/info/${chainId}/${agentId}`);

        if (!res.ok) {
          if (res.status === 404) {
            setError("not_found");
          } else {
            setError("network");
          }
          return;
        }

        const data = (await res.json()) as AgentInfo;
        if (!cancelled) setAgent(data);
      } catch {
        if (!cancelled) setError("network");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [chainId, agentId]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24">
        <Loader2 className="w-6 h-6 animate-spin text-muted" />
      </div>
    );
  }

  if (error === "not_found") {
    return (
      <div className="max-w-2xl mx-auto space-y-6">
        <Link
          href="/agents"
          className="inline-flex items-center gap-1.5 text-sm text-muted hover:text-foreground transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          Back to Agents
        </Link>
        <Card>
          <p className="text-sm text-muted">
            Agent not found. The agent ID may be invalid or does not exist on
            this network.
          </p>
        </Card>
      </div>
    );
  }

  if (error === "network" || !agent) {
    return (
      <div className="max-w-2xl mx-auto space-y-6">
        <Link
          href="/agents"
          className="inline-flex items-center gap-1.5 text-sm text-muted hover:text-foreground transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          Back to Agents
        </Link>
        <Card>
          <p className="text-sm text-muted">
            Failed to load agent. Please check your connection and try again.
          </p>
        </Card>
      </div>
    );
  }

  const nationality = agent.credentials?.nationality
    ?.replace(/[\x00-\x1f]/g, "")
    .trim();

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      {/* Back link */}
      <Link
        href="/agents"
        className="inline-flex items-center gap-1.5 text-sm text-muted hover:text-foreground transition-colors"
      >
        <ArrowLeft className="w-4 h-4" />
        Back to Agents
      </Link>

      {/* Header */}
      <div className="space-y-3">
        <h1 className="text-2xl font-bold">Agent #{agent.agentId}</h1>
        <div className="flex items-center gap-2 flex-wrap">
          <Badge variant={agent.isVerified ? "success" : "error"}>
            {agent.isVerified ? "Verified" : "Unverified"}
          </Badge>
          <Badge variant="muted">
            {agent.network === "mainnet" ? "Mainnet" : "Testnet"}
          </Badge>
        </div>
      </div>

      {/* Agent Details */}
      <Card>
        <div className="space-y-4">
          <h3 className="text-sm font-semibold">Agent Details</h3>

          <div className="grid gap-3">
            <div className="flex items-center justify-between">
              <span className="text-xs text-muted">Address</span>
              <CopyableAddress address={agent.agentAddress} />
            </div>

            <div className="flex items-center justify-between">
              <span className="text-xs text-muted">Registered</span>
              <span className="text-sm">{formatDate(agent.registeredAt)}</span>
            </div>

            {nationality && (
              <div className="flex items-center justify-between">
                <span className="text-xs text-muted">Nationality</span>
                <span className="text-sm">{nationality}</span>
              </div>
            )}

            <div className="flex items-center justify-between">
              <span className="text-xs text-muted">Verification</span>
              <span className="text-sm">
                {agent.verificationStrength > 0
                  ? `Level ${agent.verificationStrength}`
                  : "None"}
              </span>
            </div>
          </div>
        </div>
      </Card>

      {/* Celo Agent Visa */}
      <div className="space-y-2">
        <h3 className="text-sm font-semibold">Celo Agent Visa</h3>
        <VisaCard
          agentId={agent.agentId}
          chainId={chainId}
          blockExplorer={network.blockExplorer}
        />
      </div>
    </div>
  );
}
