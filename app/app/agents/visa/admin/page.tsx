"use client";

import { useEffect, useState, useCallback } from "react";
import { ethers } from "ethers";
import { Card } from "@/components/Card";
import { Badge } from "@/components/Badge";
import { Button } from "@/components/Button";
import { VISA_ABI, REGISTRY_ABI } from "@/lib/constants";
import { CHAIN_CONFIG } from "@/lib/chain-config";
import { Loader2, ExternalLink, ShieldCheck, ShieldX } from "lucide-react";

const DEFAULT_CHAIN_ID = "11142220"; // Celo Sepolia — switch to "42220" for mainnet

const TIER_LABELS: Record<number, string> = {
  0: "None",
  1: "Tourist",
  2: "Work",
  3: "Citizenship",
};

interface ReviewItem {
  agentId: number;
  currentTier: number;
  requestedTier: number;
  transactionCount: number;
  volumeUsd: number;
  walletAddress: string;
  isProofFresh: boolean;
}

export default function VisaAdminPage() {
  const [authorized, setAuthorized] = useState<boolean | null>(null);
  const [items, setItems] = useState<ReviewItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [processing, setProcessing] = useState<Record<number, string>>({});
  const [_walletAddress, setWalletAddress] = useState<string | null>(null);

  const chainId = DEFAULT_CHAIN_ID;
  const config = CHAIN_CONFIG[chainId];

  const checkAuth = useCallback(
    async (address: string) => {
      if (!config?.visa) return;
      try {
        const provider = new ethers.JsonRpcProvider(config.rpc);
        const visa = new ethers.Contract(config.visa, VISA_ABI, provider);
        const upgraderRole = await visa.UPGRADER_ROLE();
        const hasRole = await visa.hasRole(upgraderRole, address);
        setAuthorized(hasRole);
      } catch {
        setAuthorized(false);
      }
    },
    [config],
  );

  const loadPendingReviews = useCallback(async () => {
    if (!config?.visa) return;
    setLoading(true);
    try {
      const provider = new ethers.JsonRpcProvider(config.rpc);
      const visa = new ethers.Contract(config.visa, VISA_ABI, provider);
      const registry = new ethers.Contract(
        config.registry,
        REGISTRY_ABI,
        provider,
      );

      // Query ReviewRequested events
      const filter = visa.filters.ReviewRequested();
      const events = await visa.queryFilter(filter);

      const pending: ReviewItem[] = [];
      const seen = new Set<number>();

      for (const event of events) {
        const log = event as ethers.EventLog;
        const agentId = Number(log.args?.[0]);
        const requestedTier = Number(log.args?.[1]);

        if (seen.has(agentId)) continue;
        seen.add(agentId);

        // Check if still pending
        const [reviewTier, approved] = await Promise.all([
          visa.reviewRequestedTier(BigInt(agentId)),
          visa.manualReviewApproved(BigInt(agentId)),
        ]);

        if (Number(reviewTier) === 0 || approved) continue;

        // Fetch agent data
        const [currentTier, metrics, wallet, proofFresh] = await Promise.all([
          visa.getTier(BigInt(agentId)),
          visa.getMetrics(BigInt(agentId)),
          registry.getAgentWallet(BigInt(agentId)).catch(() => "0x"),
          registry.isProofFresh(BigInt(agentId)).catch(() => false),
        ]);

        pending.push({
          agentId,
          currentTier: Number(currentTier),
          requestedTier,
          transactionCount: Number(metrics.transactionCount),
          volumeUsd: Number(metrics.volumeUsd) / 1e6,
          walletAddress: String(wallet),
          isProofFresh: Boolean(proofFresh),
        });
      }

      setItems(pending);
    } catch {
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, [config]);

  useEffect(() => {
    async function connect() {
      if (typeof window === "undefined" || !window.ethereum) {
        setLoading(false);
        setAuthorized(false);
        return;
      }
      try {
        const eth = window.ethereum as unknown as {
          request: (args: { method: string }) => Promise<string[]>;
        };
        const accounts = await eth.request({ method: "eth_accounts" });
        if (accounts.length > 0) {
          setWalletAddress(accounts[0]);
          await checkAuth(accounts[0]);
          await loadPendingReviews();
        } else {
          setLoading(false);
          setAuthorized(false);
        }
      } catch {
        setLoading(false);
        setAuthorized(false);
      }
    }
    void connect();
  }, [checkAuth, loadPendingReviews]);

  async function handleDecision(agentId: number, approve: boolean) {
    if (!config?.visa || !window.ethereum) return;

    setProcessing((prev) => ({
      ...prev,
      [agentId]: approve ? "approving" : "rejecting",
    }));

    try {
      const provider = new ethers.BrowserProvider(
        window.ethereum as unknown as ethers.Eip1193Provider,
      );
      const signer = await provider.getSigner();
      const visa = new ethers.Contract(config.visa, VISA_ABI, signer);

      const tx = await visa.setManualReviewStatus(BigInt(agentId), approve);
      await tx.wait();

      setItems((prev) => prev.filter((item) => item.agentId !== agentId));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      alert(`Transaction failed: ${message}`);
    } finally {
      setProcessing((prev) => {
        const next = { ...prev };
        delete next[agentId];
        return next;
      });
    }
  }

  if (authorized === false) {
    return (
      <div className="max-w-2xl mx-auto text-center py-12">
        <h1 className="text-2xl font-bold mb-3">Review Queue</h1>
        <p className="text-muted">
          This page is restricted to wallets with the UPGRADER_ROLE on the Celo
          Agent Visa contract. Connect a wallet with the appropriate role to
          manage review requests.
        </p>
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto">
      <h1 className="text-2xl font-bold mb-6">
        Celo Agent Visa — Review Queue
      </h1>

      {loading ? (
        <div className="flex items-center justify-center gap-2 py-12 text-muted">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading pending reviews...
        </div>
      ) : items.length === 0 ? (
        <Card>
          <p className="text-sm text-muted text-center py-4">
            No pending reviews
          </p>
        </Card>
      ) : (
        <div className="space-y-4">
          {items.map((item) => {
            const status = processing[item.agentId];
            return (
              <Card key={item.agentId}>
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <h3 className="text-sm font-semibold">
                      Agent #{item.agentId}
                    </h3>
                    <Badge variant="info">
                      Requesting {TIER_LABELS[item.requestedTier]}
                    </Badge>
                  </div>

                  <div className="grid grid-cols-2 gap-3 text-sm">
                    <div>
                      <p className="text-xs text-muted">Current Tier</p>
                      <p className="font-medium">
                        {TIER_LABELS[item.currentTier]}
                      </p>
                    </div>
                    <div>
                      <p className="text-xs text-muted">Self Verified</p>
                      <p className="font-medium">
                        {item.isProofFresh ? "Yes" : "No"}
                      </p>
                    </div>
                    <div>
                      <p className="text-xs text-muted">Transactions</p>
                      <p className="font-medium tabular-nums">
                        {item.transactionCount.toLocaleString()}
                      </p>
                    </div>
                    <div>
                      <p className="text-xs text-muted">Volume (USD)</p>
                      <p className="font-medium tabular-nums">
                        ${item.volumeUsd.toLocaleString()}
                      </p>
                    </div>
                  </div>

                  {item.walletAddress &&
                    item.walletAddress !== "0x" &&
                    config?.blockExplorer && (
                      <a
                        href={`${config.blockExplorer}/address/${item.walletAddress}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 text-xs text-accent hover:underline"
                      >
                        View on Explorer
                        <ExternalLink className="h-3 w-3" />
                      </a>
                    )}

                  <div className="flex items-center gap-2 pt-1">
                    <Button
                      size="sm"
                      onClick={() => void handleDecision(item.agentId, true)}
                      disabled={!!status}
                    >
                      {status === "approving" ? (
                        <>
                          <Loader2 className="h-3 w-3 animate-spin mr-1" />
                          Approving...
                        </>
                      ) : (
                        <>
                          <ShieldCheck className="h-3 w-3 mr-1" />
                          Approve
                        </>
                      )}
                    </Button>
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => void handleDecision(item.agentId, false)}
                      disabled={!!status}
                    >
                      {status === "rejecting" ? (
                        <>
                          <Loader2 className="h-3 w-3 animate-spin mr-1" />
                          Rejecting...
                        </>
                      ) : (
                        <>
                          <ShieldX className="h-3 w-3 mr-1" />
                          Reject
                        </>
                      )}
                    </Button>
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
