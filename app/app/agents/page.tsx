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
  Bot,
  Clock,
  AlertTriangle,
  Users,
  X,
} from "lucide-react";
import dynamic from "next/dynamic";
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
import { writeAgentCard } from "@/lib/writeAgentCard";

import {
  typedProvider,
  typedRegistry,
  type TypedRegistryContract,
} from "@/lib/contract-types";
import type { NetworkConfig } from "@/lib/network";

// Dynamic import to avoid SSR issues with Self QR SDK
const SelfQRcodeWrapper = dynamic(
  () => import("@selfxyz/qrcode").then((mod) => mod.SelfQRcodeWrapper),
  { ssr: false },
);
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
  mode: "self-custody" | "linked" | "walletfree";
  guardian: string;
  hasMetadata: boolean;
  hasA2ACard: boolean;
  verificationStrength?: number;
  credentials?: AgentCredentials;
  proofExpiresAt?: number; // unix timestamp (seconds)
  isProofFresh?: boolean;
  daysUntilExpiry?: number;
  isExpiringSoon?: boolean; // true when <= 30 days remain
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

    let mode: "self-custody" | "linked" | "walletfree" = "linked";
    if (agentAddress.toLowerCase() === ownerAddress.toLowerCase()) {
      mode = guardian !== ethers.ZeroAddress ? "walletfree" : "self-custody";
    }

    const credentials = await fetchCredentials(registry, agentId);
    const { strength, hasA2ACard } = await fetchVerificationStrength(
      registry,
      agentId,
      provider,
    );
    const expiryData = await fetchExpiryData(registry, agentId);

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
      ...expiryData,
    };
  } catch {
    return null;
  }
}

/** Fetch proof expiry data for an agent. */
async function fetchExpiryData(
  registry: TypedRegistryContract,
  agentId: bigint,
): Promise<{
  proofExpiresAt?: number;
  isProofFresh?: boolean;
  daysUntilExpiry?: number;
  isExpiringSoon?: boolean;
}> {
  try {
    const [expiryTs, fresh] = await Promise.all([
      registry.proofExpiresAt(agentId),
      registry.isProofFresh(agentId),
    ]);
    const expiryNum = Number(expiryTs);
    if (expiryNum === 0) return {};
    const nowSec = Math.floor(Date.now() / 1000);
    const daysUntilExpiry = Math.max(
      0,
      Math.floor((expiryNum - nowSec) / 86400),
    );
    return {
      proofExpiresAt: expiryNum,
      isProofFresh: fresh,
      daysUntilExpiry,
      isExpiringSoon: fresh && daysUntilExpiry <= 30,
    };
  } catch {
    return {};
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
    "wallet" | "key" | "passkey" | "privy" | "passport"
  >("wallet");
  const [agentKeyInput, setAgentKeyInput] = useState("");
  const [passkeyAddress, setPasskeyAddress] = useState<string | null>(null);
  const [revoking, setRevoking] = useState<string | null>(null);
  const [passkeyAvailable, setPasskeyAvailable] = useState(false);
  const [privyConnectedAddress, setPrivyConnectedAddress] = useState<
    string | null
  >(null);
  const [mintingCardFor, setMintingCardFor] = useState<string | null>(null);
  // Task 18: Nullifier-based sibling lookup
  const [siblingAgents, setSiblingAgents] = useState<AgentEntry[]>([]);
  const [loadingSiblings, setLoadingSiblings] = useState(false);
  const [siblingSourceAgentId, setSiblingSourceAgentId] = useState<
    string | null
  >(null);
  // Task 19: Proof refresh
  const [refreshingAgentId, setRefreshingAgentId] = useState<string | null>(
    null,
  );
  const [refreshQrData, setRefreshQrData] = useState<unknown>(null);
  const [refreshDeepLink, setRefreshDeepLink] = useState<string | null>(null);
  const [_refreshSessionToken, setRefreshSessionToken] = useState<
    string | null
  >(null);
  const [refreshPolling, setRefreshPolling] = useState(false);
  const refreshPollRef = React.useRef<ReturnType<typeof setInterval> | null>(
    null,
  );
  // Passport scan (identify) flow
  const [identifyQrData, setIdentifyQrData] = useState<unknown>(null);
  const [_identifySessionToken, setIdentifySessionToken] = useState<
    string | null
  >(null);
  const [identifyPolling, setIdentifyPolling] = useState(false);
  const identifyPollRef = React.useRef<ReturnType<typeof setInterval> | null>(
    null,
  );

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

      let mode: "self-custody" | "linked" | "walletfree" = "linked";
      if (agentAddress.toLowerCase() === currentOwner.toLowerCase()) {
        mode = guardian !== ethers.ZeroAddress ? "walletfree" : "self-custody";
      }

      const credentials = await fetchCredentials(registry, agentId);
      const { strength, hasA2ACard } = await fetchVerificationStrength(
        registry,
        agentId,
        provider,
      );
      const expiryData = await fetchExpiryData(registry, agentId);

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
          ...expiryData,
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
          const expiryData = await fetchExpiryData(registry, agentId);

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
            ...expiryData,
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

  const handleMintCard = async (agent: AgentEntry) => {
    setMintingCardFor(agent.agentId.toString());
    setError("");

    try {
      let signer: ethers.Signer;

      if (lookupMode === "privy") {
        // Privy embedded wallet — use window.ethereum if available
        if (!window.ethereum) {
          setError("No wallet available for signing. Try Connect Wallet mode.");
          return;
        }
        const provider = new ethers.BrowserProvider(
          window.ethereum as unknown as ethers.Eip1193Provider,
        );
        signer = await provider.getSigner();
      } else {
        // Wallet mode — use MetaMask / injected wallet
        const provider = new ethers.BrowserProvider(
          window.ethereum! as unknown as ethers.Eip1193Provider,
        );
        signer = await provider.getSigner();
      }

      await writeAgentCard(
        agent.agentId,
        network.registryAddress,
        network,
        signer,
      );

      // Refresh the agent list to show the new A2A badge
      const ownerAddr = walletAddress ?? privyConnectedAddress;
      if (ownerAddr) {
        await loadAgentsByOwner(ownerAddr);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to mint A2A card");
    } finally {
      setMintingCardFor(null);
    }
  };

  // Cleanup polling on unmount
  useEffect(() => {
    return () => {
      if (refreshPollRef.current) clearInterval(refreshPollRef.current);
      if (identifyPollRef.current) clearInterval(identifyPollRef.current);
    };
  }, []);

  // Task 18: Load all agents for the same human identity (nullifier)
  const handleShowSiblings = async (agentId: bigint) => {
    setLoadingSiblings(true);
    setSiblingAgents([]);
    setSiblingSourceAgentId(agentId.toString());
    setError("");

    try {
      const provider = new ethers.JsonRpcProvider(network.rpcUrl);
      const registry = typedRegistry(network.registryAddress, provider);

      const nullifier = await registry.getHumanNullifier(agentId);
      if (nullifier === 0n) {
        setError("No human nullifier found for this agent.");
        setLoadingSiblings(false);
        return;
      }

      const siblingIds = await registry.getAgentsForNullifier(nullifier);
      const results: AgentEntry[] = [];

      for (const sibId of siblingIds) {
        // Skip the source agent itself
        if (sibId === agentId) continue;
        try {
          const agentKey = await registry.agentIdToAgentKey(sibId);
          const ownerAddr = await registry.ownerOf(sibId);
          const entry = await buildAgentEntry(
            registry,
            provider,
            sibId,
            agentKey,
            ownerAddr,
          );
          if (entry) results.push(entry);
        } catch {
          // burned or invalid — skip
        }
      }

      setSiblingAgents(results);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to look up sibling agents",
      );
    } finally {
      setLoadingSiblings(false);
    }
  };

  // Task 19: Initiate proof refresh
  const handleRefreshProof = async (agentId: number) => {
    setRefreshingAgentId(agentId.toString());
    setRefreshQrData(null);
    setRefreshDeepLink(null);
    setRefreshSessionToken(null);
    setRefreshPolling(false);
    if (refreshPollRef.current) clearInterval(refreshPollRef.current);
    setError("");

    try {
      const networkName = network.isTestnet ? "testnet" : "mainnet";
      const resp = await fetch("/api/agent/refresh", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ agentId, network: networkName }),
      });

      if (!resp.ok) {
        const data = (await resp.json()) as { error?: string };
        throw new Error(data.error || `Refresh failed (${resp.status})`);
      }

      const data = (await resp.json()) as {
        sessionToken: string;
        qrData: unknown;
        deepLink: string;
      };

      setRefreshQrData(data.qrData);
      setRefreshDeepLink(data.deepLink);
      setRefreshSessionToken(data.sessionToken);
      setRefreshPolling(true);

      // Start polling for completion
      const pollInterval = setInterval(() => {
        void (async () => {
          try {
            const statusResp = await fetch(
              `/api/agent/refresh/status?sessionToken=${encodeURIComponent(data.sessionToken)}`,
            );
            if (!statusResp.ok) return;

            const statusData = (await statusResp.json()) as {
              stage: string;
              sessionToken?: string;
            };

            // Update session token if rotated
            if (statusData.sessionToken) {
              data.sessionToken = statusData.sessionToken;
            }

            if (statusData.stage === "completed") {
              clearInterval(pollInterval);
              refreshPollRef.current = null;
              setRefreshPolling(false);
              setRefreshQrData(null);
              setRefreshDeepLink(null);
              setRefreshSessionToken(null);
              setRefreshingAgentId(null);

              // Refresh agent data
              const ownerAddr = walletAddress ?? privyConnectedAddress;
              if (ownerAddr) {
                await loadAgentsByOwner(ownerAddr);
              } else if (passkeyAddress) {
                await loadAgentsByGuardian(passkeyAddress);
              }
            } else if (statusData.stage === "failed") {
              clearInterval(pollInterval);
              refreshPollRef.current = null;
              setRefreshPolling(false);
              setError("Proof refresh failed. Please try again.");
              setRefreshingAgentId(null);
            }
          } catch {
            // Silently retry on network errors
          }
        })();
      }, 3000);

      refreshPollRef.current = pollInterval;
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to initiate proof refresh",
      );
      setRefreshingAgentId(null);
    }
  };

  const handleCloseRefresh = () => {
    if (refreshPollRef.current) {
      clearInterval(refreshPollRef.current);
      refreshPollRef.current = null;
    }
    setRefreshingAgentId(null);
    setRefreshQrData(null);
    setRefreshDeepLink(null);
    setRefreshSessionToken(null);
    setRefreshPolling(false);
  };

  // Passport scan (identify) flow
  const handleStartIdentify = async () => {
    setIdentifyQrData(null);
    setIdentifySessionToken(null);
    setIdentifyPolling(false);
    if (identifyPollRef.current) clearInterval(identifyPollRef.current);
    setAgents([]);
    setError("");
    setLoading(true);

    try {
      const networkName = network.isTestnet ? "testnet" : "mainnet";
      const resp = await fetch("/api/agent/identify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ network: networkName }),
      });

      if (!resp.ok) {
        const data = (await resp.json()) as { error?: string };
        throw new Error(data.error || `Identify failed (${resp.status})`);
      }

      const data = (await resp.json()) as {
        sessionToken: string;
        qrData: unknown;
        deepLink: string;
      };

      setIdentifyQrData(data.qrData);
      setIdentifySessionToken(data.sessionToken);
      setIdentifyPolling(true);
      setLoading(false);

      // Poll for NullifierIdentified event
      let currentToken = data.sessionToken;
      const pollInterval = setInterval(() => {
        void (async () => {
          try {
            const statusResp = await fetch(
              `/api/agent/identify/status?sessionToken=${encodeURIComponent(currentToken)}`,
            );
            if (!statusResp.ok) return;

            const statusData = (await statusResp.json()) as {
              stage: string;
              sessionToken?: string;
              nullifier?: string;
              agentCount?: number;
            };

            if (statusData.sessionToken) {
              currentToken = statusData.sessionToken;
            }

            if (statusData.stage === "completed" && statusData.nullifier) {
              clearInterval(pollInterval);
              identifyPollRef.current = null;
              setIdentifyPolling(false);
              setIdentifyQrData(null);
              setIdentifySessionToken(null);

              // Load all agents for this nullifier
              await loadAgentsByNullifier(BigInt(statusData.nullifier));
            }
          } catch {
            // Silently retry on network errors
          }
        })();
      }, 3000);

      identifyPollRef.current = pollInterval;
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to start passport scan",
      );
      setLoading(false);
    }
  };

  const handleCloseIdentify = () => {
    if (identifyPollRef.current) {
      clearInterval(identifyPollRef.current);
      identifyPollRef.current = null;
    }
    setIdentifyQrData(null);
    setIdentifySessionToken(null);
    setIdentifyPolling(false);
  };

  const loadAgentsByNullifier = async (nullifier: bigint) => {
    setLoading(true);
    setAgents([]);
    setError("");

    try {
      const provider = new ethers.JsonRpcProvider(network.rpcUrl);
      const registry = typedRegistry(network.registryAddress, provider);

      const agentIds = await registry.getAgentsForNullifier(nullifier);
      if (agentIds.length === 0) {
        setError("No agents found for this identity.");
        setLoading(false);
        return;
      }

      const results: AgentEntry[] = [];
      for (const agentId of agentIds) {
        try {
          const agentKey = await registry.agentIdToAgentKey(agentId);
          const ownerAddr = await registry.ownerOf(agentId);
          const entry = await buildAgentEntry(
            registry,
            provider,
            agentId,
            agentKey,
            ownerAddr,
          );
          if (entry) results.push(entry);
        } catch {
          // burned or invalid — skip
        }
      }

      setAgents(results);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Failed to load agents by nullifier",
      );
    } finally {
      setLoading(false);
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

  // Common extra args for renderAgentCards
  const cardExtras = {
    onShowSiblings: (id: bigint) => void handleShowSiblings(id),
    loadingSiblings,
    siblingSourceAgentId,
    onRefreshProof: (id: number) => void handleRefreshProof(id),
    refreshingAgentId,
  };

  // Shared panels rendered after agent cards in any mode
  const sharedPanels = (
    <>
      {/* Task 18: Sibling agents panel */}
      {siblingSourceAgentId && (
        <SiblingAgentsPanel
          siblingAgents={siblingAgents}
          loading={loadingSiblings}
          sourceAgentId={siblingSourceAgentId}
          onClose={() => {
            setSiblingAgents([]);
            setSiblingSourceAgentId(null);
          }}
          network={network}
        />
      )}

      {/* Task 19: Refresh QR modal */}
      {refreshingAgentId && refreshQrData && (
        <RefreshQrModal
          agentId={refreshingAgentId}
          qrData={refreshQrData}
          deepLink={refreshDeepLink}
          polling={refreshPolling}
          onClose={handleCloseRefresh}
        />
      )}
    </>
  );

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
        <button
          onClick={() => {
            setLookupMode("passport");
            setError("");
            handleCloseIdentify();
          }}
          className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
            lookupMode === "passport"
              ? "bg-surface-2 border border-accent-success text-foreground"
              : "bg-surface-1 border border-border text-muted hover:text-foreground"
          }`}
        >
          <Shield size={16} />
          Scan Passport
        </button>
      </div>

      {lookupMode === "passport" ? (
        /* ── Passport scan (identify) mode ── */
        identifyQrData ? (
          <div className="space-y-4">
            <Card className="text-center">
              <Shield size={32} className="text-accent-success mx-auto mb-3" />
              <h3 className="text-lg font-semibold mb-2">Scan Your Passport</h3>
              <p className="text-sm text-muted mb-4">
                Scan the QR code with the Self app to identify yourself via
                passport. This will find all agents registered to your identity.
              </p>
              <div className="flex justify-center mb-4">
                <SelfQRcodeWrapper
                  // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment
                  selfApp={identifyQrData as any}
                  size={200}
                  onSuccess={() => {
                    // Status polling handles completion
                  }}
                  onError={(data: { error_code?: string; reason?: string }) => {
                    setError(
                      data.reason || data.error_code || "Passport scan failed",
                    );
                    handleCloseIdentify();
                  }}
                />
              </div>
              {identifyPolling && (
                <div className="flex items-center justify-center gap-2 text-sm text-muted">
                  <Loader2 size={14} className="animate-spin" />
                  Waiting for passport verification...
                </div>
              )}
              <Button
                variant="ghost"
                size="sm"
                onClick={handleCloseIdentify}
                className="mt-3"
              >
                <X size={14} />
                Cancel
              </Button>
            </Card>
          </div>
        ) : (
          <div className="space-y-4">
            {!loading && agents.length === 0 ? (
              <div className="flex flex-col items-center gap-4">
                <Shield size={32} className="text-accent-success" />
                <Button
                  onClick={() => void handleStartIdentify()}
                  variant="primary"
                  size="lg"
                  disabled={loading}
                >
                  {loading ? (
                    <>
                      <Loader2 size={18} className="animate-spin" />
                      Starting...
                    </>
                  ) : (
                    <>
                      <Shield size={18} />
                      Scan Passport to Find Agents
                    </>
                  )}
                </Button>
                <p className="text-xs text-subtle text-center max-w-xs">
                  Uses your passport to find all agents registered to your
                  identity, including Ed25519 and wallet-free agents. No data is
                  stored — only a privacy-preserving nullifier is used.
                </p>
              </div>
            ) : (
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <p className="text-sm text-muted">
                    <Shield size={14} className="inline mr-1" />
                    Agents found via passport scan
                  </p>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => void handleStartIdentify()}
                    disabled={loading}
                  >
                    <RefreshCw
                      size={14}
                      className={loading ? "animate-spin" : ""}
                    />
                    Rescan
                  </Button>
                </div>

                {loading && (
                  <div className="flex flex-col items-center py-8 gap-3">
                    <div className="w-8 h-8 border-2 border-border border-t-accent-success rounded-full animate-spin" />
                    <p className="text-muted text-sm">Loading agents...</p>
                  </div>
                )}

                {renderAgentCards(
                  agents,
                  null,
                  null,
                  network,
                  (agent: AgentEntry) => void handleMintCard(agent),
                  mintingCardFor,
                  "passport",
                  cardExtras,
                )}
                {sharedPanels}
              </div>
            )}

            {error && <p className="text-sm text-accent-error">{error}</p>}
          </div>
        )
      ) : lookupMode === "privy" ? (
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

            {renderAgentCards(
              agents,
              null,
              null,
              network,
              (agent: AgentEntry) => void handleMintCard(agent),
              mintingCardFor,
              lookupMode,
              cardExtras,
            )}
            {sharedPanels}
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
              undefined,
              undefined,
              undefined,
              cardExtras,
            )}
            {sharedPanels}
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

            {renderAgentCards(
              agents,
              null,
              null,
              network,
              (agent: AgentEntry) => void handleMintCard(agent),
              mintingCardFor,
              lookupMode,
              cardExtras,
            )}
            {sharedPanels}
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

          {renderAgentCards(
            agents,
            null,
            null,
            network,
            undefined,
            undefined,
            undefined,
            cardExtras,
          )}
          {sharedPanels}
        </div>
      )}
    </div>
  );
}

/** Format a unix timestamp (seconds) to a short date string. */
function formatExpiryDate(ts: number): string {
  return new Date(ts * 1000).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

interface CardExtras {
  onShowSiblings: (agentId: bigint) => void;
  loadingSiblings: boolean;
  siblingSourceAgentId: string | null;
  onRefreshProof: (agentId: number) => void;
  refreshingAgentId: string | null;
}

function renderAgentCards(
  agents: AgentEntry[],
  onRevoke: ((agentId: bigint) => void) | null,
  revokingId: string | null,
  network?: NetworkConfig,
  onMintCard?: ((agent: AgentEntry) => void) | null,
  mintingCardForId?: string | null,
  lookupMode?: "wallet" | "key" | "passkey" | "privy" | "passport",
  extras?: CardExtras,
) {
  return agents.map((agent) => (
    <div key={agent.agentId.toString()} className="space-y-2">
      <Link
        href={`/agents/verify?key=${encodeURIComponent(agent.agentKey)}`}
        className="block"
      >
        <Card glow>
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2 flex-wrap">
              <StatusDot status={agent.isVerified ? "verified" : "revoked"} />
              <span className="font-medium">
                Agent #{agent.agentId.toString()}
              </span>
              <Badge
                variant={
                  agent.mode === "self-custody"
                    ? "muted"
                    : agent.mode === "linked"
                      ? "success"
                      : "info"
                }
              >
                {agent.mode === "self-custody"
                  ? "Direct Ownership"
                  : agent.mode === "linked"
                    ? "Linked Agent"
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

          {/* Task 17: Expiry status badge */}
          {agent.proofExpiresAt != null && agent.proofExpiresAt > 0 && (
            <div className="mb-2">
              {agent.isProofFresh && !agent.isExpiringSoon && (
                <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium bg-green-500/10 text-green-500 border border-green-500/20">
                  <Shield size={10} />
                  Verified — expires {formatExpiryDate(agent.proofExpiresAt)}
                </span>
              )}
              {agent.isExpiringSoon && agent.isProofFresh && (
                <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium bg-amber-500/10 text-amber-500 border border-amber-500/20">
                  <AlertTriangle size={10} />
                  Expiring in {agent.daysUntilExpiry} day
                  {agent.daysUntilExpiry !== 1 ? "s" : ""}
                </span>
              )}
              {!agent.isProofFresh && (
                <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium bg-red-500/10 text-red-500 border border-red-500/20">
                  <Clock size={10} />
                  Expired {formatExpiryDate(agent.proofExpiresAt)}
                </span>
              )}
            </div>
          )}

          <div className="space-y-1">
            <p className="text-xs text-muted">
              {agent.mode === "self-custody" ? "Wallet" : "Agent"} Address
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

      {/* Action buttons row */}
      <div className="flex flex-wrap gap-2">
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

        {onMintCard &&
          agent.isVerified &&
          !agent.hasA2ACard &&
          (lookupMode === "wallet" || lookupMode === "privy") && (
            <button
              onClick={() => onMintCard(agent)}
              disabled={mintingCardForId === agent.agentId.toString()}
              className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium bg-accent/10 text-accent border border-accent/20 hover:bg-accent/20 transition-colors disabled:opacity-50"
            >
              {mintingCardForId === agent.agentId.toString() ? (
                <>
                  <Loader2 size={12} className="animate-spin" />
                  Minting A2A Card...
                </>
              ) : (
                <>
                  <Bot size={12} />
                  Mint A2A Card (on-chain)
                </>
              )}
            </button>
          )}

        {/* Task 18: Show siblings button */}
        {extras && agent.isVerified && (
          <button
            onClick={(e) => {
              e.preventDefault();
              extras.onShowSiblings(agent.agentId);
            }}
            disabled={
              extras.loadingSiblings &&
              extras.siblingSourceAgentId === agent.agentId.toString()
            }
            className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium bg-purple-500/10 text-purple-500 border border-purple-500/20 hover:bg-purple-500/20 transition-colors disabled:opacity-50"
          >
            {extras.loadingSiblings &&
            extras.siblingSourceAgentId === agent.agentId.toString() ? (
              <>
                <Loader2 size={12} className="animate-spin" />
                Looking up...
              </>
            ) : (
              <>
                <Users size={12} />
                Show all agents for this identity
              </>
            )}
          </button>
        )}

        {/* Task 19: Re-verify button for expiring/expired proofs */}
        {extras &&
          (agent.isExpiringSoon || !agent.isProofFresh) &&
          agent.proofExpiresAt != null &&
          agent.proofExpiresAt > 0 && (
            <button
              onClick={(e) => {
                e.preventDefault();
                extras.onRefreshProof(Number(agent.agentId));
              }}
              disabled={extras.refreshingAgentId === agent.agentId.toString()}
              className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium bg-blue-600/10 text-blue-500 border border-blue-500/20 hover:bg-blue-600/20 transition-colors disabled:opacity-50"
            >
              {extras.refreshingAgentId === agent.agentId.toString() ? (
                <>
                  <Loader2 size={12} className="animate-spin" />
                  Initiating...
                </>
              ) : (
                <>
                  <RefreshCw size={12} />
                  Re-verify
                </>
              )}
            </button>
          )}
      </div>
    </div>
  ));
}

/** Task 18: Panel showing all agents belonging to the same human. */
function SiblingAgentsPanel({
  siblingAgents,
  loading,
  sourceAgentId,
  onClose,
  network: _network,
}: {
  siblingAgents: AgentEntry[];
  loading: boolean;
  sourceAgentId: string;
  onClose: () => void;
  network: NetworkConfig;
}) {
  return (
    <Card className="mt-4">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Users size={16} className="text-purple-500" />
          <span className="text-sm font-medium">
            All agents for the same human (from Agent #{sourceAgentId})
          </span>
        </div>
        <button
          onClick={onClose}
          className="p-1 text-muted hover:text-foreground rounded transition-colors"
        >
          <X size={14} />
        </button>
      </div>

      {loading && (
        <div className="flex items-center gap-2 py-4 justify-center">
          <Loader2 size={16} className="animate-spin text-purple-500" />
          <span className="text-sm text-muted">Loading sibling agents...</span>
        </div>
      )}

      {!loading && siblingAgents.length === 0 && (
        <p className="text-sm text-muted text-center py-4">
          No other agents found for this identity. This is the only registered
          agent.
        </p>
      )}

      {!loading && siblingAgents.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs text-muted mb-2">
            Found {siblingAgents.length} other agent
            {siblingAgents.length !== 1 ? "s" : ""} registered by the same
            human:
          </p>
          {siblingAgents.map((agent) => (
            <Link
              key={agent.agentId.toString()}
              href={`/agents/verify?key=${encodeURIComponent(agent.agentKey)}`}
              className="block"
            >
              <div className="flex items-center justify-between p-3 rounded-lg bg-surface-2 border border-border hover:border-purple-500/30 transition-colors">
                <div className="flex items-center gap-2">
                  <StatusDot
                    status={agent.isVerified ? "verified" : "revoked"}
                  />
                  <span className="text-sm font-medium">
                    Agent #{agent.agentId.toString()}
                  </span>
                  <span className="text-xs text-muted font-mono">
                    {agent.agentAddress.slice(0, 6)}...
                    {agent.agentAddress.slice(-4)}
                  </span>
                </div>
                <Badge variant={agent.isVerified ? "success" : "error"}>
                  {agent.isVerified ? "Verified" : "Revoked"}
                </Badge>
              </div>
            </Link>
          ))}
        </div>
      )}
    </Card>
  );
}

/** Task 19: Modal/section for proof refresh QR code. */
function RefreshQrModal({
  agentId,
  qrData,
  deepLink,
  polling,
  onClose,
}: {
  agentId: string;
  qrData: unknown;
  deepLink: string | null;
  polling: boolean;
  onClose: () => void;
}) {
  return (
    <Card className="mt-4">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <RefreshCw size={16} className="text-blue-500" />
          <span className="text-sm font-medium">
            Re-verify Agent #{agentId}
          </span>
        </div>
        <button
          onClick={onClose}
          className="p-1 text-muted hover:text-foreground rounded transition-colors"
        >
          <X size={14} />
        </button>
      </div>

      <p className="text-xs text-muted mb-3">
        Scan the QR code with the Self app to refresh your human proof. Follow
        the prompts to scan your passport.
      </p>

      <div className="flex flex-col items-center gap-3">
        <div className="rounded-xl p-4 bg-white">
          <SelfQRcodeWrapper
            // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment
            selfApp={qrData as any}
            onSuccess={() => {
              // Status polling handles completion
            }}
            onError={() => {
              // Errors handled by polling
            }}
          />
        </div>

        {deepLink && (
          <a
            href={deepLink}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium bg-blue-600 text-white hover:bg-blue-700 transition-colors"
          >
            Open Self App
          </a>
        )}

        {polling && (
          <div className="flex items-center gap-2 text-sm text-muted">
            <Loader2 size={14} className="animate-spin" />
            Waiting for proof refresh...
          </div>
        )}
      </div>
    </Card>
  );
}
