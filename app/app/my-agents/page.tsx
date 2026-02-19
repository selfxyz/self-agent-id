"use client";

import React, { useState } from "react";
import Link from "next/link";
import { ethers } from "ethers";
import { Wallet, RefreshCw, Cpu, Shield, FileText, Search, Key } from "lucide-react";
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
  mode: "simple" | "advanced" | "walletfree";
  guardian: string;
  hasMetadata: boolean;
}

export default function MyAgentsPage() {
  const [walletAddress, setWalletAddress] = useState<string | null>(null);
  const [agents, setAgents] = useState<AgentEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [lookupMode, setLookupMode] = useState<"wallet" | "key">("wallet");
  const [agentKeyInput, setAgentKeyInput] = useState("");

  const handleConnect = async () => {
    setError("");
    const address = await connectWallet();
    if (!address) return;
    setWalletAddress(address);
    await loadAgentsByOwner(address);
  };

  const handleKeyLookup = async () => {
    setError("");
    const input = agentKeyInput.trim();
    if (!input) return;

    // Accept either a 0x address (20 bytes) or a full bytes32 key
    let agentKey: string;
    if (input.length === 42) {
      // Convert address to bytes32 (zero-padded)
      agentKey = "0x" + "0".repeat(24) + input.slice(2).toLowerCase();
    } else if (input.length === 66) {
      agentKey = input.toLowerCase();
    } else {
      setError("Enter a valid agent address (0x...) or bytes32 key.");
      return;
    }

    setLoading(true);
    setAgents([]);

    try {
      const provider = new ethers.JsonRpcProvider(RPC_URL);
      const registry = new ethers.Contract(REGISTRY_ADDRESS, REGISTRY_ABI, provider);

      const agentId: bigint = await registry.getAgentId(agentKey);
      if (agentId === 0n) {
        setError("No agent found for this key.");
        setLoading(false);
        return;
      }

      const currentOwner: string = await registry.ownerOf(agentId);
      const isVerified: boolean = await registry.isVerifiedAgent(agentKey);
      const registeredAt: bigint = await registry.agentRegisteredAt(agentId);

      let guardian = ethers.ZeroAddress;
      let hasMetadata = false;
      try {
        guardian = await registry.agentGuardian(agentId);
        const metadata: string = await registry.getAgentMetadata(agentId);
        hasMetadata = metadata.length > 0;
      } catch {
        // V3 contract without guardian/metadata
      }

      const agentAddress = "0x" + agentKey.slice(26);

      let mode: "simple" | "advanced" | "walletfree" = "advanced";
      if (agentAddress.toLowerCase() === currentOwner.toLowerCase()) {
        mode = guardian !== ethers.ZeroAddress ? "walletfree" : "simple";
      }

      setAgents([{
        agentId,
        agentKey,
        agentAddress,
        isVerified,
        registeredAt,
        mode,
        guardian,
        hasMetadata,
      }]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to look up agent");
    } finally {
      setLoading(false);
    }
  };

  const loadAgentsByOwner = async (ownerAddress: string) => {
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

          // Fetch V4 fields (guardian, metadata)
          let guardian = ethers.ZeroAddress;
          let hasMetadata = false;
          try {
            guardian = await registry.agentGuardian(agentId);
            const metadata: string = await registry.getAgentMetadata(agentId);
            hasMetadata = metadata.length > 0;
          } catch {
            // V3 contract without guardian/metadata — ignore
          }

          // Extract address from bytes32 key (last 20 bytes)
          const agentAddress = "0x" + agentKey.slice(26);

          // Detect mode
          let mode: "simple" | "advanced" | "walletfree" = "advanced";
          if (agentAddress.toLowerCase() === ownerAddress.toLowerCase()) {
            mode = guardian !== ethers.ZeroAddress ? "walletfree" : "simple";
          }

          results.push({
            agentId,
            agentKey,
            agentAddress,
            isVerified,
            registeredAt,
            mode,
            guardian,
            hasMetadata,
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
        View agents registered to your wallet, or look up an agent by its key.
      </p>

      {/* Mode toggle */}
      <div className="flex justify-center gap-2 mb-6">
        <button
          onClick={() => { setLookupMode("wallet"); setAgents([]); setError(""); }}
          className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
            lookupMode === "wallet"
              ? "bg-surface-2 border border-accent text-foreground"
              : "bg-surface-1 border border-border text-muted hover:text-foreground"
          }`}
        >
          <Wallet size={16} />
          Connect Wallet
        </button>
        <button
          onClick={() => { setLookupMode("key"); setAgents([]); setError(""); }}
          className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
            lookupMode === "key"
              ? "bg-surface-2 border border-accent text-foreground"
              : "bg-surface-1 border border-border text-muted hover:text-foreground"
          }`}
        >
          <Key size={16} />
          Look Up by Key
        </button>
      </div>

      {lookupMode === "wallet" ? (
        /* ── Wallet mode ── */
        !walletAddress ? (
          <div className="flex flex-col items-center gap-4">
            <Wallet size={32} className="text-muted" />
            <Button onClick={handleConnect} variant="primary" size="lg">
              <Wallet size={18} />
              Connect Wallet
            </Button>
            <p className="text-xs text-subtle text-center max-w-xs">
              Shows all agents where your wallet is the NFT owner.
            </p>
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
                onClick={() => loadAgentsByOwner(walletAddress)}
                disabled={loading}
                className="p-2 text-muted hover:text-foreground hover:bg-surface-2 rounded-lg transition-colors disabled:opacity-50"
                title="Refresh"
              >
                <RefreshCw size={16} className={loading ? "animate-spin" : ""} />
              </button>
            </div>

            {error && <p className="text-sm text-accent-error">{error}</p>}

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

            {renderAgentCards(agents)}
          </div>
        )
      ) : (
        /* ── Key lookup mode ── */
        <div className="space-y-4">
          <Card>
            <p className="text-sm text-muted mb-3">
              Enter your agent address to look it up on the registry. This is useful
              if you registered without a wallet (wallet-free mode).
            </p>
            <div className="flex gap-2">
              <input
                type="text"
                value={agentKeyInput}
                onChange={(e) => setAgentKeyInput(e.target.value)}
                placeholder="0x... (agent address)"
                className="flex-1 bg-surface-2 border border-border rounded-lg px-3 py-2 text-sm font-mono placeholder:text-subtle focus:border-accent focus:outline-none transition-colors"
                onKeyDown={(e) => e.key === "Enter" && handleKeyLookup()}
              />
              <Button onClick={handleKeyLookup} variant="primary" size="sm" disabled={loading}>
                <Search size={14} />
                Look Up
              </Button>
            </div>
          </Card>

          {error && <p className="text-sm text-accent-error">{error}</p>}

          {loading && (
            <div className="flex flex-col items-center py-8 gap-3">
              <div className="w-8 h-8 border-2 border-border border-t-accent rounded-full animate-spin" />
              <p className="text-muted text-sm">Looking up agent...</p>
            </div>
          )}

          {!loading && agents.length === 0 && agentKeyInput && !error && (
            <Card className="text-center py-8">
              <Search size={32} className="text-muted mx-auto mb-3" />
              <p className="text-muted">Enter an agent address and click Look Up.</p>
            </Card>
          )}

          {renderAgentCards(agents)}
        </div>
      )}
    </main>
  );
}

function renderAgentCards(agents: AgentEntry[]) {
  return agents.map((agent) => (
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
            <Badge variant={
              agent.mode === "simple" ? "muted" :
              agent.mode === "advanced" ? "success" : "info"
            }>
              {agent.mode === "simple" ? "Verified Wallet" :
               agent.mode === "advanced" ? "Agent Identity" :
               "Wallet-Free"}
            </Badge>
          </div>
          <Badge variant={agent.isVerified ? "success" : "error"}>
            {agent.isVerified ? "Verified" : "Revoked"}
          </Badge>
        </div>

        <div className="space-y-1">
          <p className="text-xs text-muted">
            {agent.mode === "simple" ? "Wallet" : "Agent"} Address
          </p>
          <p className="font-mono text-sm break-all">
            {agent.agentAddress}
          </p>
        </div>

        <div className="flex items-center gap-3 mt-2">
          {agent.guardian !== ethers.ZeroAddress && (
            <span className="flex items-center gap-1 text-xs text-muted">
              <Shield size={12} /> Guardian
            </span>
          )}
          {agent.hasMetadata && (
            <span className="flex items-center gap-1 text-xs text-muted">
              <FileText size={12} /> Metadata
            </span>
          )}
          {agent.registeredAt > 0n && (
            <span className="text-xs text-subtle ml-auto">
              Block {agent.registeredAt.toString()}
            </span>
          )}
        </div>
      </Card>
    </Link>
  ));
}
