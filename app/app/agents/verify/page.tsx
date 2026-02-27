"use client";

import React, {
  Suspense,
  useState,
  useEffect,
  useCallback,
  useMemo,
} from "react";
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
  ChevronDown,
  ChevronUp,
  Shield,
  FileText,
  Fingerprint,
  Loader2,
  Copy,
  Check,
} from "lucide-react";
import CodeBlock from "@/components/CodeBlock";
import {
  getServiceSnippets,
  getAgentSnippets,
  SERVICE_FEATURES,
  AGENT_FEATURES,
} from "@/lib/snippets";
import { connectWallet } from "@/lib/wallet";
import {} from "@/lib/constants";
import type { A2AAgentCard } from "@selfxyz/agent-sdk";
import { useNetwork } from "@/lib/NetworkContext";
import { Card } from "@/components/Card";
import { Badge } from "@/components/Badge";
import { Button } from "@/components/Button";
import {
  sendUserOperation,
  encodeGuardianRevoke,
  isPasskeySupported,
  isGaslessSupported,
} from "@/lib/aa";

import { getPasskey } from "@/lib/passkey-storage";

import { typedProvider, typedRegistry } from "@/lib/contract-types";
const SelfQRcodeWrapper = dynamic(
  () => import("@selfxyz/qrcode").then((mod) => mod.SelfQRcodeWrapper),
  { ssr: false },
);

let SelfAppBuilder: typeof import("@selfxyz/qrcode").SelfAppBuilder;

interface AgentCredentials {
  issuingState: string;
  name: string[];
  idNumber: string;
  nationality: string;
  dateOfBirth: string;
  gender: string;
  expiryDate: string;
  olderThan: bigint;
  ofac: boolean[];
}

interface AgentInfo {
  isVerified: boolean;
  agentId: bigint;
  owner: string;
  registeredAt: bigint;
  guardian: string;
  metadata: string;
  mode: "simple" | "advanced" | "walletfree";
  isSmartWallet: boolean;
  credentials?: AgentCredentials;
  verificationStrength?: number;
  agentCard?: A2AAgentCard;
}

function cleanStr(s: string): string {
  // Strip null bytes and other non-printable chars from on-chain strings
  return s.replace(/[\x00-\x1f]/g, "").trim();
}

function buildCredentialBadges(creds: AgentCredentials): string[] {
  const badges: string[] = [];
  const nat = cleanStr(creds.nationality ?? "");
  if (nat) badges.push(nat);
  if (creds.olderThan > 0n) badges.push(`${creds.olderThan.toString()}+`);
  if (creds.ofac?.some(Boolean)) badges.push("Not on OFAC List");
  const gender = cleanStr(creds.gender ?? "");
  if (gender) {
    badges.push(gender === "M" ? "Male" : gender === "F" ? "Female" : gender);
  }
  const dob = cleanStr(creds.dateOfBirth ?? "");
  if (dob && dob !== "--" && dob !== "-") badges.push(`DOB: ${dob}`);
  const issuing = cleanStr(creds.issuingState ?? "");
  if (issuing) badges.push(`Issued: ${issuing}`);
  const names = (creds.name ?? []).map(cleanStr).filter(Boolean);
  if (names.length > 0) badges.push(names.join(" "));
  return badges.filter((b) => b.length > 0);
}

function VerifyContent() {
  const searchParams = useSearchParams();
  const { network } = useNetwork();
  const [agentKey, setAgentKey] = useState(searchParams.get("key") || "");
  const [resolvedKey, setResolvedKey] = useState("");
  const [agentInfo, setAgentInfo] = useState<AgentInfo | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [activeUseCase, setActiveUseCase] = useState(0);
  const [activeAgentSnippet, setActiveAgentSnippet] = useState(0);
  const [activeServiceFeatures, setActiveServiceFeatures] = useState<
    Set<string>
  >(new Set());
  const [activeAgentFeatures, setActiveAgentFeatures] = useState<Set<string>>(
    new Set(),
  );
  const [walletAddress, setWalletAddress] = useState<string | null>(null);
  const [passkeyAvailable, setPasskeyAvailable] = useState(false);

  useEffect(() => {
    setPasskeyAvailable(isPasskeySupported());
  }, []);

  const toggleServiceFeature = (id: string) => {
    setActiveServiceFeatures((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleAgentFeature = (id: string) => {
    setActiveAgentFeatures((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };
  const [showDeregister, setShowDeregister] = useState(false);
  const [passkeyRevoking, setPasskeyRevoking] = useState(false);
  const [showCardJsonVerify, setShowCardJsonVerify] = useState(false);
  const [copiedField, setCopiedField] = useState<string | null>(null);
  const copyToClipboard = (text: string, field: string) => {
    void navigator.clipboard.writeText(text);
    setCopiedField(field);
    setTimeout(() => setCopiedField(null), 2000);
  };
  const [selfApp, setSelfApp] = useState<ReturnType<
    InstanceType<typeof import("@selfxyz/qrcode").SelfAppBuilder>["build"]
  > | null>(null);

  const lookupAgent = useCallback(
    async (key: string) => {
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

        const provider = new ethers.JsonRpcProvider(network.rpcUrl);
        const contract = typedRegistry(network.registryAddress, provider);

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
            isSmartWallet: false,
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
              mode = guardian !== ethers.ZeroAddress ? "walletfree" : "simple";
            }
          }

          // Fetch ZK-attested credentials
          let credentials: AgentCredentials | undefined;
          try {
            const raw = await contract.getAgentCredentials(agentId);
            const creds: AgentCredentials = {
              issuingState: raw.issuingState || "",
              name: raw.name || [],
              idNumber: raw.idNumber || "",
              nationality: raw.nationality || "",
              dateOfBirth: raw.dateOfBirth || "",
              gender: raw.gender || "",
              expiryDate: raw.expiryDate || "",
              olderThan: raw.olderThan ?? 0n,
              ofac: raw.ofac || [false, false, false],
            };
            // Only set if at least one field is non-empty
            if (
              creds.nationality ||
              creds.issuingState ||
              creds.name?.some((n: string) => n.length > 0) ||
              creds.olderThan > 0n
            ) {
              credentials = creds;
            }
          } catch {
            // V4 contract without getAgentCredentials — ignore
          }

          // Detect smart wallet: guardian is a contract (has code)
          let isSmartWallet = false;
          if (guardian !== ethers.ZeroAddress) {
            try {
              const code = await provider.getCode(guardian);
              isSmartWallet = code !== "0x" && code.length > 2;
            } catch {}
          }

          // Read verification strength from provider
          let verificationStrength: number | undefined;
          try {
            const provAddr: string = await contract.agentProofProvider(agentId);
            if (provAddr && provAddr !== ethers.ZeroAddress) {
              const provContract = typedProvider(provAddr, provider);
              const s: number = await provContract.verificationStrength();
              verificationStrength = Number(s);
            }
          } catch {}

          // Parse A2A card from metadata
          let agentCard: A2AAgentCard | undefined;
          if (metadata) {
            try {
              const parsed = JSON.parse(metadata);
              if (parsed.a2aVersion) agentCard = parsed;
            } catch {}
          }

          setAgentInfo({
            isVerified,
            agentId: owner === ethers.ZeroAddress ? 0n : agentId,
            owner,
            registeredAt,
            guardian,
            metadata,
            mode,
            isSmartWallet,
            credentials,
            verificationStrength,
            agentCard,
          });
        }
      } catch (err) {
        setError(
          err instanceof Error ? err.message : "Failed to query contract",
        );
      } finally {
        setLoading(false);
      }
    },
    [network],
  );

  useEffect(() => {
    const key = searchParams.get("key");
    if (key) {
      setAgentKey(key);
      void lookupAgent(key);
    }
  }, [searchParams, lookupAgent]);

  useEffect(() => {
    void import("@selfxyz/qrcode").then((mod) => {
      SelfAppBuilder = mod.SelfAppBuilder;
    });
  }, []);

  const handleConnectForDeregister = async () => {
    const addr = await connectWallet(network);
    if (addr) setWalletAddress(addr);
  };

  const handleDeregister = () => {
    if (!resolvedKey || !SelfAppBuilder || !agentInfo) return;

    const agentAddress = "0x" + resolvedKey.slice(26);

    // Determine deregistration userData based on mode
    let userDefinedData: string;
    let userId: string;

    if (agentInfo.mode === "simple") {
      userDefinedData = "D0";
      userId = walletAddress || agentAddress;
    } else if (agentInfo.mode === "walletfree") {
      // Wallet-free: use "D" action with agent address as userId
      userDefinedData = "D0";
      userId = agentAddress;
    } else {
      // Advanced mode
      userDefinedData = "X0" + resolvedKey.slice(26);
      userId = walletAddress || agentAddress;
    }

    const app = new SelfAppBuilder({
      version: 2,
      appName: process.env.NEXT_PUBLIC_SELF_APP_NAME || "Self Agent ID",
      scope: process.env.NEXT_PUBLIC_SELF_SCOPE_SEED || "self-agent-id",
      endpoint: network.registryAddress,
      logoBase64: "https://i.postimg.cc/mrmVf9hm/self.png",
      userId,
      endpointType: network.selfEndpointType,
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
    void lookupAgent(agentKey);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    void lookupAgent(agentKey);
  };

  const snippets = useMemo(
    () =>
      getServiceSnippets(
        network.registryAddress,
        network.rpcUrl,
        activeServiceFeatures,
      ),
    [network.registryAddress, network.rpcUrl, activeServiceFeatures],
  );

  const agentSnippets = useMemo(
    () =>
      getAgentSnippets(
        network.registryAddress,
        network.rpcUrl,
        activeAgentFeatures,
      ),
    [network.registryAddress, network.rpcUrl, activeAgentFeatures],
  );

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
                  <span className="font-mono">
                    {agentInfo.agentId.toString()}
                  </span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-muted">Mode</span>
                  <div className="flex items-center gap-2">
                    <span
                      className={`text-xs px-2 py-0.5 rounded-full ${
                        agentInfo.mode === "simple"
                          ? "bg-surface-2 text-muted"
                          : agentInfo.mode === "advanced"
                            ? "bg-accent/10 text-accent"
                            : "bg-accent-2/10 text-accent-2"
                      }`}
                    >
                      {agentInfo.mode === "simple"
                        ? "Verified Wallet"
                        : agentInfo.mode === "advanced"
                          ? "Agent Identity"
                          : "Wallet-Free"}
                    </span>
                    {agentInfo.isSmartWallet && (
                      <Badge variant="success">
                        <Fingerprint size={10} className="mr-1" />
                        Smart Wallet
                      </Badge>
                    )}
                  </div>
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
                      {agentInfo.guardian.slice(0, 6)}...
                      {agentInfo.guardian.slice(-4)}
                    </span>
                  </div>
                )}
                <div className="flex justify-between">
                  <span className="text-muted">Registered at block</span>
                  <span className="font-mono">
                    {agentInfo.registeredAt.toString()}
                  </span>
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
                {agentInfo.credentials && (
                  <div className="mt-3 pt-3 border-t border-border">
                    <div className="flex items-center gap-1 text-muted mb-2">
                      <Shield size={12} /> ZK-Attested Credentials
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {buildCredentialBadges(agentInfo.credentials)
                        .filter((b) => b.trim())
                        .map((badge, i) => (
                          <span
                            key={i}
                            className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-accent/10 text-accent border border-accent/20"
                          >
                            {badge}
                          </span>
                        ))}
                    </div>
                  </div>
                )}

                {/* Verification Strength + A2A Card */}
                {agentInfo.verificationStrength !== undefined && (
                  <div className="mt-3 pt-3 border-t border-border">
                    <div className="flex items-center gap-2 mb-2">
                      <div
                        className={`w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold text-white ${
                          agentInfo.verificationStrength >= 80
                            ? "bg-green-500"
                            : agentInfo.verificationStrength >= 60
                              ? "bg-blue-500"
                              : agentInfo.verificationStrength >= 40
                                ? "bg-amber-500"
                                : "bg-gray-500"
                        }`}
                      >
                        {agentInfo.verificationStrength}
                      </div>
                      <span className="text-xs text-muted">
                        Verification Strength:{" "}
                        <strong className="text-foreground">
                          {agentInfo.verificationStrength >= 100
                            ? "Passport"
                            : agentInfo.verificationStrength >= 80
                              ? "KYC"
                              : agentInfo.verificationStrength >= 60
                                ? "Govt ID"
                                : "Liveness"}
                        </strong>
                      </span>
                    </div>

                    {agentInfo.agentCard && (
                      <>
                        <div className="flex items-center gap-1 text-muted mb-2">
                          <FileText size={12} /> A2A Agent Card
                        </div>
                        <div className="text-xs space-y-1">
                          <p>
                            <span className="text-muted">Name:</span>{" "}
                            {agentInfo.agentCard.name}
                          </p>
                          {agentInfo.agentCard.description && (
                            <p>
                              <span className="text-muted">Description:</span>{" "}
                              {agentInfo.agentCard.description}
                            </p>
                          )}
                        </div>

                        {/* API Links */}
                        <div className="mt-2 space-y-1">
                          <div className="flex items-center gap-2 text-xs">
                            <span className="text-muted">Card URL:</span>
                            <code className="font-mono bg-surface-2 border border-border rounded px-1.5 py-0.5 flex-1 truncate">
                              /api/cards/{network.chainId}/
                              {agentInfo.agentId.toString()}
                            </code>
                            <button
                              onClick={() =>
                                copyToClipboard(
                                  `${window.location.origin}/api/cards/${network.chainId}/${agentInfo.agentId.toString()}`,
                                  "vCardUrl",
                                )
                              }
                              className="p-1 text-muted hover:text-foreground shrink-0"
                            >
                              {copiedField === "vCardUrl" ? (
                                <Check
                                  size={12}
                                  className="text-accent-success"
                                />
                              ) : (
                                <Copy size={12} />
                              )}
                            </button>
                          </div>
                          <div className="flex items-center gap-2 text-xs">
                            <span className="text-muted">Rep URL:</span>
                            <code className="font-mono bg-surface-2 border border-border rounded px-1.5 py-0.5 flex-1 truncate">
                              /api/reputation/{network.chainId}/
                              {agentInfo.agentId.toString()}
                            </code>
                            <button
                              onClick={() =>
                                copyToClipboard(
                                  `${window.location.origin}/api/reputation/${network.chainId}/${agentInfo.agentId.toString()}`,
                                  "vRepUrl",
                                )
                              }
                              className="p-1 text-muted hover:text-foreground shrink-0"
                            >
                              {copiedField === "vRepUrl" ? (
                                <Check
                                  size={12}
                                  className="text-accent-success"
                                />
                              ) : (
                                <Copy size={12} />
                              )}
                            </button>
                          </div>
                        </div>

                        <button
                          onClick={() =>
                            setShowCardJsonVerify(!showCardJsonVerify)
                          }
                          className="text-xs text-accent hover:text-accent-2 mt-2 flex items-center gap-1"
                        >
                          {showCardJsonVerify ? (
                            <ChevronUp size={12} />
                          ) : (
                            <ChevronDown size={12} />
                          )}
                          {showCardJsonVerify ? "Hide" : "Show"} Raw JSON
                        </button>
                        {showCardJsonVerify && (
                          <pre className="mt-1 text-xs bg-surface-2 border border-border rounded p-2 overflow-auto max-h-40">
                            {JSON.stringify(agentInfo.agentCard, null, 2)}
                          </pre>
                        )}
                      </>
                    )}
                  </div>
                )}
              </div>
            )}
          </Card>

          {agentInfo.isVerified &&
            agentInfo.isSmartWallet &&
            passkeyAvailable &&
            (() => {
              const storedPasskey = getPasskey();
              const passkeyMatchesGuardian =
                storedPasskey &&
                storedPasskey.walletAddress.toLowerCase() ===
                  agentInfo.guardian.toLowerCase();
              if (!passkeyMatchesGuardian) return null;

              if (!isGaslessSupported(network)) {
                return (
                  <div className="w-full mt-2">
                    <p className="text-xs text-subtle">
                      Gasless revocation via passkey is available on mainnet. On
                      testnet, use the deregister button below (passport scan).
                    </p>
                  </div>
                );
              }

              return (
                <div className="w-full mt-2">
                  <button
                    onClick={() => {
                      void (async () => {
                        setPasskeyRevoking(true);
                        try {
                          const callData = encodeGuardianRevoke(
                            agentInfo.agentId,
                          );
                          await sendUserOperation(
                            network.registryAddress as `0x${string}`,
                            callData,
                            network,
                          );
                          void lookupAgent(agentKey);
                        } catch (err) {
                          alert(
                            err instanceof Error
                              ? err.message
                              : "Revocation failed",
                          );
                        } finally {
                          setPasskeyRevoking(false);
                        }
                      })();
                    }}
                    disabled={passkeyRevoking}
                    className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium bg-accent-error/10 text-accent-error border border-accent-error/20 hover:bg-accent-error/20 transition-colors disabled:opacity-50"
                  >
                    {passkeyRevoking ? (
                      <>
                        <Loader2 size={14} className="animate-spin" />
                        Revoking...
                      </>
                    ) : (
                      <>
                        <Fingerprint size={14} />
                        Revoke with Passkey (gasless)
                      </>
                    )}
                  </button>
                </div>
              );
            })()}

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
                      <img
                        src="/self-icon.png"
                        alt="Self"
                        width={20}
                        height={20}
                        className="rounded"
                      />
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
                        onClick={() => {
                          setShowDeregister(false);
                          setSelfApp(null);
                        }}
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
                <Button
                  onClick={() => void handleConnectForDeregister()}
                  variant="danger"
                  size="sm"
                >
                  Connect wallet to deregister
                </Button>
              ) : walletAddress.toLowerCase() ===
                agentInfo.owner.toLowerCase() ? (
                !showDeregister ? (
                  <Button onClick={handleDeregister} variant="danger" size="sm">
                    Deregister Agent
                  </Button>
                ) : (
                  <Card variant="error" className="w-full">
                    <div className="flex items-center gap-2 mb-3">
                      <img
                        src="/self-icon.png"
                        alt="Self"
                        width={20}
                        height={20}
                        className="rounded"
                      />
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
                        onClick={() => {
                          setShowDeregister(false);
                          setSelfApp(null);
                        }}
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
                  Connected: {walletAddress.slice(0, 6)}...
                  {walletAddress.slice(-4)} (not the owner)
                </p>
              )}
            </div>
          )}
        </>
      )}

      {/* Integration Guide — shown after agent lookup */}
      {agentInfo && agentInfo.isVerified && (
        <div className="w-full mt-8 space-y-4">
          <div className="flex items-center gap-2">
            <Code2 size={20} className="text-accent" />
            <h2 className="text-xl font-bold">
              Integration Guide for Developers
            </h2>
          </div>
          <p className="text-sm text-muted">
            These code snippets are for{" "}
            <strong className="text-foreground">service developers</strong> who
            want to verify agents in their applications. Pre-filled with the
            deployed contract address.
          </p>

          <div className="flex gap-2 flex-wrap">
            {snippets.map((uc, i) => (
              <button
                key={uc.title}
                onClick={() => setActiveUseCase(i)}
                className={`px-4 py-2 rounded-lg text-sm font-semibold transition-colors border ${
                  i === activeUseCase
                    ? "bg-gradient-to-r from-accent to-accent-2 text-white border-transparent"
                    : "bg-surface-1 text-foreground border-border hover:bg-surface-2"
                }`}
              >
                {uc.title}
              </button>
            ))}
          </div>

          <div className="flex gap-1.5 flex-wrap">
            {SERVICE_FEATURES.map((feat) => {
              const active = activeServiceFeatures.has(feat.id);
              return (
                <button
                  key={feat.id}
                  onClick={() => toggleServiceFeature(feat.id)}
                  title={feat.description}
                  className={`px-2.5 py-1 rounded-full text-xs font-medium transition-colors ${
                    active
                      ? "bg-accent/15 text-accent border border-accent/40"
                      : "bg-surface-2 text-muted border border-transparent hover:text-foreground"
                  }`}
                >
                  {active ? "\u2713" : "+"} {feat.label}
                </button>
              );
            })}
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
            If you are the{" "}
            <strong className="text-foreground">agent operator</strong>, use
            these snippets to authenticate your agent with services or submit
            on-chain transactions. Set{" "}
            <code className="bg-surface-2 font-mono text-accent-2 px-1 rounded text-xs">
              AGENT_PRIVATE_KEY
            </code>{" "}
            in your agent&apos;s environment first.
          </p>

          <div className="flex gap-2 flex-wrap">
            {agentSnippets.map((snippet, i) => (
              <button
                key={snippet.title}
                onClick={() => setActiveAgentSnippet(i)}
                className={`px-4 py-2 rounded-lg text-sm font-semibold transition-colors border ${
                  i === activeAgentSnippet
                    ? "bg-gradient-to-r from-accent to-accent-2 text-white border-transparent"
                    : "bg-surface-1 text-foreground border-border hover:bg-surface-2"
                }`}
              >
                {snippet.title}
              </button>
            ))}
          </div>

          <div className="flex gap-1.5 flex-wrap">
            {AGENT_FEATURES.map((feat) => {
              const active = activeAgentFeatures.has(feat.id);
              return (
                <button
                  key={feat.id}
                  onClick={() => toggleAgentFeature(feat.id)}
                  title={feat.description}
                  className={`px-2.5 py-1 rounded-full text-xs font-medium transition-colors ${
                    active
                      ? "bg-accent/15 text-accent border border-accent/40"
                      : "bg-surface-2 text-muted border border-transparent hover:text-foreground"
                  }`}
                >
                  {active ? "\u2713" : "+"} {feat.label}
                </button>
              );
            })}
          </div>

          <p className="text-sm text-muted">
            {agentSnippets[activeAgentSnippet].description}
          </p>
          <CodeBlock tabs={agentSnippets[activeAgentSnippet].snippets} />
        </div>
      )}
    </>
  );
}

export default function VerifyPage() {
  return (
    <div className="space-y-6">
      <div className="text-center">
        <h1 className="text-3xl font-bold mb-2">Verify Agent</h1>
        <p className="text-muted max-w-md mx-auto">
          Look up any agent to check its on-chain registration and human
          verification status.
        </p>
      </div>

      <Suspense
        fallback={
          <div className="w-full h-12 bg-surface-2 animate-pulse rounded-lg" />
        }
      >
        <VerifyContent />
      </Suspense>
    </div>
  );
}
