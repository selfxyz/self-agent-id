"use client";

import { useEffect, useState, useCallback } from "react";
import { ethers } from "ethers";
import { VisaCard } from "@/components/VisaCard";
import { REGISTRY_ABI, VISA_ABI } from "@/lib/constants";
import { CHAIN_CONFIG } from "@/lib/chain-config";
import { ExternalLink, Loader2 } from "lucide-react";

interface AgentBasic {
  agentId: string;
  chainId: number;
  isWalletBased?: boolean;
}

/** Derive a deterministic agentId from a wallet address (for Tourist visa without registry) */
function walletToAgentId(address: string): string {
  return BigInt(address).toString();
}

export default function CeloAgentVisaPage() {
  const [agents, setAgents] = useState<AgentBasic[]>([]);
  const [loading, setLoading] = useState(true);
  const [walletAddress, setWalletAddress] = useState<string | null>(null);
  const [claimingTourist, setClaimingTourist] = useState(false);
  const [claimError, setClaimError] = useState<string | null>(null);
  const [, setWalletVisaTier] = useState<number | null>(null);
  const [agentWalletInput, setAgentWalletInput] = useState("");

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
            const tokenId = (event as ethers.EventLog).args?.[2] as
              | bigint
              | undefined;
            if (tokenId && BigInt(tokenId) > 0n) {
              allAgents.push({
                agentId: BigInt(tokenId).toString(),
                chainId: Number(chainId),
              });
            }
          }
        } catch {
          // Skip chains that error
        }
      }

      // Also check for wallet-based Tourist visa (no registry needed)
      const walletAgentId = walletToAgentId(address);
      for (const [chainId, config] of chainsWithVisa) {
        try {
          const provider = new ethers.JsonRpcProvider(config.rpc);
          const visa = new ethers.Contract(config.visa, VISA_ABI, provider);
          const tier = Number(await visa.getTier(BigInt(walletAgentId)));
          if (tier > 0) {
            setWalletVisaTier(tier);
            const exists = allAgents.some(
              (a) =>
                a.agentId === walletAgentId && a.chainId === Number(chainId),
            );
            if (!exists) {
              allAgents.push({
                agentId: walletAgentId,
                chainId: Number(chainId),
                isWalletBased: true,
              });
            }
          } else {
            setWalletVisaTier(0);
          }
        } catch {
          setWalletVisaTier(0);
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
    if (typeof window === "undefined" || !window.ethereum) {
      setLoading(false);
      return;
    }

    const eth = window.ethereum as unknown as {
      request: (args: { method: string }) => Promise<string[]>;
      on?: (event: string, handler: (accounts: string[]) => void) => void;
      removeListener?: (
        event: string,
        handler: (accounts: string[]) => void,
      ) => void;
    };

    // Handle account changes (wallet switch or disconnect)
    const handleAccountsChanged = (accounts: string[]) => {
      if (accounts.length > 0) {
        setWalletAddress(accounts[0]);
        void loadAgents(accounts[0]);
      } else {
        setWalletAddress(null);
        setAgents([]);
      }
    };

    eth.on?.("accountsChanged", handleAccountsChanged);

    // Initial check
    void (async () => {
      try {
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
    })();

    return () => {
      eth.removeListener?.("accountsChanged", handleAccountsChanged);
    };
  }, [loadAgents]);

  async function handleClaimTourist() {
    if (!walletAddress) return;
    const trimmedWallet = agentWalletInput.trim();
    if (!trimmedWallet || !/^0x[0-9a-fA-F]{40}$/.test(trimmedWallet)) {
      setClaimError("Please enter a valid EVM wallet address for your agent");
      return;
    }
    setClaimingTourist(true);
    setClaimError(null);
    try {
      const chainsWithVisa = Object.entries(CHAIN_CONFIG).filter(
        ([, config]) => config.visa,
      );
      if (chainsWithVisa.length === 0) return;
      const [chainId] = chainsWithVisa[0];
      const agentId = walletToAgentId(walletAddress);

      const res = await fetch("/api/visa/claim", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chainId,
          agentId,
          targetTier: 1,
          agentWallet: trimmedWallet,
        }),
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) {
        setClaimError(data.error ?? "Claim failed");
        return;
      }
      // Reload to show the new visa
      await loadAgents(walletAddress);
    } catch {
      setClaimError("Claim failed — please try again");
    } finally {
      setClaimingTourist(false);
    }
  }

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
        <div className="text-center py-12 space-y-4">
          <p className="text-muted">
            Get started by claiming your Tourist Visa. No registration or
            verification needed for Tier 1.
          </p>
          <div className="max-w-md mx-auto space-y-2">
            <label
              htmlFor="agent-wallet"
              className="block text-xs text-muted text-left"
            >
              Agent Wallet Address
            </label>
            <input
              id="agent-wallet"
              type="text"
              placeholder="0x... (the EVM wallet your agent transacts from)"
              value={agentWalletInput}
              onChange={(e) => setAgentWalletInput(e.target.value)}
              className="w-full px-3 py-2 text-sm rounded-lg border border-border bg-surface-1 font-mono placeholder:text-muted/50 focus:outline-none focus:ring-1 focus:ring-accent"
            />
            <p className="text-[10px] text-muted text-left">
              This is the wallet your agent uses to transact on Celo. Its
              activity will be tracked for tier progression.
            </p>
          </div>
          {claimError && (
            <p className="text-sm text-accent-error">{claimError}</p>
          )}
          <button
            onClick={() => void handleClaimTourist()}
            disabled={claimingTourist || !agentWalletInput.trim()}
            className="px-4 py-2 bg-foreground text-background rounded-lg text-sm font-medium hover:opacity-90 transition-opacity disabled:opacity-50"
          >
            {claimingTourist ? (
              <span className="inline-flex items-center gap-2">
                <Loader2 className="h-3 w-3 animate-spin" />
                Claiming...
              </span>
            ) : (
              "Claim Tourist Visa"
            )}
          </button>
        </div>
      ) : (
        <div className="space-y-4">
          <h2 className="text-lg font-semibold">Your Agents</h2>
          {agents.map((agent) => (
            <div key={`${agent.chainId}-${agent.agentId}`}>
              <p className="text-xs text-muted mb-1.5">
                {agent.isWalletBased
                  ? `Wallet Visa`
                  : `Agent #${agent.agentId}`}
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
