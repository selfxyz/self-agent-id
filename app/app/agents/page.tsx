"use client";

import React, { useState, useEffect } from "react";
import Link from "next/link";
import { ethers } from "ethers";
import {
  Wallet,
  RefreshCw,
  Cpu,
  Shield,
  FileText,
  Search,
  Key,
  Fingerprint,
  Loader2,
} from "lucide-react";
import { PrivyIcon } from "@/components/PrivyIcon";
import { connectWallet } from "@/lib/wallet";
import {} from "@/lib/constants";
import { useNetwork } from "@/lib/NetworkContext";
import { Card } from "@/components/Card";
import { Badge } from "@/components/Badge";
import { Button } from "@/components/Button";
import { StatusDot } from "@/components/StatusDot";
import {
  signInWithPasskey,
  sendUserOperation,
  encodeGuardianRevoke,
  isPasskeySupported,
  isGaslessSupported,
} from "@/lib/aa";
import { usePrivyState, isPrivyConfigured } from "@/lib/privy";

import {
  typedProvider,
  typedRegistry,
  type TypedRegistryContract,
} from "@/lib/contract-types";
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

function cleanStr(s: string): string {
  return s.replace(/[\x00-\x1f]/g, "").trim();
}

async function fetchCredentials(
  registry: TypedRegistryContract,
  agentId: bigint,
): Promise<AgentCredentials | undefined> {
  try {
    const raw = await registry.getAgentCredentials(agentId);
    const creds: AgentCredentials = {
      issuingState: raw.issuingState || "",
      nationality: raw.nationality || "",
      olderThan: raw.olderThan ?? 0n,
      ofac: raw.ofac || [false, false, false],
    };
    if (
      cleanStr(creds.nationality) ||
      cleanStr(creds.issuingState) ||
      creds.olderThan > 0n ||
      creds.ofac?.some(Boolean)
    ) {
      return creds;
    }
  } catch {
    // Contract without getAgentCredentials
  }
  return undefined;
}

async function fetchVerificationStrength(
  registry: TypedRegistryContract,
  agentId: bigint,
  provider: ethers.JsonRpcProvider,
): Promise<{ strength?: number; hasA2ACard: boolean }> {
  let strength: number | undefined;
  let hasA2ACard = false;
  try {
    const provAddr: string = await registry.agentProofProvider(agentId);
    if (provAddr && provAddr !== ethers.ZeroAddress) {
      const prov = typedProvider(provAddr, provider);
      const s: number = await prov.verificationStrength();
      strength = Number(s);
    }
  } catch {}
  try {
    const metadata: string = await registry.getAgentMetadata(agentId);
    if (metadata) {
      const parsed = JSON.parse(metadata) as unknown;
      hasA2ACard =
        typeof parsed === "object" && parsed !== null && "a2aVersion" in parsed;
    }
  } catch {}
  return { strength, hasA2ACard };
}

/**
 * Paginated queryFilter to avoid eth_getLogs block-range limits on
 * RPC providers like Alchemy (free tier caps at 10-block ranges).
 * Scans backwards from latest block with adaptive window sizing —
 * starts at 50 000 blocks and halves on RPC block-range errors.
 */
async function paginatedQueryFilter(
  registry: TypedRegistryContract,
  filter: ethers.ContractEventName,
  provider: ethers.JsonRpcProvider,
  fromBlockFloor = 0,
): Promise<(ethers.EventLog | ethers.Log)[]> {
  const latestBlock = await provider.getBlockNumber();
  // Start from a reasonable deployment block to avoid scanning genesis.
  // SelfAgentRegistry was deployed well after block 30M on Celo mainnet.
  const deployBlock =
    fromBlockFloor > 0
      ? fromBlockFloor
      : latestBlock > 1_000_000
        ? latestBlock - 1_000_000
        : 0;
  let blockWindow = 50_000;
  const MIN_WINDOW = 10;
  const allEvents: (ethers.EventLog | ethers.Log)[] = [];

  let toBlock = latestBlock;
  while (toBlock >= deployBlock) {
    const fromBlock = Math.max(deployBlock, toBlock - blockWindow + 1);
    try {
      const events = await registry.queryFilter(filter, fromBlock, toBlock);
      allEvents.push(...events);
      toBlock = fromBlock - 1;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      // Detect RPC block-range limit errors and halve the window
      if (
        (msg.includes("block range") ||
          msg.includes("10 block range") ||
          msg.includes("Log response size exceeded") ||
          msg.includes("query returned more than")) &&
        blockWindow > MIN_WINDOW
      ) {
        blockWindow = Math.max(MIN_WINDOW, Math.floor(blockWindow / 2));
        continue; // retry same toBlock with smaller window
      }
      throw err;
    }
  }

  return allEvents;
}

async function buildAgentEntry(
  registry: TypedRegistryContract,
  provider: ethers.JsonRpcProvider,
  agentId: bigint,
  agentKey: string,
  ownerAddress: string,
): Promise<AgentEntry | null> {
  try {
    const isVerified: boolean = await registry.isVerifiedAgent(agentKey);
    const registeredAt: bigint = await registry.agentRegisteredAt(agentId);

    let guardian = ethers.ZeroAddress;
    let hasMetadata = false;
    try {
      guardian = await registry.agentGuardian(agentId);
      const metadata: string = await registry.getAgentMetadata(agentId);
      hasMetadata = metadata.length > 0;
    } catch {
      // V3 contract without guardian/metadata — ignore
    }

    const agentAddress = "0x" + agentKey.slice(26);

    let mode: "simple" | "advanced" | "walletfree" = "advanced";
    if (agentAddress.toLowerCase() === ownerAddress.toLowerCase()) {
      mode = guardian !== ethers.ZeroAddress ? "walletfree" : "simple";
    }

    const credentials = await fetchCredentials(registry, agentId);
    const { strength, hasA2ACard } = await fetchVerificationStrength(
      registry,
      agentId,
      provider,
    );

    return {
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
    };
  } catch {
    return null;
  }
}

function buildDisclosureBadges(creds: AgentCredentials): string[] {
  const badges: string[] = [];
  if (creds.olderThan > 0n) badges.push(`${creds.olderThan.toString()}+`);
  if (creds.ofac?.some(Boolean)) badges.push("Not on OFAC List");
  const nat = cleanStr(creds.nationality ?? "");
  if (nat) badges.push(nat);
  const issuing = cleanStr(creds.issuingState ?? "");
  if (issuing) badges.push(`Issued: ${issuing}`);
  return badges;
}

export default function MyAgentsPage() {
  const { network } = useNetwork();
  const [walletAddress, setWalletAddress] = useState<string | null>(null);
  const [agents, setAgents] = useState<AgentEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [lookupMode, setLookupMode] = useState<
    "wallet" | "key" | "passkey" | "privy"
  >("wallet");
  const [agentKeyInput, setAgentKeyInput] = useState("");
  const [passkeyAddress, setPasskeyAddress] = useState<string | null>(null);
  const [revoking, setRevoking] = useState<string | null>(null);
  const [passkeyAvailable, setPasskeyAvailable] = useState(false);
  const [privyConnectedAddress, setPrivyConnectedAddress] = useState<
    string | null
  >(null);

  const {
    login: privyLogin,
    ready: privyReady,
    authenticated: privyAuthenticated,
    wallets: privyWallets,
  } = usePrivyState();

  useEffect(() => {
    setPasskeyAvailable(isPasskeySupported());
  }, []);

  // Derive embedded wallet address (stable string or undefined).
  const privyEmbeddedAddress = privyAuthenticated
    ? privyWallets.find(
        (w: { walletClientType: string }) => w.walletClientType === "privy",
      )?.address
    : undefined;

  // After async Privy sign-in completes (user clicked "Sign in with Privy"),
  // detect the newly available embedded wallet and load agents once.
  // Guarded by privyConnectedAddress — once set, this never re-fires.
  useEffect(() => {
    if (
      lookupMode !== "privy" ||
      !privyEmbeddedAddress ||
      privyConnectedAddress
    )
      return;
    const addr = ethers.getAddress(privyEmbeddedAddress);
    setPrivyConnectedAddress(addr);
    void loadAgentsByOwner(addr);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [privyEmbeddedAddress]);

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
      const registry = typedRegistry(network.registryAddress, provider);

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
      const { strength, hasA2ACard } = await fetchVerificationStrength(
        registry,
        agentId,
        provider,
      );

      setAgents([
        {
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
        },
      ]);
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
      const registry = typedRegistry(network.registryAddress, provider);

      // Scan Transfer events to find all minted agents, then check if guardian matches
      const mintFilter = registry.filters.Transfer(ethers.ZeroAddress, null);
      const mintEvents = await paginatedQueryFilter(
        registry,
        mintFilter,
        provider,
        network.registryDeployBlock,
      );

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

          if (guardian.toLowerCase() !== guardianAddress.toLowerCase())
            continue;

          const agentKey: string = await registry.agentIdToAgentKey(agentId);
          const isVerified: boolean = await registry.isVerifiedAgent(agentKey);
          const registeredAt: bigint =
            await registry.agentRegisteredAt(agentId);
          const agentAddress = "0x" + agentKey.slice(26);

          let hasMetadata = false;
          try {
            const metadata: string = await registry.getAgentMetadata(agentId);
            hasMetadata = metadata.length > 0;
          } catch {}

          const credentials = await fetchCredentials(registry, agentId);
          const { strength, hasA2ACard } = await fetchVerificationStrength(
            registry,
            agentId,
            provider,
          );

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
      await sendUserOperation(
        network.registryAddress as `0x${string}`,
        callData,
        network,
      );

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
      const registry = typedRegistry(network.registryAddress, provider);

      const results: AgentEntry[] = [];

      // ── Fast path: check if this wallet has a simple-mode agent ──
      // Simple registration uses zeroPadValue(address, 32) as the agent key.
      // This avoids eth_getLogs entirely for the most common case.
      const simpleKey = ethers.zeroPadValue(ownerAddress, 32);
      const simpleAgentId: bigint = await registry.getAgentId(simpleKey);
      if (simpleAgentId !== 0n) {
        try {
          const currentOwner: string = await registry.ownerOf(simpleAgentId);
          if (currentOwner.toLowerCase() === ownerAddress.toLowerCase()) {
            const entry = await buildAgentEntry(
              registry,
              provider,
              simpleAgentId,
              simpleKey,
              ownerAddress,
            );
            if (entry) results.push(entry);
          }
        } catch {
          // burned or invalid — skip
        }
      }

      // ── Slow path: scan Transfer events for advanced-mode agents ──
      // Only needed if the wallet owns more tokens than we found above.
      const balance: bigint = await registry.balanceOf(ownerAddress);
      if (balance > BigInt(results.length)) {
        const mintFilter = registry.filters.Transfer(null, ownerAddress);
        const mintEvents = await paginatedQueryFilter(
          registry,
          mintFilter,
          provider,
        );

        const foundIds = new Set(results.map((r) => r.agentId));

        for (const event of mintEvents) {
          const log = event as ethers.EventLog;
          const agentId = log.args[2] as bigint;
          if (foundIds.has(agentId)) continue;

          try {
            const currentOwner: string = await registry.ownerOf(agentId);
            if (currentOwner.toLowerCase() !== ownerAddress.toLowerCase())
              continue;

            const agentKey: string = await registry.agentIdToAgentKey(agentId);
            const entry = await buildAgentEntry(
              registry,
              provider,
              agentId,
              agentKey,
              ownerAddress,
            );
            if (entry) results.push(entry);
          } catch {
            // Token was burned — skip
          }
        }
      }

      setAgents(results);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load agents");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="max-w-lg mx-auto">
      <h1 className="text-3xl font-bold text-center mb-2">My Agents</h1>
      <p className="text-muted text-center mb-8">
        View agents registered to your wallet, look up by key, sign in with a
        passkey, or use social login.
      </p>

      {/* Mode toggle */}
      <div className="flex justify-center gap-2 mb-6 flex-wrap">
        <button
          onClick={() => {
            setLookupMode("wallet");
            setAgents([]);
            setError("");
          }}
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
          onClick={() => {
            setLookupMode("key");
            setAgents([]);
            setError("");
          }}
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
            onClick={() => {
              setLookupMode("passkey");
              setAgents([]);
              setError("");
              setPasskeyAddress(null);
            }}
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
        {isPrivyConfigured() && (
          <button
            onClick={() => {
              setLookupMode("privy");
              setAgents([]);
              setError("");
              // If already authenticated, reload agents immediately
              if (privyConnectedAddress) {
                void loadAgentsByOwner(privyConnectedAddress);
              } else if (privyEmbeddedAddress) {
                // Already authenticated but address not captured yet
                const addr = ethers.getAddress(privyEmbeddedAddress);
                setPrivyConnectedAddress(addr);
                void loadAgentsByOwner(addr);
              }
            }}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
              lookupMode === "privy"
                ? "bg-surface-2 border border-purple-500 text-foreground"
                : "bg-surface-1 border border-border text-muted hover:text-foreground"
            }`}
          >
            <PrivyIcon size={16} />
            Social Login
          </button>
        )}
      </div>

      {lookupMode === "privy" ? (
        /* ── Privy (Social Login) mode ── */
        !privyConnectedAddress ? (
          <div className="flex flex-col items-center gap-4">
            <PrivyIcon size={32} />
            <Button
              onClick={() => privyLogin && privyLogin()}
              variant="primary"
              size="lg"
              disabled={loading || !privyReady || !privyLogin}
            >
              {loading ? (
                <>
                  <Loader2 size={18} className="animate-spin" />
                  Signing in...
                </>
              ) : (
                <>
                  <PrivyIcon size={18} />
                  Sign in with Privy
                </>
              )}
            </Button>
            <p className="text-xs text-subtle text-center max-w-xs">
              Sign in with email, Google, or Twitter to find agents owned by
              your Privy embedded wallet.
            </p>
            {error && (
              <p className="text-sm text-accent-error text-center max-w-xs">
                {error}
              </p>
            )}
          </div>
        ) : (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <p className="text-sm text-muted">
                Privy Wallet:{" "}
                <span className="font-mono text-foreground">
                  {privyConnectedAddress.slice(0, 6)}...
                  {privyConnectedAddress.slice(-4)}
                </span>
              </p>
              <button
                onClick={() => void loadAgentsByOwner(privyConnectedAddress)}
                disabled={loading}
                className="p-2 text-muted hover:text-foreground hover:bg-surface-2 rounded-lg transition-colors disabled:opacity-50"
                title="Refresh"
              >
                <RefreshCw
                  size={16}
                  className={loading ? "animate-spin" : ""}
                />
              </button>
            </div>

            {error && <p className="text-sm text-accent-error">{error}</p>}

            {loading && (
              <div className="flex flex-col items-center py-8 gap-3">
                <div className="w-8 h-8 border-2 border-border border-t-purple-500 rounded-full animate-spin" />
                <p className="text-muted text-sm">Scanning for agents...</p>
              </div>
            )}

            {!loading && agents.length === 0 && (
              <Card className="text-center py-8">
                <Cpu size={32} className="text-muted mx-auto mb-3" />
                <p className="text-muted mb-4">
                  No agents found for this Privy wallet.
                </p>
                <Link href="/agents/register">
                  <Button variant="primary">Register an Agent</Button>
                </Link>
              </Card>
            )}

            {renderAgentCards(agents, null, null, network)}
          </div>
        )
      ) : lookupMode === "passkey" ? (
        /* ── Passkey mode ── */
        !passkeyAddress ? (
          <div className="flex flex-col items-center gap-4">
            <Fingerprint size={32} className="text-accent-success" />
            <Button
              onClick={() => void handlePasskeySignIn()}
              variant="primary"
              size="lg"
              disabled={loading}
            >
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
              Uses your passkey (Face ID / fingerprint) to find agents where
              your smart wallet is the guardian.
            </p>
            {error && (
              <p className="text-sm text-accent-error text-center max-w-xs">
                {error}
              </p>
            )}
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
                onClick={() =>
                  passkeyAddress && void loadAgentsByGuardian(passkeyAddress)
                }
                disabled={loading}
                className="p-2 text-muted hover:text-foreground hover:bg-surface-2 rounded-lg transition-colors disabled:opacity-50"
                title="Refresh"
              >
                <RefreshCw
                  size={16}
                  className={loading ? "animate-spin" : ""}
                />
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
                <p className="text-muted mb-4">
                  No agents found for this passkey.
                </p>
                <Link href="/agents/register">
                  <Button variant="primary">Register an Agent</Button>
                </Link>
              </Card>
            )}

            {renderAgentCards(
              agents,
              (...args: Parameters<typeof handlePasskeyRevoke>) =>
                void handlePasskeyRevoke(...args),
              revoking,
              network,
            )}
          </div>
        )
      ) : lookupMode === "wallet" ? (
        /* ── Wallet mode ── */
        !walletAddress ? (
          <div className="flex flex-col items-center gap-4">
            <Wallet size={32} className="text-muted" />
            <Button
              onClick={() => void handleConnect()}
              variant="primary"
              size="lg"
            >
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
                onClick={() => void loadAgentsByOwner(walletAddress)}
                disabled={loading}
                className="p-2 text-muted hover:text-foreground hover:bg-surface-2 rounded-lg transition-colors disabled:opacity-50"
                title="Refresh"
              >
                <RefreshCw
                  size={16}
                  className={loading ? "animate-spin" : ""}
                />
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
                <p className="text-muted mb-4">
                  No agents found for this wallet.
                </p>
                <Link href="/agents/register">
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
              Enter your agent address to look it up on the registry. This is
              useful if you registered without a wallet (wallet-free mode).
            </p>
            <div className="flex gap-2">
              <input
                type="text"
                value={agentKeyInput}
                onChange={(e) => setAgentKeyInput(e.target.value)}
                placeholder="0x... (agent address)"
                className="flex-1 bg-surface-2 border border-border rounded-lg px-3 py-2 text-sm font-mono placeholder:text-subtle focus:border-accent focus:outline-none transition-colors"
                onKeyDown={(e) => {
                  if (e.key === "Enter") void handleKeyLookup();
                }}
              />
              <Button
                onClick={() => void handleKeyLookup()}
                variant="primary"
                size="sm"
                disabled={loading}
              >
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
              <p className="text-muted">
                Enter an agent address and click Look Up.
              </p>
            </Card>
          )}

          {renderAgentCards(agents, null, null, network)}
        </div>
      )}
    </div>
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
        href={`/agents/verify?key=${encodeURIComponent(agent.agentKey)}`}
        className="block"
      >
        <Card glow>
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              <StatusDot status={agent.isVerified ? "verified" : "revoked"} />
              <span className="font-medium">
                Agent #{agent.agentId.toString()}
              </span>
              <Badge
                variant={
                  agent.mode === "simple"
                    ? "muted"
                    : agent.mode === "advanced"
                      ? "success"
                      : "info"
                }
              >
                {agent.mode === "simple"
                  ? "Verified Wallet"
                  : agent.mode === "advanced"
                    ? "Agent Identity"
                    : "Wallet-Free"}
              </Badge>
              {agent.guardian !== ethers.ZeroAddress && (
                <Badge variant="success">
                  <Fingerprint size={10} className="mr-1" />
                  Smart Wallet
                </Badge>
              )}
              {agent.hasA2ACard && <Badge variant="info">A2A</Badge>}
            </div>
            <div className="flex items-center gap-2">
              {agent.verificationStrength !== undefined && (
                <div
                  className={`w-5 h-5 rounded-full flex items-center justify-center text-[9px] font-bold text-white ${
                    agent.verificationStrength >= 80
                      ? "bg-green-500"
                      : agent.verificationStrength >= 60
                        ? "bg-blue-500"
                        : agent.verificationStrength >= 40
                          ? "bg-amber-500"
                          : "bg-gray-500"
                  }`}
                >
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
            <p className="font-mono text-sm break-all">{agent.agentAddress}</p>
          </div>

          {agent.credentials &&
            buildDisclosureBadges(agent.credentials).length > 0 && (
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
                <Shield size={12} /> Guardian: {agent.guardian.slice(0, 6)}...
                {agent.guardian.slice(-4)}
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

      {onRevoke &&
        agent.isVerified &&
        agent.guardian !== ethers.ZeroAddress &&
        (isGaslessSupported(network) ? (
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
            <Link
              href={`/agents/verify?key=${encodeURIComponent(agent.agentKey)}`}
              className="text-accent underline"
            >
              Verify page
            </Link>{" "}
            to deregister via passport scan.
          </p>
        ))}
    </div>
  ));
}
