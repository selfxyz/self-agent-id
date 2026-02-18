"use client";

import React, { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { ethers } from "ethers";
import dynamic from "next/dynamic";
import {
  Key,
  Wallet,
  Lock,
  ChevronLeft,
  AlertTriangle,
  XCircle,
  CheckCircle2,
  Eye,
  EyeOff,
  Copy,
} from "lucide-react";
import { connectWallet } from "@/lib/wallet";
import { REGISTRY_ADDRESS, REGISTRY_ABI, RPC_URL } from "@/lib/constants";
import { getAgentSnippets } from "@/lib/snippets";
import CodeBlock from "@/components/CodeBlock";
import { Card } from "@/components/Card";
import { Badge } from "@/components/Badge";
import { Button } from "@/components/Button";

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
  const [activeAgentSnippet, setActiveAgentSnippet] = useState(0);

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
    <main className="min-h-screen max-w-xl mx-auto px-6 pt-24 pb-12">
      <h1 className="text-3xl font-bold text-center mb-8">
        <span className="text-gradient">Register Agent</span>
      </h1>

      {/* Step 1: Choose mode */}
      {step === "mode" && (
        <div className="flex flex-col items-center gap-6 w-full">
          <p className="text-muted text-center max-w-md">
            Choose how your agent&apos;s on-chain identity will be created.
          </p>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 w-full">
            {/* Advanced mode card — recommended, shown first */}
            <button
              onClick={() => setMode("advanced")}
              className={`text-left p-5 rounded-xl border-2 transition-all ${
                mode === "advanced"
                  ? "border-accent bg-surface-2"
                  : "border-border hover:border-border-strong"
              }`}
            >
              <div className="flex items-center gap-2 mb-2">
                <span className="w-8 h-8 rounded-full bg-accent/20 flex items-center justify-center">
                  <Key size={16} className="text-accent" />
                </span>
                <span className="font-bold">Agent Identity</span>
                <Badge variant="success">recommended</Badge>
              </div>
              <p className="text-sm text-foreground mb-2">
                Agent gets its own independent keypair.
              </p>
              <p className="text-xs text-muted">
                Your agent signs requests autonomously. Your wallet key stays safe.
              </p>
            </button>

            {/* Simple mode card */}
            <button
              onClick={() => setMode("simple")}
              className={`text-left p-5 rounded-xl border-2 transition-all ${
                mode === "simple"
                  ? "border-accent bg-surface-2"
                  : "border-border hover:border-border-strong"
              }`}
            >
              <div className="flex items-center gap-2 mb-2">
                <span className="w-8 h-8 rounded-full bg-accent/20 flex items-center justify-center">
                  <Wallet size={16} className="text-accent" />
                </span>
                <span className="font-bold">Verified Wallet</span>
              </div>
              <p className="text-sm text-foreground mb-2">
                Your wallet address = agent identity.
              </p>
              <p className="text-xs text-muted">
                For on-chain access gating where you transact directly. No separate agent key.
              </p>
            </button>
          </div>

          {/* Security explainer for selected mode */}
          <Card className="w-full">
            <div className="flex items-center gap-2 mb-3">
              <Lock size={16} className="text-accent" />
              <p className="font-bold text-sm">
                {mode === "simple" ? "How Verified Wallet works" : "How Agent Identity works"}
              </p>
            </div>
            {mode === "simple" ? (
              <ul className="text-sm text-muted space-y-1.5 list-disc list-inside">
                <li>
                  Connect your <strong className="text-foreground">browser wallet</strong> (MetaMask, etc.) &mdash;
                  that address becomes your on-chain identity.
                </li>
                <li>
                  Scan your passport with the <strong className="text-foreground">Self app</strong> &mdash;
                  a ZK proof binds your wallet to a unique human nullifier.
                </li>
                <li>
                  Smart contracts can then check{" "}
                  <code className="bg-surface-2 font-mono text-accent-2 px-1 rounded text-xs">isVerifiedAgent(your_address)</code>{" "}
                  to gate access to verified humans.
                </li>
                <li>
                  Best for <strong className="text-foreground">on-chain gating</strong> where you transact directly
                  (DAOs, token access). Not for autonomous agents.
                </li>
              </ul>
            ) : (
              <ul className="text-sm text-muted space-y-1.5 list-disc list-inside">
                <li>
                  Connect your <strong className="text-foreground">browser wallet</strong> (MetaMask, etc.) &mdash;
                  used only during registration to prove your identity.
                </li>
                <li>
                  A fresh <strong className="text-foreground">agent keypair</strong> is generated in your browser.
                  The agent signs a challenge to prove key ownership.
                </li>
                <li>
                  Scan your passport with the <strong className="text-foreground">Self app</strong> &mdash;
                  the contract verifies both the ZK proof and the agent&apos;s signature in one step.
                </li>
                <li>
                  Your agent operates with <strong className="text-foreground">its own key</strong> &mdash;
                  your wallet key is never exposed to agent software.
                </li>
              </ul>
            )}
          </Card>

          <Button onClick={() => setStep("connect")} variant="primary" size="lg">
            {mode === "simple" ? "Continue with Verified Wallet" : "Continue with Agent Identity"}
          </Button>
        </div>
      )}

      {/* Step 2: Connect wallet */}
      {step === "connect" && (
        <div className="flex flex-col items-center gap-4 w-full">
          {!walletAddress ? (
            <>
              <p className="text-muted text-center max-w-md">
                {mode === "simple"
                  ? "Connect your browser wallet (MetaMask, etc.). Your wallet address will become your agent\u2019s on-chain identity."
                  : "Connect your browser wallet (MetaMask, etc.). A new agent keypair will be generated and linked to your wallet."}
              </p>
              <Button onClick={handleConnect} variant="primary" size="lg">
                <Wallet size={18} />
                Connect Wallet
              </Button>
            </>
          ) : alreadyRegistered ? (
            <>
              <Card variant="warn" className="w-full text-center">
                <div className="flex items-center justify-center gap-2 mb-2">
                  <AlertTriangle size={18} className="text-accent-warn" />
                  <p className="font-bold text-accent-warn">Already Registered</p>
                </div>
                <p className="text-sm text-muted">
                  Wallet{" "}
                  <span className="font-mono text-foreground">
                    {walletAddress.slice(0, 6)}...{walletAddress.slice(-4)}
                  </span>{" "}
                  is already registered as an agent.
                </p>
              </Card>
              <Button
                onClick={() => {
                  const agentKey = ethers.zeroPadValue(walletAddress, 32);
                  router.push("/verify?key=" + encodeURIComponent(agentKey));
                }}
                variant="primary"
                size="lg"
              >
                View Agent
              </Button>
            </>
          ) : (
            <>
              <p className="text-sm text-muted">
                Wallet connected but Self SDK is loading...
              </p>
              <Button onClick={handleConnect} variant="primary">
                Retry
              </Button>
            </>
          )}
          {errorMessage && (
            <p className="text-sm text-accent-error">{errorMessage}</p>
          )}
          <Button
            onClick={() => {
              setStep("mode");
              setWalletAddress(null);
              setAlreadyRegistered(false);
              setErrorMessage("");
              setAgentWallet(null);
            }}
            variant="ghost"
          >
            <ChevronLeft size={16} />
            Back
          </Button>
        </div>
      )}

      {/* Step 3: Scan QR */}
      {step === "scan" && (
        <div className="flex flex-col items-center gap-4">
          <Card className="w-full text-center">
            {mode === "simple" ? (
              <>
                <p className="text-xs text-muted mb-1">Registering wallet as agent</p>
                <p className="font-mono text-sm">{walletAddress}</p>
              </>
            ) : (
              <>
                <p className="text-xs text-muted mb-1">
                  Registering agent{" "}
                  <span className="font-mono text-foreground">
                    {agentWallet?.address.slice(0, 6)}...{agentWallet?.address.slice(-4)}
                  </span>{" "}
                  under wallet
                </p>
                <p className="font-mono text-sm">{walletAddress}</p>
              </>
            )}
          </Card>
          <p className="text-muted text-center max-w-md">
            Scan this QR code with the Self App to verify your identity and
            register the agent.
          </p>
          {selfApp ? (
            <div className="rounded-xl p-4 bg-white">
              <SelfQRcodeWrapper
                selfApp={selfApp}
                onSuccess={handleSuccess}
                onError={handleError}
              />
            </div>
          ) : (
            <div className="w-64 h-64 bg-surface-2 animate-pulse flex items-center justify-center rounded-lg">
              <p className="text-muted text-sm">Loading QR Code...</p>
            </div>
          )}
          {errorMessage && (
            <Card variant="error" className="w-full max-w-md">
              <div className="flex items-center gap-2">
                <XCircle size={16} className="text-accent-error shrink-0" />
                <p className="text-sm text-accent-error">{errorMessage}</p>
              </div>
            </Card>
          )}
          <Button
            onClick={() => {
              setStep("connect");
              setSelfApp(null);
              setErrorMessage("");
            }}
            variant="ghost"
          >
            <ChevronLeft size={16} />
            Back
          </Button>
        </div>
      )}

      {/* Step 4: Success */}
      {step === "success" && (
        <div className="flex flex-col items-center gap-4 w-full">
          <CheckCircle2 size={48} className="text-accent-success" />
          <p className="text-lg font-medium text-accent-success">
            Agent registered successfully!
          </p>

          {mode === "simple" ? (
            <>
              <Card className="w-full">
                <p className="font-bold text-sm mb-3">Verified Wallet</p>
                <div className="space-y-3 text-sm">
                  <div>
                    <p className="text-xs text-muted mb-1">Your Wallet Address</p>
                    <p className="font-mono break-all bg-surface-2 border border-border rounded px-2 py-1">
                      {walletAddress}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-muted mb-1">On-chain Agent Key (bytes32)</p>
                    <p className="font-mono break-all bg-surface-2 border border-border rounded px-2 py-1 text-xs">
                      {walletAddress && ethers.zeroPadValue(walletAddress, 32)}
                    </p>
                  </div>
                </div>
              </Card>
              <Card className="w-full">
                <p className="font-bold text-sm mb-2">How this works</p>
                <ul className="text-xs text-muted space-y-1.5 list-disc list-inside">
                  <li>
                    Your wallet address is now registered as a <strong className="text-foreground">verified human</strong> on-chain.
                  </li>
                  <li>
                    Smart contracts can check{" "}
                    <code className="bg-surface-2 font-mono text-accent-2 px-1 rounded">isVerifiedAgent(bytes32(your_address))</code>{" "}
                    to gate access to verified humans only.
                  </li>
                  <li>
                    <strong className="text-foreground">You transact directly</strong> &mdash; there is no separate agent.
                    This is best for on-chain gating (DAOs, token access, DeFi).
                  </li>
                  <li>
                    For autonomous agents that sign requests to services,
                    use <strong className="text-foreground">Agent Identity</strong> mode instead.
                  </li>
                </ul>
              </Card>
            </>
          ) : (
            <>
              {/* Agent credentials */}
              <Card variant="warn" className="w-full">
                <div className="flex items-center gap-2 mb-1">
                  <AlertTriangle size={16} className="text-accent-warn" />
                  <p className="font-bold text-sm text-accent-warn">Agent Credentials</p>
                </div>
                <p className="text-sm text-muted mb-3">
                  A fresh Ethereum keypair was generated in your browser for your agent.
                  Copy these credentials now &mdash; the private key cannot be recovered
                  after you leave this page.
                </p>

                <div className="space-y-3">
                  <div>
                    <p className="text-xs font-medium text-accent-warn mb-1">
                      Agent Address
                      <span className="font-normal text-muted"> &mdash; your agent&apos;s public identity</span>
                    </p>
                    <div className="flex items-center gap-2">
                      <p className="font-mono break-all bg-surface-2 border border-border rounded px-2 py-1 text-sm flex-1">
                        {agentWallet?.address}
                      </p>
                      <button
                        onClick={() => copyToClipboard(agentWallet?.address || "")}
                        className="p-2 text-muted hover:text-foreground bg-surface-2 hover:bg-surface-1 rounded border border-border transition-colors shrink-0"
                        title="Copy"
                      >
                        <Copy size={14} />
                      </button>
                    </div>
                  </div>

                  <div>
                    <p className="text-xs font-medium text-accent-warn mb-1">
                      Agent Private Key
                      <span className="font-normal text-muted"> &mdash; used by your agent to sign requests</span>
                    </p>
                    <div className="flex items-center gap-2">
                      <p className="font-mono break-all bg-surface-2 border border-border rounded px-2 py-1 text-xs flex-1">
                        {showPrivateKey
                          ? agentWallet?.privateKey
                          : "\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022"}
                      </p>
                      <button
                        onClick={() => setShowPrivateKey(!showPrivateKey)}
                        className="p-2 text-muted hover:text-foreground bg-surface-2 hover:bg-surface-1 rounded border border-border transition-colors shrink-0"
                        title={showPrivateKey ? "Hide" : "Show"}
                      >
                        {showPrivateKey ? <EyeOff size={14} /> : <Eye size={14} />}
                      </button>
                      <button
                        onClick={() => copyToClipboard(agentWallet?.privateKey || "")}
                        className="p-2 text-muted hover:text-foreground bg-surface-2 hover:bg-surface-1 rounded border border-border transition-colors shrink-0"
                        title="Copy"
                      >
                        <Copy size={14} />
                      </button>
                    </div>
                  </div>
                </div>
              </Card>

              {/* How to use your agent */}
              <Card className="w-full">
                <p className="font-bold text-sm mb-1">How to use your agent</p>
                <p className="text-xs text-muted mb-3">
                  Set <code className="bg-surface-2 font-mono text-accent-2 px-1 rounded">AGENT_PRIVATE_KEY</code> in
                  your agent&apos;s environment, then use one of these patterns.
                  If the key is <strong className="text-foreground">lost</strong>, deregister and create a new agent.
                  If <strong className="text-foreground">leaked</strong>, deregister immediately.
                </p>

                <div className="flex gap-2 mb-3">
                  {getAgentSnippets().map((snippet, i) => (
                    <button
                      key={snippet.title}
                      onClick={() => setActiveAgentSnippet(i)}
                      className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${
                        i === activeAgentSnippet
                          ? "bg-gradient-to-r from-accent to-accent-2 text-white"
                          : "bg-surface-2 text-muted hover:text-foreground"
                      }`}
                    >
                      {snippet.title}
                    </button>
                  ))}
                </div>

                {(() => {
                  const snippets = getAgentSnippets();
                  const active = snippets[activeAgentSnippet];
                  return (
                    <>
                      <p className="text-xs text-muted mb-2">{active.description}</p>
                      <CodeBlock tabs={active.snippets} />
                    </>
                  );
                })()}
              </Card>

              {/* Registration details */}
              <Card className="w-full">
                <p className="font-bold text-sm mb-3">Registration Details</p>
                <div className="space-y-3 text-sm">
                  <div>
                    <p className="text-xs text-muted mb-1">
                      Registered by
                      <span className="text-subtle"> &mdash; your wallet, the NFT owner who can deregister</span>
                    </p>
                    <p className="font-mono break-all bg-surface-2 border border-border rounded px-2 py-1">
                      {walletAddress}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-muted mb-1">
                      Agent Key (bytes32)
                      <span className="text-subtle"> &mdash; the on-chain identifier services use to verify</span>
                    </p>
                    <p className="font-mono break-all bg-surface-2 border border-border rounded px-2 py-1 text-xs">
                      {agentWallet && ethers.zeroPadValue(agentWallet.address, 32)}
                    </p>
                  </div>
                </div>
              </Card>
            </>
          )}

          <Button
            onClick={() => {
              const key = mode === "simple"
                ? ethers.zeroPadValue(walletAddress!, 32)
                : ethers.zeroPadValue(agentWallet!.address, 32);
              router.push("/verify?key=" + encodeURIComponent(key));
            }}
            variant="primary"
            size="lg"
          >
            Verify Agent
          </Button>
        </div>
      )}
    </main>
  );
}
