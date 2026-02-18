"use client";

import React, { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { ethers } from "ethers";
import dynamic from "next/dynamic";
import { connectWallet } from "@/lib/wallet";
import { REGISTRY_ADDRESS } from "@/lib/constants";

// Dynamic import to avoid SSR issues with Self QR SDK
const SelfQRcodeWrapper = dynamic(
  () => import("@selfxyz/qrcode").then((mod) => mod.SelfQRcodeWrapper),
  { ssr: false }
);

// Import SelfAppBuilder separately (not a component)
let SelfAppBuilder: typeof import("@selfxyz/qrcode").SelfAppBuilder;

export default function RegisterPage() {
  const router = useRouter();
  const [walletAddress, setWalletAddress] = useState<string | null>(null);
  const [agentPubKey, setAgentPubKey] = useState("");
  const [selfApp, setSelfApp] = useState<ReturnType<
    InstanceType<typeof import("@selfxyz/qrcode").SelfAppBuilder>["build"]
  > | null>(null);
  const [step, setStep] = useState<"connect" | "input" | "scan" | "success">(
    "connect"
  );

  // Load SelfAppBuilder on client
  useEffect(() => {
    import("@selfxyz/qrcode").then((mod) => {
      SelfAppBuilder = mod.SelfAppBuilder;
    });
  }, []);

  const handleConnect = async () => {
    const address = await connectWallet();
    if (address) {
      setWalletAddress(address);
      setStep("input");
    }
  };

  const handleStartRegistration = () => {
    if (!walletAddress || !agentPubKey || !SelfAppBuilder) return;

    // Pad or hash the agent public key to 32 bytes
    let keyBytes: string;
    if (agentPubKey.startsWith("0x") && agentPubKey.length === 66) {
      // Already a 32-byte hex string
      keyBytes = agentPubKey;
    } else {
      // Hash arbitrary input to get a 32-byte key
      keyBytes = ethers.keccak256(ethers.toUtf8Bytes(agentPubKey));
    }

    // userDefinedData = "R" + 64-char hex pubkey (no 0x prefix)
    // Self SDK passes this as a UTF-8 string, so we use string encoding
    const userDefinedData = "R" + keyBytes.slice(2);

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
    setStep("scan");
  };

  const handleSuccess = () => {
    setStep("success");
    setTimeout(() => {
      router.push("/verify?key=" + encodeURIComponent(agentPubKey));
    }, 2000);
  };

  return (
    <main className="min-h-screen flex flex-col items-center justify-center p-8 gap-6 font-[family-name:var(--font-inter)]">
      <h1 className="text-3xl font-bold">Register Agent</h1>

      {step === "connect" && (
        <div className="flex flex-col items-center gap-4">
          <p className="text-gray-700 text-center max-w-md">
            Connect your wallet to register an AI agent with proof-of-human
            verification.
          </p>
          <button
            onClick={handleConnect}
            className="px-6 py-3 bg-black text-white rounded-lg font-medium hover:bg-gray-800 transition-colors"
          >
            Connect Wallet
          </button>
        </div>
      )}

      {step === "input" && (
        <div className="flex flex-col items-center gap-4 w-full max-w-md">
          <p className="text-sm text-gray-600">
            Connected: {walletAddress?.slice(0, 6)}...{walletAddress?.slice(-4)}
          </p>
          <div className="w-full">
            <label
              htmlFor="agentKey"
              className="block text-sm font-medium mb-2"
            >
              Agent Public Key
            </label>
            <input
              id="agentKey"
              type="text"
              value={agentPubKey}
              onChange={(e) => setAgentPubKey(e.target.value)}
              placeholder="0x... (32-byte hex) or any string (will be hashed)"
              className="w-full px-4 py-3 border border-gray-300 rounded-lg text-black focus:outline-none focus:ring-2 focus:ring-black"
            />
            <p className="text-xs text-gray-600 mt-1">
              Paste the agent&apos;s secp256k1 public key, or any unique
              identifier (it will be keccak256-hashed to 32 bytes).
            </p>
          </div>
          <button
            onClick={handleStartRegistration}
            disabled={!agentPubKey}
            className="px-6 py-3 bg-black text-white rounded-lg font-medium hover:bg-gray-800 transition-colors disabled:bg-gray-300 disabled:cursor-not-allowed"
          >
            Generate QR Code
          </button>
        </div>
      )}

      {step === "scan" && (
        <div className="flex flex-col items-center gap-4">
          <p className="text-gray-700 text-center max-w-md">
            Scan this QR code with the Self App to verify your identity and
            register the agent.
          </p>
          {selfApp ? (
            <SelfQRcodeWrapper
              selfApp={selfApp}
              onSuccess={handleSuccess}
              onError={() => alert("Verification failed. Please try again.")}
            />
          ) : (
            <div className="w-64 h-64 bg-gray-200 animate-pulse flex items-center justify-center rounded-lg">
              <p className="text-gray-600 text-sm">Loading QR Code...</p>
            </div>
          )}
          <button
            onClick={() => setStep("input")}
            className="text-sm text-gray-600 hover:text-gray-800 underline"
          >
            Back
          </button>
        </div>
      )}

      {step === "success" && (
        <div className="flex flex-col items-center gap-4">
          <div className="text-5xl">&#10003;</div>
          <p className="text-lg font-medium text-green-600">
            Agent registered successfully!
          </p>
          <p className="text-sm text-gray-600">
            Redirecting to verification page...
          </p>
        </div>
      )}
    </main>
  );
}
