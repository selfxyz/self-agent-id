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
  const [mode, setMode] = useState<Mode>("advanced");
  const [walletAddress, setWalletAddress] = useState<string | null>(null);
  const [selfApp, setSelfApp] = useState<ReturnType<
    InstanceType<typeof import("@selfxyz/qrcode").SelfAppBuilder>["build"]
  > | null>(null);
  const [step, setStep] = useState<Step>("mode");
  const [alreadyRegistered, setAlreadyRegistered] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");

  // Advanced mode state
  const [agentWallet, setAgentWallet] = useState<ethers.HDNodeWallet | null>(null);
  const [showPrivateKey, setShowPrivateKey] = useState(false);

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

    if (mode === "simple") {
      // Simple mode: check if already registered
      const registered = await checkIfRegistered(address);
      if (registered) {
        setAlreadyRegistered(true);
        setStep("connect");
        return;
      }
    }

    if (!SelfAppBuilder) {
      setErrorMessage("Self SDK still loading. Please try again.");
      setStep("connect");
      return;
    }

    setAlreadyRegistered(false);

    if (mode === "simple") {
      // Simple mode: userDefinedData is just "R"
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
    } else {
      // Advanced mode: generate keypair, sign challenge, build userDefinedData
      const newWallet = ethers.Wallet.createRandom();
      setAgentWallet(newWallet as ethers.HDNodeWallet);

      // Sign challenge: keccak256("self-agent-id:register:" + humanAddress)
      const messageHash = ethers.keccak256(
        ethers.solidityPacked(
          ["string", "address"],
          ["self-agent-id:register:", address]
        )
      );
      const signature = await newWallet.signMessage(ethers.getBytes(messageHash));
      const sig = ethers.Signature.from(signature);

      // Build "K" + address(40 hex, no 0x) + r(64 hex, no 0x) + s(64 hex, no 0x) + v(2 hex)
      const agentAddrHex = newWallet.address.slice(2).toLowerCase();
      const rHex = sig.r.slice(2);
      const sHex = sig.s.slice(2);
      const vHex = sig.v.toString(16).padStart(2, "0");
      const userDefinedData = "K" + agentAddrHex + rHex + sHex + vHex;

      const app = new SelfAppBuilder({
        version: 2,
        appName: process.env.NEXT_PUBLIC_SELF_APP_NAME || "Self Agent ID",
        scope: process.env.NEXT_PUBLIC_SELF_SCOPE_SEED || "self-agent-id",
        endpoint: REGISTRY_ADDRESS,
        logoBase64: "https://i.postimg.cc/mrmVf9hm/self.png",
        userId: address,
        endpointType: "staging_celo",
        userIdType: "hex",
        userDefinedData,
        disclosures: {},
      }).build();

      setSelfApp(app);
      setStep("scan");
    }
  };

  const handleSuccess = () => {
    setStep("success");
  };

  const handleError = (error: unknown) => {
    const msg = error instanceof Error ? error.message : String(error);
    if (msg.includes("AlreadyRegistered") || msg.includes("already")) {
      setErrorMessage("This agent is already registered.");
    } else {
      setErrorMessage(`Verification failed: ${msg}`);
    }
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
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
            {/* Advanced mode card — recommended, shown first */}
            <button
              onClick={() => setMode("advanced")}
              className={`text-left p-5 rounded-xl border-2 transition-colors ${
                mode === "advanced"
                  ? "border-black bg-gray-50"
                  : "border-gray-200 hover:border-gray-400"
              }`}
            >
              <div className="flex items-center gap-2 mb-2">
                <span className="text-lg">&#128273;</span>
                <span className="font-bold text-black">Agent Identity</span>
                <span className="text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded-full font-medium">
                  recommended
                </span>
              </div>
              <p className="text-sm text-black mb-2">
                Agent gets its own independent keypair.
              </p>
              <p className="text-xs text-black">
                Your agent signs requests autonomously. Your wallet key stays safe.
              </p>
            </button>

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
                <span className="text-lg">&#128100;</span>
                <span className="font-bold text-black">Verified Wallet</span>
              </div>
              <p className="text-sm text-black mb-2">
                Your wallet address = agent identity.
              </p>
              <p className="text-xs text-black">
                For on-chain access gating where you transact directly. No separate agent key.
              </p>
            </button>
          </div>

          {/* Security explainer for selected mode */}
          <div className="w-full bg-gray-50 border border-gray-200 rounded-lg p-4">
            {mode === "simple" ? (
              <>
                <p className="font-bold text-sm text-black mb-2">
                  How Verified Wallet works
                </p>
                <ul className="text-sm text-black space-y-1 list-disc list-inside">
                  <li>
                    Connect your <strong>browser wallet</strong> (MetaMask, etc.) &mdash;
                    that address becomes your on-chain identity.
                  </li>
                  <li>
                    Scan your passport with the <strong>Self app</strong> &mdash;
                    a ZK proof binds your wallet to a unique human nullifier.
                  </li>
                  <li>
                    Smart contracts can then check{" "}
                    <code className="bg-gray-100 px-1 rounded text-xs">isVerifiedAgent(your_address)</code>{" "}
                    to gate access to verified humans.
                  </li>
                  <li>
                    Best for <strong>on-chain gating</strong> where you transact directly
                    (DAOs, token access). Not for autonomous agents.
                  </li>
                </ul>
              </>
            ) : (
              <>
                <p className="font-bold text-sm text-black mb-2">
                  How Agent Identity works
                </p>
                <ul className="text-sm text-black space-y-1 list-disc list-inside">
                  <li>
                    Connect your <strong>browser wallet</strong> (MetaMask, etc.) &mdash;
                    used only during registration to prove your identity.
                  </li>
                  <li>
                    A fresh <strong>agent keypair</strong> is generated in your browser.
                    The agent signs a challenge to prove key ownership.
                  </li>
                  <li>
                    Scan your passport with the <strong>Self app</strong> &mdash;
                    the contract verifies both the ZK proof and the agent&apos;s signature in one step.
                  </li>
                  <li>
                    Your agent operates with <strong>its own key</strong> &mdash;
                    your wallet key is never exposed to agent software.
                  </li>
                </ul>
              </>
            )}
          </div>

          <button
            onClick={() => setStep("connect")}
            className="px-6 py-3 bg-black text-white rounded-lg font-medium hover:bg-gray-800 transition-colors"
          >
            {mode === "simple" ? "Continue with Simple Mode" : "Continue with Advanced Mode"}
          </button>
        </div>
      )}

      {/* Step 2: Connect wallet */}
      {step === "connect" && (
        <div className="flex flex-col items-center gap-4 w-full max-w-md">
          {!walletAddress ? (
            <>
              <p className="text-black text-center max-w-md">
                {mode === "simple"
                  ? "Connect your browser wallet (MetaMask, etc.). Your wallet address will become your agent\u2019s on-chain identity."
                  : "Connect your browser wallet (MetaMask, etc.). A new agent keypair will be generated and linked to your wallet."}
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
              setAgentWallet(null);
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
            {mode === "simple" ? (
              <>
                <p className="text-xs text-black mb-1">Registering wallet as agent</p>
                <p className="font-mono text-sm text-black">{walletAddress}</p>
              </>
            ) : (
              <>
                <p className="text-xs text-black mb-1">
                  Registering agent{" "}
                  <span className="font-mono">
                    {agentWallet?.address.slice(0, 6)}...{agentWallet?.address.slice(-4)}
                  </span>{" "}
                  under wallet
                </p>
                <p className="font-mono text-sm text-black">{walletAddress}</p>
              </>
            )}
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

          {mode === "simple" ? (
            <>
              <div className="bg-gray-50 border border-gray-200 rounded-lg p-4 w-full">
                <p className="font-bold text-sm text-black mb-2">Verified Wallet</p>
                <div className="space-y-2 text-sm">
                  <div>
                    <p className="text-xs text-black mb-1">Your Wallet Address</p>
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
              <div className="bg-gray-50 border border-gray-200 rounded-lg p-4 w-full">
                <p className="font-bold text-sm text-black mb-2">How this works</p>
                <ul className="text-xs text-black space-y-1.5 list-disc list-inside">
                  <li>
                    Your wallet address is now registered as a <strong>verified human</strong> on-chain.
                  </li>
                  <li>
                    Smart contracts can check{" "}
                    <code className="bg-gray-100 px-1 rounded">isVerifiedAgent(bytes32(your_address))</code>{" "}
                    to gate access to verified humans only.
                  </li>
                  <li>
                    <strong>You transact directly</strong> &mdash; there is no separate agent.
                    This is best for on-chain gating (DAOs, token access, DeFi).
                  </li>
                  <li>
                    For autonomous agents that sign requests to services,
                    use <strong>Agent Identity</strong> mode instead.
                  </li>
                </ul>
              </div>
            </>
          ) : (
            <>
              {/* Agent credentials */}
              <div className="bg-amber-50 border-2 border-amber-400 rounded-lg p-4 w-full">
                <p className="font-bold text-sm text-amber-900 mb-1">
                  &#9888; Agent Credentials
                </p>
                <p className="text-sm text-amber-800 mb-3">
                  A fresh Ethereum keypair was generated in your browser for your agent.
                  Copy these credentials now &mdash; the private key cannot be recovered
                  after you leave this page.
                </p>

                <div className="space-y-3">
                  <div>
                    <p className="text-xs font-medium text-amber-800 mb-1">
                      Agent Address
                      <span className="font-normal text-amber-700"> &mdash; your agent&apos;s public identity, derived from the keypair</span>
                    </p>
                    <div className="flex items-center gap-2">
                      <p className="font-mono text-black break-all bg-white border border-gray-200 rounded px-2 py-1 text-sm flex-1">
                        {agentWallet?.address}
                      </p>
                      <button
                        onClick={() => copyToClipboard(agentWallet?.address || "")}
                        className="px-2 py-1 text-xs bg-gray-100 hover:bg-gray-200 rounded border border-gray-200 shrink-0"
                      >
                        Copy
                      </button>
                    </div>
                  </div>

                  <div>
                    <p className="text-xs font-medium text-amber-800 mb-1">
                      Agent Private Key
                      <span className="font-normal text-amber-700"> &mdash; used by your agent to sign requests and prove its identity</span>
                    </p>
                    <div className="flex items-center gap-2">
                      <p className="font-mono text-black break-all bg-white border border-gray-200 rounded px-2 py-1 text-xs flex-1">
                        {showPrivateKey
                          ? agentWallet?.privateKey
                          : "\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022"}
                      </p>
                      <button
                        onClick={() => setShowPrivateKey(!showPrivateKey)}
                        className="px-2 py-1 text-xs bg-gray-100 hover:bg-gray-200 rounded border border-gray-200 shrink-0"
                      >
                        {showPrivateKey ? "Hide" : "Show"}
                      </button>
                      <button
                        onClick={() => copyToClipboard(agentWallet?.privateKey || "")}
                        className="px-2 py-1 text-xs bg-gray-100 hover:bg-gray-200 rounded border border-gray-200 shrink-0"
                      >
                        Copy
                      </button>
                    </div>
                  </div>
                </div>
              </div>

              {/* What to do with this key */}
              <div className="bg-gray-50 border border-gray-200 rounded-lg p-4 w-full">
                <p className="font-bold text-sm text-black mb-2">Next steps</p>
                <ul className="text-xs text-black space-y-1.5 list-disc list-inside">
                  <li>
                    Set <code className="bg-gray-100 px-1 rounded">AGENT_PRIVATE_KEY</code>{" "}
                    in your agent&apos;s environment or secrets manager.
                  </li>
                  <li>
                    Your agent uses this key to <strong>sign requests</strong>.
                    Services recover the signer address from the signature and
                    check the registry to confirm it&apos;s human-backed.
                  </li>
                  <li>
                    <strong>If lost:</strong> your agent can no longer authenticate.
                    Deregister and create a new one.
                  </li>
                  <li>
                    <strong>If leaked:</strong> someone could impersonate your agent.
                    Deregister it immediately.
                  </li>
                </ul>
              </div>

              {/* Registration details */}
              <div className="bg-gray-50 border border-gray-200 rounded-lg p-4 w-full">
                <p className="font-bold text-sm text-black mb-2">Registration Details</p>
                <div className="space-y-2 text-sm">
                  <div>
                    <p className="text-xs text-black mb-1">
                      Registered by
                      <span className="text-gray-500"> &mdash; your wallet, the NFT owner who can deregister this agent</span>
                    </p>
                    <p className="font-mono text-black break-all bg-white border border-gray-100 rounded px-2 py-1">
                      {walletAddress}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-black mb-1">
                      Agent Key (bytes32)
                      <span className="text-gray-500"> &mdash; the on-chain identifier services use to verify this agent</span>
                    </p>
                    <p className="font-mono text-black break-all bg-white border border-gray-100 rounded px-2 py-1 text-xs">
                      {agentWallet && ethers.zeroPadValue(agentWallet.address, 32)}
                    </p>
                  </div>
                </div>
              </div>
            </>
          )}

          <button
            onClick={() => {
              const key = mode === "simple"
                ? ethers.zeroPadValue(walletAddress!, 32)
                : ethers.zeroPadValue(agentWallet!.address, 32);
              router.push("/verify?key=" + encodeURIComponent(key));
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
