"use client";

import React, { Suspense, useState, useEffect, useCallback } from "react";
import { useSearchParams } from "next/navigation";
import { ethers } from "ethers";
import Link from "next/link";
import dynamic from "next/dynamic";
import CodeBlock from "@/components/CodeBlock";
import { getSnippets } from "@/lib/snippets";
import { connectWallet } from "@/lib/wallet";
import { REGISTRY_ADDRESS, REGISTRY_ABI, RPC_URL } from "@/lib/constants";

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
}

function VerifyContent() {
  const searchParams = useSearchParams();
  const [agentKey, setAgentKey] = useState(searchParams.get("key") || "");
  const [resolvedKey, setResolvedKey] = useState("");
  const [agentInfo, setAgentInfo] = useState<AgentInfo | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [activeUseCase, setActiveUseCase] = useState(0);
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
        });
      } else {
        const owner = await contract.ownerOf(agentId);
        const registeredAt = await contract.agentRegisteredAt(agentId);

        setAgentInfo({
          isVerified,
          agentId,
          owner,
          registeredAt,
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
    if (!walletAddress || !resolvedKey || !SelfAppBuilder) return;
    const userDefinedData = "D" + resolvedKey.slice(2);
    const app = new SelfAppBuilder({
      version: 2,
      appName: process.env.NEXT_PUBLIC_SELF_APP_NAME || "Self Agent ID",
      scope: process.env.NEXT_PUBLIC_SELF_SCOPE_SEED || "self-agent-id",
      endpoint: REGISTRY_ADDRESS,
      logoBase64: "https://i.postimg.cc/mrmVf9hm/self.png",
      userId: walletAddress,
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

  const snippets = getSnippets(REGISTRY_ADDRESS, resolvedKey);

  return (
    <>
      <form onSubmit={handleSubmit} className="w-full max-w-md flex gap-2">
        <input
          type="text"
          value={agentKey}
          onChange={(e) => setAgentKey(e.target.value)}
          placeholder="Agent public key or identifier"
          className="flex-1 px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-black"
        />
        <button
          type="submit"
          disabled={loading || !agentKey}
          className="px-6 py-3 bg-black text-white rounded-lg font-medium hover:bg-gray-800 transition-colors disabled:bg-gray-300"
        >
          {loading ? "..." : "Check"}
        </button>
      </form>

      {error && <p className="text-red-500 text-sm">{error}</p>}

      {agentInfo && (
        <>
          <div className="w-full max-w-md border rounded-lg p-6 space-y-3">
            <div className="flex items-center gap-2">
              <span
                className={`inline-block w-3 h-3 rounded-full ${agentInfo.isVerified ? "bg-green-500" : "bg-red-500"}`}
              />
              <span className="font-medium text-lg">
                {agentInfo.agentId === 0n
                  ? "Not Registered"
                  : agentInfo.isVerified
                    ? "Verified"
                    : "Revoked"}
              </span>
            </div>

            {agentInfo.agentId > 0n && (
              <div className="text-sm space-y-1 text-gray-600">
                <p>
                  <span className="font-medium text-black">Agent ID:</span>{" "}
                  {agentInfo.agentId.toString()}
                </p>
                <p>
                  <span className="font-medium text-black">Owner:</span>{" "}
                  {agentInfo.owner.slice(0, 6)}...{agentInfo.owner.slice(-4)}
                </p>
                <p>
                  <span className="font-medium text-black">
                    Registered at block:
                  </span>{" "}
                  {agentInfo.registeredAt.toString()}
                </p>
              </div>
            )}
          </div>

          {agentInfo.isVerified && (
            <div className="w-full max-w-md mt-4">
              {!walletAddress ? (
                <button
                  onClick={handleConnectForDeregister}
                  className="text-sm text-red-500 hover:text-red-700 underline"
                >
                  Connect wallet to deregister
                </button>
              ) : walletAddress.toLowerCase() === agentInfo.owner.toLowerCase() ? (
                !showDeregister ? (
                  <button
                    onClick={handleDeregister}
                    className="px-4 py-2 border border-red-300 text-red-600 rounded-lg text-sm hover:bg-red-50 transition-colors"
                  >
                    Deregister Agent
                  </button>
                ) : (
                  <div className="flex flex-col items-center gap-3 p-4 border border-red-200 rounded-lg">
                    <p className="text-sm text-gray-600">
                      Scan with Self App to confirm deregistration
                    </p>
                    {selfApp && (
                      <SelfQRcodeWrapper
                        selfApp={selfApp}
                        onSuccess={handleDeregisterSuccess}
                        onError={() => alert("Deregistration failed.")}
                      />
                    )}
                    <button
                      onClick={() => { setShowDeregister(false); setSelfApp(null); }}
                      className="text-xs text-gray-500 underline"
                    >
                      Cancel
                    </button>
                  </div>
                )
              ) : (
                <p className="text-xs text-gray-400">
                  Connected: {walletAddress.slice(0, 6)}...{walletAddress.slice(-4)} (not the owner)
                </p>
              )}
            </div>
          )}
        </>
      )}

      {/* Integration Guide — only shown for verified agents */}
      {agentInfo && agentInfo.isVerified && (
        <div className="w-full max-w-2xl mt-8 space-y-4">
          <h2 className="text-xl font-bold">Integrate This Agent</h2>
          <p className="text-sm text-gray-500">
            Code snippets pre-filled with this agent&apos;s pubkey and the
            deployed contract address. Copy and paste into your project.
          </p>

          <div className="flex gap-2 flex-wrap">
            {snippets.map((uc, i) => (
              <button
                key={uc.title}
                onClick={() => setActiveUseCase(i)}
                className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                  i === activeUseCase
                    ? "bg-black text-white"
                    : "bg-gray-100 text-gray-600 hover:bg-gray-200"
                }`}
              >
                {uc.title}
              </button>
            ))}
          </div>

          <p className="text-sm text-gray-600">
            {snippets[activeUseCase].description}
          </p>
          <p className="text-xs text-gray-400 font-mono">
            {snippets[activeUseCase].flow}
          </p>
          <CodeBlock tabs={snippets[activeUseCase].snippets} />
        </div>
      )}
    </>
  );
}

export default function VerifyPage() {
  return (
    <main className="min-h-screen flex flex-col items-center justify-center p-8 gap-6 font-[family-name:var(--font-inter)]">
      <h1 className="text-3xl font-bold">Verify Agent</h1>
      <p className="text-gray-600 text-center max-w-md">
        Check if an AI agent is registered and backed by a verified human.
      </p>

      <Suspense
        fallback={
          <div className="w-full max-w-md h-12 bg-gray-200 animate-pulse rounded-lg" />
        }
      >
        <VerifyContent />
      </Suspense>

      <Link
        href="/"
        className="text-sm text-gray-500 hover:text-gray-800 underline"
      >
        Back to home
      </Link>
    </main>
  );
}
