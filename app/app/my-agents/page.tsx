"use client";

import React, { useState, useEffect } from "react";
import Link from "next/link";
import MatrixText from "@/components/MatrixText";
import { ethers } from "ethers";
import { Wallet, RefreshCw, Cpu, Shield, FileText, Search, Key, Fingerprint, Loader2 } from "lucide-react";
import { connectWallet } from "@/lib/wallet";
import { REGISTRY_ABI, PROVIDER_ABI } from "@/lib/constants";
import { useNetwork } from "@/lib/NetworkContext";
import { Card } from "@/components/Card";
import { Badge } from "@/components/Badge";
import { Button } from "@/components/Button";
import { StatusDot } from "@/components/StatusDot";
import { signInWithPasskey, sendUserOperation, encodeGuardianRevoke, isPasskeySupported, isGaslessSupported } from "@/lib/aa";

interface AgentCredentials {
  issuingState: string;
  nationality: string;
  olderThan: bigint;
  ofac: boolean[];
}

interface AgentEntry {
  agentId: bigint;
  agentKey: string;
  agentAddress: string;
  isVerified: boolean;
  registeredAt: bigint;
  mode: "simple" | "advanced" | "walletfree";
  guardian: string;
  hasMetadata: boolean;
  hasA2ACard: boolean;
  verificationStrength?: number;
  credentials?: AgentCredentials;
}

async function fetchCredentials(
  registry: ethers.Contract,
  agentId: bigint,
): Promise<AgentCredentials | undefined> {
  try {
    const raw = await registry.getAgentCredentials(agentId);
    const creds: AgentCredentials = {
      issuingState: raw.issuingState || raw[0] || "",
      nationality: raw.nationality || raw[3] || "",
      olderThan: raw.olderThan ?? raw[7] ?? 0n,
      ofac: raw.ofac || raw[8] || [false, false, false],
    };
    if (creds.nationality || creds.issuingState || creds.olderThan > 0n || creds.ofac?.some(Boolean)) {
      return creds;
    }
  } catch {
    // Contract without getAgentCredentials
  }
  return undefined;
}

async function fetchVerificationStrength(
  registry: ethers.Contract,
  agentId: bigint,
  provider: ethers.JsonRpcProvider,
): Promise<{ strength?: number; hasA2ACard: boolean }> {
  let strength: number | undefined;
  let hasA2ACard = false;
  try {
    const provAddr: string = await registry.agentProofProvider(agentId);
    if (provAddr && provAddr !== ethers.ZeroAddress) {
      const prov = new ethers.Contract(provAddr, PROVIDER_ABI, provider);
      const s: number = await prov.verificationStrength();
      strength = Number(s);
    }
  } catch {}
  try {
    const metadata: string = await registry.getAgentMetadata(agentId);
    if (metadata) {
      const parsed = JSON.parse(metadata);
      hasA2ACard = !!parsed.a2aVersion;
    }
  } catch {}
  return { strength, hasA2ACard };
}

function buildDisclosureBadges(creds: AgentCredentials): string[] {
  const badges: string[] = [];
  if (creds.olderThan > 0n) badges.push(`${creds.olderThan.toString()}+`);
  if (creds.ofac?.some(Boolean)) badges.push("Not on OFAC List");
  if (creds.nationality) badges.push(creds.nationality);
  if (creds.issuingState) badges.push(`Issued: ${creds.issuingState}`);
  return badges;
}

export default function MyAgentsPage() {
  const { network } = useNetwork();
  const [walletAddress, setWalletAddress] = useState<string | null>(null);
  const [agents, setAgents] = useState<AgentEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [lookupMode, setLookupMode] = useState<"wallet" | "key" | "passkey">("wallet");
  const [agentKeyInput, setAgentKeyInput] = useState("");
  const [passkeyAddress, setPasskeyAddress] = useState<string | null>(null);
  const [revoking, setRevoking] = useState<string | null>(null);
  const [passkeyAvailable, setPasskeyAvailable] = useState(false);

  useEffect(() => {
    setPasskeyAvailable(isPasskeySupported());
  }, []);

  const handleConnect = async () => {
    setError("");
    const address = await connectWallet(network);
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
      const provider = new ethers.JsonRpcProvider(network.rpcUrl);
      const registry = new ethers.Contract(network.registryAddress, REGISTRY_ABI, provider);

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

      const credentials = await fetchCredentials(registry, agentId);
      const { strength, hasA2ACard } = await fetchVerificationStrength(registry, agentId, provider);

      setAgents([{
        agentId,
        agentKey,
        agentAddress,
        isVerified,
        registeredAt,
        mode,
        guardian,
        hasMetadata,
        hasA2ACard,
        verificationStrength: strength,
        credentials,
      }]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to look up agent");
    } finally {
      setLoading(false);
    }
  };

  const handlePasskeySignIn = async () => {
    setError("");
    setLoading(true);
    setAgents([]);

    try {
      const { walletAddress: swAddress } = await signInWithPasskey(network);
      setPasskeyAddress(swAddress);
      await loadAgentsByGuardian(swAddress);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Passkey sign-in failed");
      setLoading(false);
    }
  };

  const loadAgentsByGuardian = async (guardianAddress: string) => {
    setLoading(true);
    setError("");
    setAgents([]);

    try {
      const provider = new ethers.JsonRpcProvider(network.rpcUrl);
      const registry = new ethers.Contract(network.registryAddress, REGISTRY_ABI, provider);

      // Scan Transfer events to find all minted agents, then check if guardian matches
      const mintFilter = registry.filters.Transfer(ethers.ZeroAddress, null);
      const mintEvents = await registry.queryFilter(mintFilter, 0, "latest");

      const results: AgentEntry[] = [];

      for (const event of mintEvents) {
        const log = event as ethers.EventLog;
        const agentId = log.args[2] as bigint;

        try {
          let guardian = ethers.ZeroAddress;
          try {
            guardian = await registry.agentGuardian(agentId);
          } catch {
            continue;
          }

          if (guardian.toLowerCase() !== guardianAddress.toLowerCase()) continue;

          const agentKey: string = await registry.agentIdToPubkey(agentId);
          const isVerified: boolean = await registry.isVerifiedAgent(agentKey);
          const registeredAt: bigint = await registry.agentRegisteredAt(agentId);
          const agentAddress = "0x" + agentKey.slice(26);

          let hasMetadata = false;
          try {
            const metadata: string = await registry.getAgentMetadata(agentId);
            hasMetadata = metadata.length > 0;
          } catch {}

          const credentials = await fetchCredentials(registry, agentId);
          const { strength, hasA2ACard } = await fetchVerificationStrength(registry, agentId, provider);

          results.push({
            agentId,
            agentKey,
            agentAddress,
            isVerified,
            registeredAt,
            mode: "walletfree", // guardian-managed agents are walletfree or smartwallet
            guardian,
            hasMetadata,
            hasA2ACard,
            verificationStrength: strength,
            credentials,
          });
        } catch {
          // Token was burned — skip
        }
      }

      setAgents(results);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load agents");
    } finally {
      setLoading(false);
    }
  };

  const handlePasskeyRevoke = async (agentId: bigint) => {
    setRevoking(agentId.toString());
    setError("");

    try {
      const callData = encodeGuardianRevoke(agentId);
      await sendUserOperation(network.registryAddress as `0x${string}`, callData, network);

      // Refresh list after successful revocation
      if (passkeyAddress) {
        await loadAgentsByGuardian(passkeyAddress);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Revocation failed");
    } finally {
      setRevoking(null);
    }
  };

  const loadAgentsByOwner = async (ownerAddress: string) => {
    setLoading(true);
    setError("");
    setAgents([]);

    try {
      const provider = new ethers.JsonRpcProvider(network.rpcUrl);
      const registry = new ethers.Contract(
        network.registryAddress,
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

          const credentials = await fetchCredentials(registry, agentId);
          const { strength, hasA2ACard } = await fetchVerificationStrength(registry, agentId, provider);

          results.push({
            agentId,
            agentKey,
            agentAddress,
            isVerified,
            registeredAt,
            mode,
            guardian,
            hasMetadata,
            hasA2ACard,
            verificationStrength: strength,
            credentials,
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
      <div className="flex justify-center mb-2">
        <MatrixText text="My Agents" fontSize={42} />
      </div>
      <p className="text-muted text-center mb-8">
        View agents registered to your wallet, or look up an agent by its key.
      </p>

      {/* Mode toggle */}
      <div className="flex justify-center gap-2 mb-6 flex-wrap">
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
        {passkeyAvailable && (
          <button
            onClick={() => { setLookupMode("passkey"); setAgents([]); setError(""); setPasskeyAddress(null); }}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
              lookupMode === "passkey"
                ? "bg-surface-2 border border-accent-success text-foreground"
                : "bg-surface-1 border border-border text-muted hover:text-foreground"
            }`}
          >
            <Fingerprint size={16} />
            Sign in with Passkey
          </button>
        )}
      </div>

      {lookupMode === "passkey" ? (
        /* ── Passkey mode ── */
        !passkeyAddress ? (
          <div className="flex flex-col items-center gap-4">
            <Fingerprint size={32} className="text-accent-success" />
            <Button onClick={handlePasskeySignIn} variant="primary" size="lg" disabled={loading}>
              {loading ? (
                <>
                  <Loader2 size={18} className="animate-spin" />
                  Authenticating...
                </>
              ) : (
                <>
                  <Fingerprint size={18} />
                  Sign in with Passkey
                </>
              )}
            </Button>
            <p className="text-xs text-subtle text-center max-w-xs">
              Uses your passkey (Face ID / fingerprint) to find agents where your smart wallet is the guardian.
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <p className="text-sm text-muted">
                Smart Wallet:{" "}
                <span className="font-mono text-foreground">
                  {passkeyAddress.slice(0, 6)}...{passkeyAddress.slice(-4)}
                </span>
              </p>
              <button
                onClick={() => passkeyAddress && loadAgentsByGuardian(passkeyAddress)}
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
                <div className="w-8 h-8 border-2 border-border border-t-accent-success rounded-full animate-spin" />
                <p className="text-muted text-sm">Scanning for agents...</p>
              </div>
            )}

            {!loading && agents.length === 0 && (
              <Card className="text-center py-8">
                <Cpu size={32} className="text-muted mx-auto mb-3" />
                <p className="text-muted mb-4">No agents found for this passkey.</p>
                <Link href="/register">
                  <Button variant="primary">Register an Agent</Button>
                </Link>
              </Card>
            )}

            {renderAgentCards(agents, handlePasskeyRevoke, revoking, network)}
          </div>
        )
      ) : lookupMode === "wallet" ? (
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

            {renderAgentCards(agents, null, null, network)}
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

          {renderAgentCards(agents, null, null, network)}
        </div>
      )}
    </main>
  );
}

function renderAgentCards(
  agents: AgentEntry[],
  onRevoke: ((agentId: bigint) => void) | null,
  revokingId: string | null,
  network?: import("@/lib/network").NetworkConfig,
) {
  return agents.map((agent) => (
    <div key={agent.agentId.toString()} className="space-y-2">
      <Link
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
              {agent.guardian !== ethers.ZeroAddress && (
                <Badge variant="success">
                  <Fingerprint size={10} className="mr-1" />
                  Smart Wallet
                </Badge>
              )}
              {agent.hasA2ACard && (
                <Badge variant="info">A2A</Badge>
              )}
            </div>
            <div className="flex items-center gap-2">
              {agent.verificationStrength !== undefined && (
                <div className={`w-5 h-5 rounded-full flex items-center justify-center text-[9px] font-bold text-white ${
                  agent.verificationStrength >= 80 ? "bg-green-500" :
                  agent.verificationStrength >= 60 ? "bg-blue-500" :
                  agent.verificationStrength >= 40 ? "bg-amber-500" : "bg-gray-500"
                }`}>
                  {agent.verificationStrength}
                </div>
              )}
              <Badge variant={agent.isVerified ? "success" : "error"}>
                {agent.isVerified ? "Verified" : "Revoked"}
              </Badge>
            </div>
          </div>

          <div className="space-y-1">
            <p className="text-xs text-muted">
              {agent.mode === "simple" ? "Wallet" : "Agent"} Address
            </p>
            <p className="font-mono text-sm break-all">
              {agent.agentAddress}
            </p>
          </div>

          {agent.credentials && (
            <div className="flex flex-wrap gap-1.5 mt-2">
              {buildDisclosureBadges(agent.credentials).map((badge, i) => (
                <span
                  key={i}
                  className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-accent/10 text-accent border border-accent/20"
                >
                  {badge}
                </span>
              ))}
            </div>
          )}

          <div className="flex items-center gap-3 mt-2">
            {agent.guardian !== ethers.ZeroAddress && (
              <span className="flex items-center gap-1 text-xs text-muted">
                <Shield size={12} /> Guardian: {agent.guardian.slice(0, 6)}...{agent.guardian.slice(-4)}
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

      {onRevoke && agent.isVerified && agent.guardian !== ethers.ZeroAddress && (
        isGaslessSupported(network) ? (
          <button
            onClick={() => onRevoke(agent.agentId)}
            disabled={revokingId === agent.agentId.toString()}
            className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium bg-accent-error/10 text-accent-error border border-accent-error/20 hover:bg-accent-error/20 transition-colors disabled:opacity-50"
          >
            {revokingId === agent.agentId.toString() ? (
              <>
                <Loader2 size={12} className="animate-spin" />
                Revoking...
              </>
            ) : (
              <>
                <Fingerprint size={12} />
                Revoke with Passkey (gasless)
              </>
            )}
          </button>
        ) : (
          <p className="text-xs text-subtle px-1">
            Gasless revocation available on mainnet. On testnet, use the{" "}
            <Link href={`/verify?key=${encodeURIComponent(agent.agentKey)}`} className="text-accent underline">
              Verify page
            </Link>{" "}
            to deregister via passport scan.
          </p>
        )
      )}
    </div>
  ));
}
