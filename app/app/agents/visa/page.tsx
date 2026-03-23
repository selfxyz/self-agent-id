"use client";

import { useEffect, useState, useCallback } from "react";
import { ethers } from "ethers";
import { VisaCard } from "@/components/VisaCard";
import { REGISTRY_ABI } from "@/lib/constants";
import { CHAIN_CONFIG } from "@/lib/chain-config";
import { ExternalLink, Loader2 } from "lucide-react";
import Link from "next/link";

interface AgentBasic {
  agentId: number;
  chainId: number;
}

export default function CeloAgentVisaPage() {
  const [agents, setAgents] = useState<AgentBasic[]>([]);
  const [loading, setLoading] = useState(true);
  const [walletAddress, setWalletAddress] = useState<string | null>(null);

  const loadAgents = useCallback(async (address: string) => {
    setLoading(true);
    try {
      const chainsWithVisa = Object.entries(CHAIN_CONFIG).filter(
        ([, config]) => config.visa,
      );

      const allAgents: AgentBasic[] = [];

      for (const [chainId, config] of chainsWithVisa) {
        try {
          const provider = new ethers.JsonRpcProvider(config.rpc);
          const registry = new ethers.Contract(
            config.registry,
            REGISTRY_ABI,
            provider,
          );

          // Query mint events (Transfer from zero address) for this owner
          const filter = registry.filters.Transfer(ethers.ZeroAddress, address);
          const events = await registry.queryFilter(
            filter,
            config.registryDeployBlock,
          );
          for (const event of events) {
            const tokenId = Number((event as ethers.EventLog).args?.[2]);
            if (tokenId > 0) {
              allAgents.push({ agentId: tokenId, chainId: Number(chainId) });
            }
          }
        } catch {
          // Skip chains that error
        }
      }

      setAgents(allAgents);
    } catch {
      setAgents([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    async function connect() {
      if (typeof window === "undefined" || !window.ethereum) {
        setLoading(false);
        return;
      }
      try {
        const eth = window.ethereum as unknown as {
          request: (args: { method: string }) => Promise<string[]>;
        };
        const accounts = await eth.request({ method: "eth_accounts" });
        if (accounts.length > 0) {
          setWalletAddress(accounts[0]);
          await loadAgents(accounts[0]);
        } else {
          setLoading(false);
        }
      } catch {
        setLoading(false);
      }
    }
    void connect();
  }, [loadAgents]);

  async function handleConnect() {
    if (!window.ethereum) return;
    try {
      const eth = window.ethereum as unknown as {
        request: (args: { method: string }) => Promise<string[]>;
      };
      const accounts = await eth.request({ method: "eth_requestAccounts" });
      if (accounts.length > 0) {
        setWalletAddress(accounts[0]);
        await loadAgents(accounts[0]);
      }
    } catch {
      // user rejected
    }
  }

  return (
    <div className="max-w-2xl mx-auto">
      {/* Header */}
      <div className="text-center mb-10">
        <h1 className="text-3xl font-bold tracking-tight mb-3">
          Celo Agent Visa
        </h1>
        <p className="text-muted max-w-lg mx-auto">
          The Agent Visa is a tiered program for AI agents that transact on
          Celo. Start as a Tourist, scale to a Work Visa. Level up to Citizen
          with every transaction.
        </p>
        {/* TODO: Replace with actual Celo Agent Visa website URL */}
        <span className="inline-flex items-center gap-1 text-sm text-muted mt-3 cursor-default">
          Learn more
          <ExternalLink className="h-3 w-3" />
        </span>
      </div>

      {/* Connected wallet */}
      {walletAddress && (
        <p className="text-xs text-muted text-center mb-6 font-mono">
          Connected: {walletAddress.slice(0, 6)}...{walletAddress.slice(-4)}
        </p>
      )}

      {/* Agent Visa List */}
      {!walletAddress ? (
        <div className="text-center py-12">
          <p className="text-muted mb-4">
            Connect your wallet to see your agents&apos; visa status
          </p>
          <button
            onClick={() => void handleConnect()}
            className="px-4 py-2 bg-foreground text-background rounded-lg text-sm font-medium hover:opacity-90 transition-opacity"
          >
            Connect Wallet
          </button>
        </div>
      ) : loading ? (
        <div className="flex items-center justify-center gap-2 py-12 text-muted">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading your agents...
        </div>
      ) : agents.length === 0 ? (
        <div className="text-center py-12">
          <p className="text-muted mb-4">
            No agents found. Register an agent to get started.
          </p>
          <Link
            href="/agents/register"
            className="text-sm text-accent hover:underline"
          >
            Register an agent
          </Link>
        </div>
      ) : (
        <div className="space-y-4">
          <h2 className="text-lg font-semibold">Your Agents</h2>
          {agents.map((agent) => (
            <div key={`${agent.chainId}-${agent.agentId}`}>
              <p className="text-xs text-muted mb-1.5">
                Agent #{agent.agentId}
              </p>
              <VisaCard
                agentId={agent.agentId}
                chainId={agent.chainId}
                blockExplorer={
                  CHAIN_CONFIG[String(agent.chainId)]?.blockExplorer
                }
              />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
