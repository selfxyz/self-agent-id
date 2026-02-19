"use client";

import React, { Suspense, useState, useEffect, useCallback } from "react";
import { useSearchParams } from "next/navigation";
import { ethers } from "ethers";
import dynamic from "next/dynamic";
import {
  Search,
  ShieldCheck,
  XCircle,
  Code2,
  Cpu,
  ChevronLeft,
  Shield,
  FileText,
} from "lucide-react";
import CodeBlock from "@/components/CodeBlock";
import { getServiceSnippets, getAgentSnippets } from "@/lib/snippets";
import { connectWallet } from "@/lib/wallet";
import { REGISTRY_ADDRESS, REGISTRY_ABI, RPC_URL } from "@/lib/constants";
import { Card } from "@/components/Card";
import { Button } from "@/components/Button";

const SelfQRcodeWrapper = dynamic(
  () => import("@selfxyz/qrcode").then((mod) => mod.SelfQRcodeWrapper),
  { ssr: false }
);

let SelfAppBuilder: typeof import("@selfxyz/qrcode").SelfAppBuilder;

interface AgentInfo {
  isVerified: boolean;
  agentId: bigint;
  owner: string;
  registeredAt: bigint;
  guardian: string;
  metadata: string;
  mode: "simple" | "advanced" | "walletfree";
}

function VerifyContent() {
  const searchParams = useSearchParams();
  const [agentKey, setAgentKey] = useState(searchParams.get("key") || "");
  const [resolvedKey, setResolvedKey] = useState("");
  const [agentInfo, setAgentInfo] = useState<AgentInfo | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [activeUseCase, setActiveUseCase] = useState(0);
  const [activeAgentSnippet, setActiveAgentSnippet] = useState(0);
  const [walletAddress, setWalletAddress] = useState<string | null>(null);
  const [showDeregister, setShowDeregister] = useState(false);
  const [selfApp, setSelfApp] = useState<ReturnType<
    InstanceType<typeof import("@selfxyz/qrcode").SelfAppBuilder>["build"]
  > | null>(null);

  const lookupAgent = useCallback(async (key: string) => {
    if (!key) return;
    setLoading(true);
    setError("");
    setAgentInfo(null);

    try {
      let keyHash: string;
      if (key.startsWith("0x") && key.length === 66) {
        keyHash = key;
      } else if (key.startsWith("0x") && key.length === 42) {
        keyHash = ethers.zeroPadValue(key, 32);
      } else {
        keyHash = ethers.keccak256(ethers.toUtf8Bytes(key));
      }
      setResolvedKey(keyHash);

      const provider = new ethers.JsonRpcProvider(RPC_URL);
      const contract = new ethers.Contract(
        REGISTRY_ADDRESS,
        REGISTRY_ABI,
        provider
      );

      const isVerified = await contract.isVerifiedAgent(keyHash);
      const agentId = await contract.getAgentId(keyHash);

      if (agentId === 0n) {
        setAgentInfo({
          isVerified: false,
          agentId: 0n,
          owner: ethers.ZeroAddress,
          registeredAt: 0n,
          guardian: ethers.ZeroAddress,
          metadata: "",
          mode: "simple",
        });
      } else {
        let owner = ethers.ZeroAddress;
        let registeredAt = 0n;
        let guardian = ethers.ZeroAddress;
        let metadata = "";
        try {
          owner = await contract.ownerOf(agentId);
          registeredAt = await contract.agentRegisteredAt(agentId);
          guardian = await contract.agentGuardian(agentId);
          metadata = await contract.getAgentMetadata(agentId);
        } catch {
          // Token was burned (deregistered) or V3 contract without guardian/metadata
        }

        // Detect mode: wallet-free if owner === agent address (derived from key)
        const agentAddress = "0x" + keyHash.slice(26);
        let mode: "simple" | "advanced" | "walletfree" = "advanced";
        if (owner !== ethers.ZeroAddress) {
          if (agentAddress.toLowerCase() === owner.toLowerCase()) {
            // Owner IS the agent address — could be simple or wallet-free
            // Wallet-free agents have a guardian set (or were registered via W action)
            // Simple mode: agentPubKey = zeroPadValue(humanWallet), so agent addr === human wallet
            // For now, if guardian is set it's wallet-free, otherwise simple
            mode = guardian !== ethers.ZeroAddress ? "walletfree" : "simple";
          }
        }

        setAgentInfo({
          isVerified,
          agentId: owner === ethers.ZeroAddress ? 0n : agentId,
          owner,
          registeredAt,
          guardian,
          metadata,
          mode,
        });
      }
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to query contract"
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const key = searchParams.get("key");
    if (key) {
      setAgentKey(key);
      lookupAgent(key);
    }
  }, [searchParams, lookupAgent]);

  useEffect(() => {
    import("@selfxyz/qrcode").then((mod) => {
      SelfAppBuilder = mod.SelfAppBuilder;
    });
  }, []);

  const handleConnectForDeregister = async () => {
    const addr = await connectWallet();
    if (addr) setWalletAddress(addr);
  };

  const handleDeregister = () => {
    if (!resolvedKey || !SelfAppBuilder || !agentInfo) return;

    const agentAddress = "0x" + resolvedKey.slice(26);

    // Determine deregistration userData based on mode
    let userDefinedData: string;
    let userId: string;

    if (agentInfo.mode === "simple") {
      userDefinedData = "D";
      userId = walletAddress || agentAddress;
    } else if (agentInfo.mode === "walletfree") {
      // Wallet-free: use "D" action with agent address as userId
      userDefinedData = "D";
      userId = agentAddress;
    } else {
      // Advanced mode
      userDefinedData = "X" + resolvedKey.slice(26);
      userId = walletAddress || agentAddress;
    }

    const app = new SelfAppBuilder({
      version: 2,
      appName: process.env.NEXT_PUBLIC_SELF_APP_NAME || "Self Agent ID",
      scope: process.env.NEXT_PUBLIC_SELF_SCOPE_SEED || "self-agent-id",
      endpoint: REGISTRY_ADDRESS,
      logoBase64: "https://i.postimg.cc/mrmVf9hm/self.png",
      userId,
      endpointType: "staging_celo",
      userIdType: "hex",
      userDefinedData,
      disclosures: {},
    }).build();
    setSelfApp(app);
    setShowDeregister(true);
  };

  const handleDeregisterSuccess = () => {
    setShowDeregister(false);
    setSelfApp(null);
    lookupAgent(agentKey);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    lookupAgent(agentKey);
  };

  const snippets = getServiceSnippets(REGISTRY_ADDRESS);

  return (
    <>
      <form onSubmit={handleSubmit} className="w-full flex gap-2">
        <input
          type="text"
          value={agentKey}
          onChange={(e) => setAgentKey(e.target.value)}
          placeholder="Agent address (0x...) or bytes32 key"
          className="flex-1 px-4 py-3 bg-surface-2 border border-border rounded-lg focus:border-accent focus:ring-0"
        />
        <Button type="submit" disabled={loading || !agentKey} variant="primary">
          <Search size={16} />
          {loading ? "..." : "Check"}
        </Button>
      </form>

      {error && <p className="text-accent-error text-sm">{error}</p>}

      {agentInfo && (
        <>
          <Card
            variant={
              agentInfo.agentId === 0n
                ? "error"
                : agentInfo.isVerified
                  ? "success"
                  : "error"
            }
            className="w-full"
          >
            <div className="flex items-center gap-3 mb-3">
              {agentInfo.isVerified ? (
                <ShieldCheck size={28} className="text-accent-success" />
              ) : (
                <XCircle size={28} className="text-accent-error" />
              )}
              <span className="font-semibold text-lg">
                {agentInfo.agentId === 0n
                  ? "Not Registered"
                  : agentInfo.isVerified
                    ? "Verified"
                    : "Revoked"}
              </span>
            </div>

            {agentInfo.agentId > 0n && (
              <div className="text-sm space-y-2">
                <div className="flex justify-between">
                  <span className="text-muted">Agent ID</span>
                  <span className="font-mono">{agentInfo.agentId.toString()}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted">Mode</span>
                  <span className={`text-xs px-2 py-0.5 rounded-full ${
                    agentInfo.mode === "simple" ? "bg-surface-2 text-muted" :
                    agentInfo.mode === "advanced" ? "bg-accent/10 text-accent" :
                    "bg-accent-2/10 text-accent-2"
                  }`}>
                    {agentInfo.mode === "simple" ? "Verified Wallet" :
                     agentInfo.mode === "advanced" ? "Agent Identity" :
                     "Wallet-Free"}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted">Owner</span>
                  <span className="font-mono">
                    {agentInfo.owner.slice(0, 6)}...{agentInfo.owner.slice(-4)}
                  </span>
                </div>
                {agentInfo.guardian !== ethers.ZeroAddress && (
                  <div className="flex justify-between">
                    <span className="text-muted flex items-center gap-1">
                      <Shield size={12} /> Guardian
                    </span>
                    <span className="font-mono">
                      {agentInfo.guardian.slice(0, 6)}...{agentInfo.guardian.slice(-4)}
                    </span>
                  </div>
                )}
                <div className="flex justify-between">
                  <span className="text-muted">Registered at block</span>
                  <span className="font-mono">{agentInfo.registeredAt.toString()}</span>
                </div>
                {agentInfo.metadata && (
                  <div className="mt-3 pt-3 border-t border-border">
                    <div className="flex items-center gap-1 text-muted mb-1">
                      <FileText size={12} /> Metadata
                    </div>
                    <pre className="text-xs bg-surface-2 rounded-lg p-3 overflow-x-auto whitespace-pre-wrap break-all">
                      {agentInfo.metadata}
                    </pre>
                  </div>
                )}
              </div>
            )}
          </Card>

          {agentInfo.isVerified && (
            <div className="w-full mt-2">
              {agentInfo.mode === "walletfree" ? (
                // Wallet-free: no wallet needed, deregister via passport scan
                !showDeregister ? (
                  <Button onClick={handleDeregister} variant="danger" size="sm">
                    Deregister (scan passport)
                  </Button>
                ) : (
                  <Card variant="error" className="w-full">
                    <div className="flex items-center gap-2 mb-3">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src="/self-icon.png" alt="Self" width={20} height={20} className="rounded" />
                      <p className="text-sm text-muted">
                        Scan with Self App to confirm deregistration
                      </p>
                    </div>
                    {selfApp && (
                      <div className="rounded-xl p-4 bg-white inline-block">
                        <SelfQRcodeWrapper
                          selfApp={selfApp}
                          onSuccess={handleDeregisterSuccess}
                          onError={() => alert("Deregistration failed.")}
                        />
                      </div>
                    )}
                    <div className="mt-3">
                      <Button
                        onClick={() => { setShowDeregister(false); setSelfApp(null); }}
                        variant="ghost"
                        size="sm"
                      >
                        <ChevronLeft size={14} />
                        Cancel
                      </Button>
                    </div>
                  </Card>
                )
              ) : !walletAddress ? (
                <Button onClick={handleConnectForDeregister} variant="danger" size="sm">
                  Connect wallet to deregister
                </Button>
              ) : walletAddress.toLowerCase() === agentInfo.owner.toLowerCase() ? (
                !showDeregister ? (
                  <Button onClick={handleDeregister} variant="danger" size="sm">
                    Deregister Agent
                  </Button>
                ) : (
                  <Card variant="error" className="w-full">
                    <div className="flex items-center gap-2 mb-3">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src="/self-icon.png" alt="Self" width={20} height={20} className="rounded" />
                      <p className="text-sm text-muted">
                        Scan with Self App to confirm deregistration
                      </p>
                    </div>
                    {selfApp && (
                      <div className="rounded-xl p-4 bg-white inline-block">
                        <SelfQRcodeWrapper
                          selfApp={selfApp}
                          onSuccess={handleDeregisterSuccess}
                          onError={() => alert("Deregistration failed.")}
                        />
                      </div>
                    )}
                    <div className="mt-3">
                      <Button
                        onClick={() => { setShowDeregister(false); setSelfApp(null); }}
                        variant="ghost"
                        size="sm"
                      >
                        <ChevronLeft size={14} />
                        Cancel
                      </Button>
                    </div>
                  </Card>
                )
              ) : (
                <p className="text-xs text-muted">
                  Connected: {walletAddress.slice(0, 6)}...{walletAddress.slice(-4)} (not the owner)
                </p>
              )}
            </div>
          )}
        </>
      )}

      {/* Integration Guide */}
      {agentInfo && agentInfo.isVerified && (
        <div className="w-full mt-8 space-y-4">
          <div className="flex items-center gap-2">
            <Code2 size={20} className="text-accent" />
            <h2 className="text-xl font-bold">Integration Guide for Developers</h2>
          </div>
          <p className="text-sm text-muted">
            These code snippets are for <strong className="text-foreground">service developers</strong> who want to verify
            agents in their applications. Pre-filled with the deployed contract address.
          </p>

          <div className="flex gap-2 flex-wrap">
            {snippets.map((uc, i) => (
              <button
                key={uc.title}
                onClick={() => setActiveUseCase(i)}
                className={`px-4 py-2 rounded-full text-sm font-medium transition-colors ${
                  i === activeUseCase
                    ? "bg-gradient-to-r from-accent to-accent-2 text-white"
                    : "bg-surface-2 text-muted hover:text-foreground"
                }`}
              >
                {uc.title}
              </button>
            ))}
          </div>

          <p className="text-sm text-muted">
            {snippets[activeUseCase].description}
          </p>
          <p className="text-xs text-subtle font-mono">
            {snippets[activeUseCase].flow}
          </p>
          <CodeBlock tabs={snippets[activeUseCase].snippets} />
        </div>
      )}

      {/* Agent usage guide */}
      {agentInfo && agentInfo.isVerified && (
        <div className="w-full mt-8 space-y-4">
          <div className="flex items-center gap-2">
            <Cpu size={20} className="text-accent" />
            <h2 className="text-xl font-bold">How to Use Your Agent</h2>
          </div>
          <p className="text-sm text-muted">
            If you are the <strong className="text-foreground">agent operator</strong>, use these snippets to
            authenticate your agent with services or submit on-chain transactions.
            Set <code className="bg-surface-2 font-mono text-accent-2 px-1 rounded text-xs">AGENT_PRIVATE_KEY</code> in
            your agent&apos;s environment first.
          </p>

          {(() => {
            const agentSnippets = getAgentSnippets();
            return (
              <>
                <div className="flex gap-2 flex-wrap">
                  {agentSnippets.map((snippet, i) => (
                    <button
                      key={snippet.title}
                      onClick={() => setActiveAgentSnippet(i)}
                      className={`px-4 py-2 rounded-full text-sm font-medium transition-colors ${
                        i === activeAgentSnippet
                          ? "bg-gradient-to-r from-accent to-accent-2 text-white"
                          : "bg-surface-2 text-muted hover:text-foreground"
                      }`}
                    >
                      {snippet.title}
                    </button>
                  ))}
                </div>

                <p className="text-sm text-muted">
                  {agentSnippets[activeAgentSnippet].description}
                </p>
                <CodeBlock tabs={agentSnippets[activeAgentSnippet].snippets} />
              </>
            );
          })()}
        </div>
      )}
    </>
  );
}

export default function VerifyPage() {
  return (
    <main className="min-h-screen max-w-2xl mx-auto px-6 pt-24 pb-12 space-y-6">
      <div className="text-center">
        <h1 className="text-3xl font-bold mb-2">
          <span className="text-gradient">Verify</span> Agent
        </h1>
        <p className="text-muted max-w-md mx-auto">
          Check if an AI agent is registered and backed by a verified human.
        </p>
      </div>

      <Suspense
        fallback={
          <div className="w-full h-12 bg-surface-2 animate-pulse rounded-lg" />
        }
      >
        <VerifyContent />
      </Suspense>
    </main>
  );
}
