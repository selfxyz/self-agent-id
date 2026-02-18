"use client";

import React, { useState } from "react";
import Link from "next/link";
import { ethers } from "ethers";
import { Wallet, RefreshCw, Cpu } from "lucide-react";
import { connectWallet } from "@/lib/wallet";
import { REGISTRY_ADDRESS, REGISTRY_ABI, RPC_URL } from "@/lib/constants";
import { Card } from "@/components/Card";
import { Badge } from "@/components/Badge";
import { Button } from "@/components/Button";
import { StatusDot } from "@/components/StatusDot";

interface AgentEntry {
  agentId: bigint;
  agentKey: string;
  agentAddress: string;
  isVerified: boolean;
  registeredAt: bigint;
  isSimpleMode: boolean;
}

export default function MyAgentsPage() {
  const [walletAddress, setWalletAddress] = useState<string | null>(null);
  const [agents, setAgents] = useState<AgentEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const handleConnect = async () => {
    setError("");
    const address = await connectWallet();
    if (!address) return;
    setWalletAddress(address);
    await loadAgents(address);
  };

  const loadAgents = async (ownerAddress: string) => {
    setLoading(true);
    setError("");
    setAgents([]);

    try {
      const provider = new ethers.JsonRpcProvider(RPC_URL);
      const registry = new ethers.Contract(
        REGISTRY_ADDRESS,
        REGISTRY_ABI,
        provider
      );

      // Query Transfer events where `to` is the connected wallet (mints)
      const mintFilter = registry.filters.Transfer(null, ownerAddress);
      const mintEvents = await registry.queryFilter(mintFilter, 0, "latest");

      const results: AgentEntry[] = [];

      for (const event of mintEvents) {
        const log = event as ethers.EventLog;
        const agentId = log.args[2] as bigint;

        try {
          // Check if this agent is still owned by the wallet (not burned/transferred)
          const currentOwner: string = await registry.ownerOf(agentId);
          if (currentOwner.toLowerCase() !== ownerAddress.toLowerCase()) continue;

          const agentKey: string = await registry.agentIdToPubkey(agentId);
          const isVerified: boolean = await registry.isVerifiedAgent(agentKey);
          const registeredAt: bigint = await registry.agentRegisteredAt(agentId);

          // Extract address from bytes32 key (last 20 bytes)
          const agentAddress = "0x" + agentKey.slice(26);
          const isSimpleMode =
            agentAddress.toLowerCase() === ownerAddress.toLowerCase();

          results.push({
            agentId,
            agentKey,
            agentAddress,
            isVerified,
            registeredAt,
            isSimpleMode,
          });
        } catch {
          // Token was burned — skip
        }
      }

      setAgents(results);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to load agents"
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="min-h-screen max-w-lg mx-auto px-6 pt-24 pb-12">
      <h1 className="text-3xl font-bold text-center mb-2">
        My <span className="text-gradient">Agents</span>
      </h1>
      <p className="text-muted text-center mb-8">
        Connect your wallet to see all agents registered to your address.
      </p>

      {!walletAddress ? (
        <div className="flex flex-col items-center gap-4">
          <Wallet size={32} className="text-muted" />
          <Button onClick={handleConnect} variant="primary" size="lg">
            <Wallet size={18} />
            Connect Wallet
          </Button>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <p className="text-sm text-muted">
              Connected:{" "}
              <span className="font-mono text-foreground">
                {walletAddress.slice(0, 6)}...{walletAddress.slice(-4)}
              </span>
            </p>
            <button
              onClick={() => loadAgents(walletAddress)}
              disabled={loading}
              className="p-2 text-muted hover:text-foreground hover:bg-surface-2 rounded-lg transition-colors disabled:opacity-50"
              title="Refresh"
            >
              <RefreshCw size={16} className={loading ? "animate-spin" : ""} />
            </button>
          </div>

          {error && (
            <p className="text-sm text-accent-error">{error}</p>
          )}

          {loading && (
            <div className="flex flex-col items-center py-8 gap-3">
              <div className="w-8 h-8 border-2 border-border border-t-accent rounded-full animate-spin" />
              <p className="text-muted text-sm">Scanning for agents...</p>
            </div>
          )}

          {!loading && agents.length === 0 && walletAddress && (
            <Card className="text-center py-8">
              <Cpu size={32} className="text-muted mx-auto mb-3" />
              <p className="text-muted mb-4">No agents found for this wallet.</p>
              <Link href="/register">
                <Button variant="primary">Register an Agent</Button>
              </Link>
            </Card>
          )}

          {agents.map((agent) => (
            <Link
              key={agent.agentId.toString()}
              href={`/verify?key=${encodeURIComponent(agent.agentKey)}`}
              className="block"
            >
              <Card glow>
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <StatusDot status={agent.isVerified ? "verified" : "revoked"} />
                    <span className="font-medium">
                      Agent #{agent.agentId.toString()}
                    </span>
                    <Badge variant={agent.isSimpleMode ? "muted" : "success"}>
                      {agent.isSimpleMode ? "Verified Wallet" : "Agent Identity"}
                    </Badge>
                  </div>
                  <Badge variant={agent.isVerified ? "success" : "error"}>
                    {agent.isVerified ? "Verified" : "Revoked"}
                  </Badge>
                </div>

                <div className="space-y-1">
                  <p className="text-xs text-muted">
                    {agent.isSimpleMode ? "Wallet" : "Agent"} Address
                  </p>
                  <p className="font-mono text-sm break-all">
                    {agent.agentAddress}
                  </p>
                </div>

                {agent.registeredAt > 0n && (
                  <p className="text-xs text-subtle mt-2">
                    Registered at block {agent.registeredAt.toString()}
                  </p>
                )}
              </Card>
            </Link>
          ))}
        </div>
      )}
    </main>
  );
}
