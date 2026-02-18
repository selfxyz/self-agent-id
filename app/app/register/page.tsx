"use client";

import React, { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { ethers } from "ethers";
import dynamic from "next/dynamic";
import { connectWallet } from "@/lib/wallet";
import { REGISTRY_ADDRESS, REGISTRY_ABI, RPC_URL } from "@/lib/constants";

// Dynamic import to avoid SSR issues with Self QR SDK
const SelfQRcodeWrapper = dynamic(
  () => import("@selfxyz/qrcode").then((mod) => mod.SelfQRcodeWrapper),
  { ssr: false }
);

// Import SelfAppBuilder separately (not a component)
let SelfAppBuilder: typeof import("@selfxyz/qrcode").SelfAppBuilder;

type Mode = "simple" | "advanced";
type Step = "mode" | "connect" | "scan" | "success";

export default function RegisterPage() {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>("simple");
  const [walletAddress, setWalletAddress] = useState<string | null>(null);
  const [selfApp, setSelfApp] = useState<ReturnType<
    InstanceType<typeof import("@selfxyz/qrcode").SelfAppBuilder>["build"]
  > | null>(null);
  const [step, setStep] = useState<Step>("mode");
  const [alreadyRegistered, setAlreadyRegistered] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");

  // Load SelfAppBuilder on client
  useEffect(() => {
    import("@selfxyz/qrcode").then((mod) => {
      SelfAppBuilder = mod.SelfAppBuilder;
    });
  }, []);

  const checkIfRegistered = async (address: string): Promise<boolean> => {
    try {
      const provider = new ethers.JsonRpcProvider(RPC_URL);
      const registry = new ethers.Contract(REGISTRY_ADDRESS, REGISTRY_ABI, provider);
      const agentKey = ethers.zeroPadValue(address, 32);
      const isVerified = await registry.isVerifiedAgent(agentKey);
      return isVerified;
    } catch {
      return false;
    }
  };

  const handleConnect = async () => {
    setErrorMessage("");
    const address = await connectWallet();
    if (!address) return;

    setWalletAddress(address);

    // Check if this wallet is already registered
    const registered = await checkIfRegistered(address);
    if (registered) {
      setAlreadyRegistered(true);
      setStep("connect");
      return;
    }

    if (!SelfAppBuilder) {
      setErrorMessage("Self SDK still loading. Please try again.");
      setStep("connect");
      return;
    }

    setAlreadyRegistered(false);

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
  };

  const handleSuccess = () => {
    setStep("success");
  };

  const handleError = (error: unknown) => {
    const msg = error instanceof Error ? error.message : String(error);
    if (msg.includes("AlreadyRegistered") || msg.includes("already")) {
      setErrorMessage("This wallet address is already registered as an agent.");
    } else {
      setErrorMessage(`Verification failed: ${msg}`);
    }
  };

  return (
    <main className="min-h-screen flex flex-col items-center justify-center p-8 gap-6 font-[family-name:var(--font-inter)]">
      <h1 className="text-3xl font-bold">Register Agent</h1>

      {/* Step 1: Choose mode */}
      {step === "mode" && (
        <div className="flex flex-col items-center gap-6 w-full max-w-lg">
          <p className="text-black text-center max-w-md">
            Choose how your agent&apos;s on-chain identity will be created.
          </p>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 w-full">
            {/* Simple mode card */}
            <button
              onClick={() => setMode("simple")}
              className={`text-left p-5 rounded-xl border-2 transition-colors ${
                mode === "simple"
                  ? "border-black bg-gray-50"
                  : "border-gray-200 hover:border-gray-400"
              }`}
            >
              <div className="flex items-center gap-2 mb-2">
                <span className="text-lg">👤</span>
                <span className="font-bold text-black">Simple</span>
                <span className="text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded-full font-medium">
                  live
                </span>
              </div>
              <p className="text-sm text-black mb-2">
                Your wallet address = your agent identity.
              </p>
              <p className="text-xs text-black">
                No extra keys to manage. Connect wallet, scan passport, done.
              </p>
            </button>

            {/* Advanced mode card */}
            <button
              onClick={() => setMode("advanced")}
              disabled
              className="text-left p-5 rounded-xl border-2 border-gray-200 opacity-60 cursor-not-allowed"
            >
              <div className="flex items-center gap-2 mb-2">
                <span className="text-lg">🔑</span>
                <span className="font-bold text-black">Advanced</span>
                <span className="text-xs bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full font-medium">
                  coming soon
                </span>
              </div>
              <p className="text-sm text-black mb-2">
                Agent gets its own independent keypair.
              </p>
              <p className="text-xs text-black">
                Key rotation, delegation, multiple agents per human.
              </p>
            </button>
          </div>

          {/* Security explainer for selected mode */}
          <div className="w-full bg-gray-50 border border-gray-200 rounded-lg p-4">
            <p className="font-bold text-sm text-black mb-2">
              How Simple Mode is secured
            </p>
            <ul className="text-sm text-black space-y-1 list-disc list-inside">
              <li>
                Your <strong>wallet address</strong> is converted to a bytes32 agent
                key <em>inside</em> the smart contract &mdash; no one else can register
                your address.
              </li>
              <li>
                A <strong>ZK proof</strong> from your passport scan binds your wallet
                to a unique human nullifier, preventing sybil attacks.
              </li>
              <li>
                For off-chain verification, the <strong>SDK signs requests</strong>{" "}
                with your wallet key. Services recover the signer from the ECDSA
                signature &mdash; it can&apos;t be spoofed.
              </li>
            </ul>
          </div>

          <button
            onClick={() => setStep("connect")}
            className="px-6 py-3 bg-black text-white rounded-lg font-medium hover:bg-gray-800 transition-colors"
          >
            Continue with Simple Mode
          </button>
        </div>
      )}

      {/* Step 2: Connect wallet */}
      {step === "connect" && (
        <div className="flex flex-col items-center gap-4 w-full max-w-md">
          {!walletAddress ? (
            <>
              <p className="text-black text-center max-w-md">
                Connect your wallet. Your wallet address will become your
                agent&apos;s on-chain identity.
              </p>
              <button
                onClick={handleConnect}
                className="px-6 py-3 bg-black text-white rounded-lg font-medium hover:bg-gray-800 transition-colors"
              >
                Connect Wallet
              </button>
            </>
          ) : alreadyRegistered ? (
            <>
              <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4 text-center">
                <p className="font-bold text-yellow-800 mb-2">Already Registered</p>
                <p className="text-sm text-yellow-800 mb-2">
                  Wallet{" "}
                  <span className="font-mono">
                    {walletAddress.slice(0, 6)}...{walletAddress.slice(-4)}
                  </span>{" "}
                  is already registered as an agent.
                </p>
              </div>
              <button
                onClick={() => {
                  const agentKey = ethers.zeroPadValue(walletAddress, 32);
                  router.push("/verify?key=" + encodeURIComponent(agentKey));
                }}
                className="px-6 py-3 bg-black text-white rounded-lg font-medium hover:bg-gray-800 transition-colors"
              >
                View Agent
              </button>
            </>
          ) : (
            <>
              <p className="text-sm text-black">
                Wallet connected but Self SDK is loading...
              </p>
              <button
                onClick={handleConnect}
                className="px-6 py-3 bg-black text-white rounded-lg font-medium hover:bg-gray-800 transition-colors"
              >
                Retry
              </button>
            </>
          )}
          {errorMessage && (
            <p className="text-sm text-red-600">{errorMessage}</p>
          )}
          <button
            onClick={() => {
              setStep("mode");
              setWalletAddress(null);
              setAlreadyRegistered(false);
              setErrorMessage("");
            }}
            className="text-sm text-black underline hover:text-gray-600"
          >
            Back
          </button>
        </div>
      )}

      {/* Step 3: Scan QR */}
      {step === "scan" && (
        <div className="flex flex-col items-center gap-4">
          <div className="bg-gray-50 border border-gray-200 rounded-lg p-3 text-center">
            <p className="text-xs text-black mb-1">Registering agent for wallet</p>
            <p className="font-mono text-sm text-black">{walletAddress}</p>
          </div>
          <p className="text-black text-center max-w-md">
            Scan this QR code with the Self App to verify your identity and
            register the agent.
          </p>
          {selfApp ? (
            <SelfQRcodeWrapper
              selfApp={selfApp}
              onSuccess={handleSuccess}
              onError={handleError}
            />
          ) : (
            <div className="w-64 h-64 bg-gray-200 animate-pulse flex items-center justify-center rounded-lg">
              <p className="text-black text-sm">Loading QR Code...</p>
            </div>
          )}
          {errorMessage && (
            <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-sm text-red-800 max-w-md">
              {errorMessage}
            </div>
          )}
          <button
            onClick={() => {
              setStep("connect");
              setSelfApp(null);
              setErrorMessage("");
            }}
            className="text-sm text-black underline hover:text-gray-600"
          >
            Back
          </button>
        </div>
      )}

      {/* Step 4: Success */}
      {step === "success" && (
        <div className="flex flex-col items-center gap-4 w-full max-w-md">
          <div className="text-5xl">&#10003;</div>
          <p className="text-lg font-medium text-green-600">
            Agent registered successfully!
          </p>
          <div className="bg-gray-50 border border-gray-200 rounded-lg p-4 w-full">
            <p className="font-bold text-sm text-black mb-2">Your Agent Identity</p>
            <div className="space-y-2 text-sm">
              <div>
                <p className="text-xs text-black mb-1">Wallet Address (your agent)</p>
                <p className="font-mono text-black break-all bg-white border border-gray-100 rounded px-2 py-1">
                  {walletAddress}
                </p>
              </div>
              <div>
                <p className="text-xs text-black mb-1">On-chain Agent Key (bytes32)</p>
                <p className="font-mono text-black break-all bg-white border border-gray-100 rounded px-2 py-1 text-xs">
                  {walletAddress && ethers.zeroPadValue(walletAddress, 32)}
                </p>
              </div>
            </div>
          </div>
          <p className="text-xs text-black text-center">
            In Simple Mode, your wallet address IS your agent. Any service can
            verify this agent by calling{" "}
            <code className="bg-gray-100 px-1 rounded">isVerifiedAgent()</code>{" "}
            with your address.
          </p>
          <button
            onClick={() => {
              const agentKey = ethers.zeroPadValue(walletAddress!, 32);
              router.push("/verify?key=" + encodeURIComponent(agentKey));
            }}
            className="px-6 py-3 bg-black text-white rounded-lg font-medium hover:bg-gray-800 transition-colors"
          >
            Verify Agent
          </button>
        </div>
      )}
    </main>
  );
}
