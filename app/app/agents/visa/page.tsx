"use client";

import { useEffect, useState, useCallback } from "react";
import { ethers } from "ethers";
import { VisaCard } from "@/components/VisaCard";
import { VisaUpgradeFlow } from "@/components/VisaUpgradeFlow";
import { REGISTRY_ABI, VISA_ABI } from "@/lib/constants";
import { useNetwork } from "@/lib/NetworkContext";
import { ExternalLink, Loader2, CheckCircle2 } from "lucide-react";

interface AgentBasic {
  agentId: string;
  chainId: number;
  isWalletBased?: boolean;
}

interface MigrationState {
  status: "migrating" | "success" | "error";
  message: string;
  newAgentId?: string;
  txHash?: string;
}

/** Derive a deterministic agentId from a wallet address (for Tourist visa without registry) */
function walletToAgentId(address: string): string {
  return BigInt(address).toString();
}

export default function CeloAgentVisaPage() {
  const { network } = useNetwork();
  const [agents, setAgents] = useState<AgentBasic[]>([]);
  const [loading, setLoading] = useState(true);
  const [walletAddress, setWalletAddress] = useState<string | null>(null);
  const [claimingTourist, setClaimingTourist] = useState(false);
  const [claimError, setClaimError] = useState<string | null>(null);
  const [agentWalletInput, setAgentWalletInput] = useState("");
  const [migration, setMigration] = useState<MigrationState | null>(null);
  const [upgradingAgent, setUpgradingAgent] = useState<AgentBasic | null>(null);

  const loadAgents = useCallback(async (address: string) => {
    setLoading(true);
    try {
      if (!network.visaAddress) {
        setAgents([]);
        return;
      }

      const chainId = network.chainId;
      const allAgents: AgentBasic[] = [];

      const provider = new ethers.JsonRpcProvider(network.rpcUrl);
      const registry = new ethers.Contract(
        network.registryAddress,
        REGISTRY_ABI,
        provider,
      );

      // Find registry-based agents via Transfer events TO the connected wallet.
      // Use Transfer(null, address) — matching the pattern in the My Agents page.
      // Filtering both from AND to simultaneously fails on some RPCs.
      const scanFrom = network.visaDeployBlock > 0
        ? network.visaDeployBlock
        : network.registryDeployBlock;
      try {
        const filter = registry.filters.Transfer(null, address);
        const events = await registry.queryFilter(filter, scanFrom);
        for (const event of events) {
          const tokenId = (event as ethers.EventLog).args?.[2] as
            | bigint
            | undefined;
          if (tokenId && BigInt(tokenId) > 0n) {
            allAgents.push({
              agentId: BigInt(tokenId).toString(),
              chainId,
            });
          }
        }
      } catch {
        // Registry event query may fail for large block ranges
      }

      // Also check for wallet-based Tourist visa (no registry needed)
      const walletAgentId = walletToAgentId(address);
      try {
        const provider = new ethers.JsonRpcProvider(network.rpcUrl);
        const visa = new ethers.Contract(network.visaAddress, VISA_ABI, provider);
        const tier = Number(await visa.getTier(BigInt(walletAgentId)));
        if (tier > 0) {
          const exists = allAgents.some(
            (a) => a.agentId === walletAgentId && a.chainId === chainId,
          );
          if (!exists) {
            allAgents.push({
              agentId: walletAgentId,
              chainId,
              isWalletBased: true,
            });
          }
        }
      } catch {
        // Skip — no wallet visa on this chain
      }

      // If both wallet-based and registry-based agents exist, hide the wallet-based one.
      // The old wallet-based visa can't be burned (soulbound), so it stays on-chain at tier 1.
      // The registry-based visa is canonical after migration.
      const hasRegistryAgent = allAgents.some((a) => !a.isWalletBased);
      const filteredAgents = hasRegistryAgent
        ? allAgents.filter((a) => !a.isWalletBased)
        : allAgents;

      setAgents(filteredAgents);

      // Auto-detect migration opportunity: wallet-based visa + registry agent without visa
      const walletAgent = allAgents.find((a) => a.isWalletBased);
      const registryAgent = allAgents.find((a) => !a.isWalletBased);
      if (walletAgent && registryAgent) {
        try {
          const provider = new ethers.JsonRpcProvider(network.rpcUrl);
          const visa = new ethers.Contract(network.visaAddress, VISA_ABI, provider);
          const registryTier = Number(
            await visa.getTier(BigInt(registryAgent.agentId)),
          );
          if (registryTier === 0) {
            // Registry agent has no visa — auto-migrate
            void autoMigrate(address, walletAgent.agentId, registryAgent.agentId);
          }
        } catch {
          // Skip — can't check, don't migrate
        }
      }
    } catch {
      setAgents([]);
    } finally {
      setLoading(false);
    }
  }, [network]);

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

  async function autoMigrate(
    connectedWallet: string,
    oldAgentId: string,
    newAgentId: string,
  ) {
    setMigration({ status: "migrating", message: "Migrating your visa to your verified identity..." });
    try {
      const res = await fetch("/api/visa/migrate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chainId: String(network.chainId),
          oldAgentId,
          newAgentId,
          connectedWallet,
          targetTier: 2,
        }),
      });
      const data = (await res.json()) as {
        success?: boolean;
        error?: string;
        newTier?: number;
        mintTxHash?: string;
      };
      if (!res.ok) {
        // Retry once if registration hasn't landed on-chain yet
        if (data.error?.includes("not registered") || data.error?.includes("fresh human proof")) {
          await new Promise((r) => setTimeout(r, 5000));
          const retry = await fetch("/api/visa/migrate", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              chainId: String(network.chainId),
              oldAgentId,
              newAgentId,
              connectedWallet,
              targetTier: 2,
            }),
          });
          const retryData = (await retry.json()) as typeof data;
          if (!retry.ok) {
            setMigration({ status: "error", message: retryData.error ?? "Migration failed" });
            return;
          }
          setMigration({
            status: "success",
            message: "Work Visa claimed! Your identity is verified and your visa has been upgraded.",
            newAgentId,
            txHash: retryData.mintTxHash,
          });
          await loadAgents(connectedWallet);
          return;
        }
        setMigration({ status: "error", message: data.error ?? "Migration failed" });
        return;
      }
      setMigration({
        status: "success",
        message: "Work Visa claimed! Your identity is verified and your visa has been upgraded.",
        newAgentId,
        txHash: data.mintTxHash,
      });
      await loadAgents(connectedWallet);
    } catch (err) {
      setMigration({
        status: "error",
        message: err instanceof Error ? err.message : "Migration failed",
      });
    }
  }

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
      if (!network.visaAddress) return;
      const chainId = String(network.chainId);
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
      const data = (await res.json()) as {
        error?: string;
        code?: string;
        metrics?: { transactionCount: number; volumeUsd: number };
        required?: { minTransactions: number; minVolumeUsd: number };
      };
      if (!res.ok) {
        if (data.code === "NOT_ELIGIBLE" && data.metrics && data.required) {
          const r = data.required;
          const m = data.metrics;
          const parts: string[] = [];
          if (r.minTransactions > 0)
            parts.push(
              `${m.transactionCount}/${r.minTransactions} transactions`,
            );
          if (r.minVolumeUsd > 0)
            parts.push(`$${m.volumeUsd}/$${r.minVolumeUsd} volume`);
          setClaimError(
            parts.length > 0
              ? `Not eligible yet: ${parts.join(", ")}.`
              : "Not eligible for this tier yet.",
          );
        } else {
          setClaimError(data.error ?? "Claim failed");
        }
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
        <a
          href="https://celo.org/agent-visa"
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 text-sm text-muted mt-3 hover:text-foreground transition-colors"
        >
          Learn more
          <ExternalLink className="h-3 w-3" />
        </a>
      </div>

      {/* Connected wallet */}
      {walletAddress && (
        <p className="text-xs text-muted text-center mb-6 font-mono">
          Connected: {walletAddress.slice(0, 6)}...{walletAddress.slice(-4)}
        </p>
      )}

      {/* Migration status */}
      {migration && (
        <div className="mb-6">
          {migration.status === "migrating" && (
            <div className="flex items-center justify-center gap-2 py-4 px-4 rounded-lg bg-surface-1 text-muted">
              <Loader2 className="h-4 w-4 animate-spin" />
              <span className="text-sm">{migration.message}</span>
            </div>
          )}
          {migration.status === "success" && (
            <div className="text-center py-4 px-4 rounded-lg bg-surface-1 space-y-2">
              <div className="flex items-center justify-center gap-2">
                <CheckCircle2 className="h-5 w-5 text-accent-success" />
                <span className="text-sm font-medium">{migration.message}</span>
              </div>
              {migration.txHash && (
                <a
                  href={`${network.blockExplorer}/tx/${migration.txHash}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-xs text-accent hover:underline"
                >
                  View transaction <ExternalLink className="h-3 w-3" />
                </a>
              )}
              <button
                onClick={() => setMigration(null)}
                className="block mx-auto text-xs text-muted hover:text-foreground"
              >
                Dismiss
              </button>
            </div>
          )}
          {migration.status === "error" && (
            <div className="text-center py-4 px-4 rounded-lg bg-surface-1 space-y-2">
              <p className="text-sm text-accent-error">{migration.message}</p>
              <button
                onClick={() => setMigration(null)}
                className="text-xs text-muted hover:text-foreground"
              >
                Dismiss
              </button>
            </div>
          )}
        </div>
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
            verification needed for Tier 1. Your agent wallet must have at
            least 1 transaction on Celo to qualify.
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
              {upgradingAgent?.agentId === agent.agentId ? (
                <VisaUpgradeFlow
                  oldAgentId={agent.agentId}
                  chainId={agent.chainId}
                  walletAddress={walletAddress!}
                  blockExplorer={network.blockExplorer}
                  onComplete={() => {
                    setUpgradingAgent(null);
                    void loadAgents(walletAddress!);
                  }}
                  onCancel={() => setUpgradingAgent(null)}
                />
              ) : (
                <VisaCard
                  agentId={agent.agentId}
                  chainId={agent.chainId}
                  blockExplorer={network.blockExplorer}
                  isWalletBased={agent.isWalletBased}
                  onStartUpgrade={() => setUpgradingAgent(agent)}
                />
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
