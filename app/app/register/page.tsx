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
  const [selfApp, setSelfApp] = useState<ReturnType<
    InstanceType<typeof import("@selfxyz/qrcode").SelfAppBuilder>["build"]
  > | null>(null);
  const [step, setStep] = useState<"connect" | "scan" | "success">("connect");

  // Load SelfAppBuilder on client
  useEffect(() => {
    import("@selfxyz/qrcode").then((mod) => {
      SelfAppBuilder = mod.SelfAppBuilder;
    });
  }, []);

  const handleConnect = async () => {
    const address = await connectWallet();
    if (address && SelfAppBuilder) {
      setWalletAddress(address);

      // userDefinedData is just "R" — the contract derives agentPubKey from the wallet address
      const app = new SelfAppBuilder({
        version: 2,
        appName: process.env.NEXT_PUBLIC_SELF_APP_NAME || "Self Agent ID",
        scope: process.env.NEXT_PUBLIC_SELF_SCOPE_SEED || "self-agent-id",
        endpoint: REGISTRY_ADDRESS,
        logoBase64: "https://i.postimg.cc/mrmVf9hm/self.png",
        userId: address,
        endpointType: "staging_celo",
        userIdType: "hex",
        userDefinedData: "R",
        disclosures: {},
      }).build();

      setSelfApp(app);
      setStep("scan");
    }
  };

  const handleSuccess = () => {
    setStep("success");
    // Agent key = zero-padded wallet address
    const agentKey = ethers.zeroPadValue(walletAddress!, 32);
    setTimeout(() => {
      router.push("/verify?key=" + encodeURIComponent(agentKey));
    }, 3000);
  };

  return (
    <main className="min-h-screen flex flex-col items-center justify-center p-8 gap-6 font-[family-name:var(--font-inter)]">
      <h1 className="text-3xl font-bold">Register Agent</h1>

      {step === "connect" && (
        <div className="flex flex-col items-center gap-4">
          <p className="text-gray-700 text-center max-w-md">
            Connect your wallet to register an AI agent with proof-of-human
            verification. Your wallet address becomes your agent&apos;s on-chain
            identity.
          </p>
          <button
            onClick={handleConnect}
            className="px-6 py-3 bg-black text-white rounded-lg font-medium hover:bg-gray-800 transition-colors"
          >
            Connect Wallet
          </button>
        </div>
      )}

      {step === "scan" && (
        <div className="flex flex-col items-center gap-4">
          <p className="text-sm text-gray-600">
            Connected: {walletAddress?.slice(0, 6)}...
            {walletAddress?.slice(-4)}
          </p>
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
            onClick={() => setStep("connect")}
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
          <div className="bg-gray-50 border border-gray-200 rounded-lg p-4 text-sm text-center">
            <p className="font-medium text-black mb-1">Your Agent Address</p>
            <p className="font-mono text-gray-700 break-all">
              {walletAddress}
            </p>
          </div>
          <p className="text-sm text-gray-600">
            Redirecting to verification page...
          </p>
        </div>
      )}
    </main>
  );
}
