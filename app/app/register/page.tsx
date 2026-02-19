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
  ChevronDown,
  ChevronUp,
  AlertTriangle,
  XCircle,
  CheckCircle2,
  Eye,
  EyeOff,
  Copy,
  Check,
  Smartphone,
  Fingerprint,
  Loader2,
  Shield,
  Rocket,
} from "lucide-react";
import MatrixRain from "@/components/MatrixRain";
import { connectWallet } from "@/lib/wallet";
import { REGISTRY_ADDRESS, RPC_URL, REGISTRY_ABI } from "@/lib/constants";
import { getAgentSnippets, AGENT_FEATURES } from "@/lib/snippets";
import CodeBlock from "@/components/CodeBlock";
import { Card } from "@/components/Card";
import { Badge } from "@/components/Badge";
import { Button } from "@/components/Button";
import { isPasskeySupported, createPasskeyWallet } from "@/lib/aa";
import { savePasskey } from "@/lib/passkey-storage";

// Dynamic import to avoid SSR issues with Self QR SDK
const SelfQRcodeWrapper = dynamic(
  () => import("@selfxyz/qrcode").then((mod) => mod.SelfQRcodeWrapper),
  { ssr: false }
);

// Import SelfAppBuilder separately (not a component)
let SelfAppBuilder: typeof import("@selfxyz/qrcode").SelfAppBuilder;

type Mode = "simple" | "advanced" | "walletfree" | "smartwallet";
type Step = "mode" | "connect" | "scan" | "success";

/** Map disclosure choices → config index digit (0-5) for the contract's configIds array */
function getConfigIndex(disc: { minimumAge: number; ofac: boolean }): string {
  if (disc.minimumAge === 18 && disc.ofac) return "4";
  if (disc.minimumAge === 21 && disc.ofac) return "5";
  if (disc.minimumAge === 18) return "1";
  if (disc.minimumAge === 21) return "2";
  if (disc.ofac) return "3";
  return "0"; // base — data disclosures only
}

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

  // Smart wallet mode state
  const [smartWalletAddress, setSmartWalletAddress] = useState<string | null>(null);
  const [passkeySupported, setPasskeySupported] = useState(true);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setPasskeySupported(isPasskeySupported());
  }, []);

  // Disclosure selection state
  const [showDisclosures, setShowDisclosures] = useState(false);
  const [disclosures, setDisclosures] = useState({
    nationality: false,
    name: false,
    date_of_birth: false,
    gender: false,
    issuing_state: false,
    ofac: false,
    minimumAge: 0,
  });

  // Advanced + wallet-free + smart-wallet mode state (all generate a keypair)
  const [agentWallet, setAgentWallet] = useState<ethers.HDNodeWallet | null>(null);
  const [showPrivateKey, setShowPrivateKey] = useState(false);
  const [showKeyInfo, setShowKeyInfo] = useState(false);
  const [activeAgentSnippet, setActiveAgentSnippet] = useState(0);
  const [activeAgentFeatures, setActiveAgentFeatures] = useState<Set<string>>(new Set());
  const [copiedField, setCopiedField] = useState<string | null>(null);

  const toggleAgentFeature = (id: string) => {
    setActiveAgentFeatures((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

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

  const buildSelfApp = (userId: string, userDefinedData: string) => {
    // Build disclosures from state — only include truthy fields
    const disc: Record<string, boolean | number> = {};
    if (disclosures.nationality) disc.nationality = true;
    if (disclosures.name) disc.name = true;
    if (disclosures.date_of_birth) disc.date_of_birth = true;
    if (disclosures.gender) disc.gender = true;
    if (disclosures.issuing_state) disc.issuing_state = true;
    if (disclosures.ofac) disc.ofac = true;
    if (disclosures.minimumAge > 0) disc.minimumAge = disclosures.minimumAge;

    return new SelfAppBuilder({
      version: 2,
      appName: process.env.NEXT_PUBLIC_SELF_APP_NAME || "Self Agent ID",
      scope: process.env.NEXT_PUBLIC_SELF_SCOPE_SEED || "self-agent-id",
      endpoint: REGISTRY_ADDRESS,
      logoBase64: "https://i.postimg.cc/mrmVf9hm/self.png",
      userId,
      endpointType: "staging_celo",
      userIdType: "hex",
      userDefinedData,
      disclosures: disc,
    }).build();
  };

  const signAgentChallenge = async (
    newWallet: ethers.Wallet | ethers.HDNodeWallet,
    humanIdentifier: string
  ) => {
    const messageHash = ethers.keccak256(
      ethers.solidityPacked(
        ["string", "address"],
        ["self-agent-id:register:", humanIdentifier]
      )
    );
    const signature = await newWallet.signMessage(ethers.getBytes(messageHash));
    return ethers.Signature.from(signature);
  };

  const handleConnect = async () => {
    setErrorMessage("");
    const address = await connectWallet();
    if (!address) return;

    setWalletAddress(address);

    if (mode === "simple") {
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

    const cfgIdx = getConfigIndex(disclosures);

    if (mode === "simple") {
      setSelfApp(buildSelfApp(address, "R" + cfgIdx));
      setStep("scan");
    } else {
      // Advanced mode: generate keypair, sign challenge
      const newWallet = ethers.Wallet.createRandom();
      setAgentWallet(newWallet as ethers.HDNodeWallet);

      const sig = await signAgentChallenge(newWallet, address);
      const agentAddrHex = newWallet.address.slice(2).toLowerCase();
      const rHex = sig.r.slice(2);
      const sHex = sig.s.slice(2);
      const vHex = sig.v.toString(16).padStart(2, "0");
      const userDefinedData = "K" + cfgIdx + agentAddrHex + rHex + sHex + vHex;

      setSelfApp(buildSelfApp(address, userDefinedData));
      setStep("scan");
    }
  };

  const handleWalletFreeStart = async () => {
    setErrorMessage("");

    if (!SelfAppBuilder) {
      setErrorMessage("Self SDK still loading. Please try again.");
      return;
    }

    // Generate agent keypair (no wallet needed)
    const newWallet = ethers.Wallet.createRandom();
    setAgentWallet(newWallet as ethers.HDNodeWallet);

    // For wallet-free, userId is the agent's address (the human has no wallet)
    const agentAddress = newWallet.address.toLowerCase();

    // Sign challenge with agentAddress as the "humanIdentifier"
    // The contract uses humanAddress from output.userIdentifier (which will be agentAddress)
    const sig = await signAgentChallenge(newWallet, agentAddress);

    // Build "W" + config(1) + agentAddr(40) + guardian(40) + r(64) + s(64) + v(2) = 212 chars
    const cfgIdx = getConfigIndex(disclosures);
    const agentAddrHex = newWallet.address.slice(2).toLowerCase();
    const guardianHex = "0".repeat(40); // no guardian (address(0))
    const rHex = sig.r.slice(2);
    const sHex = sig.s.slice(2);
    const vHex = sig.v.toString(16).padStart(2, "0");
    const userDefinedData = "W" + cfgIdx + agentAddrHex + guardianHex + rHex + sHex + vHex;

    setSelfApp(buildSelfApp(agentAddress, userDefinedData));
    setStep("scan");
  };

  const handleSmartWalletStart = async () => {
    setErrorMessage("");
    setLoading(true);

    if (!SelfAppBuilder) {
      setErrorMessage("Self SDK still loading. Please try again.");
      setLoading(false);
      return;
    }

    try {
      // 1. Create passkey → Kernel smart wallet (counterfactual)
      const { credentialId, walletAddress: swAddress } =
        await createPasskeyWallet("Self Agent ID");
      setSmartWalletAddress(swAddress);

      // 2. Generate agent keypair
      const newWallet = ethers.Wallet.createRandom();
      setAgentWallet(newWallet as ethers.HDNodeWallet);

      // 3. Agent signs challenge
      const agentAddress = newWallet.address.toLowerCase();
      const sig = await signAgentChallenge(newWallet, agentAddress);

      // 4. Build userDefinedData: "W" + config(1) + agentAddr(40) + smartWalletAddr(40) + r(64) + s(64) + v(2)
      const cfgIdx = getConfigIndex(disclosures);
      const agentAddrHex = newWallet.address.slice(2).toLowerCase();
      const guardianHex = swAddress.slice(2).toLowerCase();
      const rHex = sig.r.slice(2);
      const sHex = sig.s.slice(2);
      const vHex = sig.v.toString(16).padStart(2, "0");
      const userDefinedData = "W" + cfgIdx + agentAddrHex + guardianHex + rHex + sHex + vHex;

      // 5. Save passkey for later sign-in
      savePasskey({
        credentialId,
        walletAddress: swAddress,
        createdAt: Date.now(),
      });

      setSelfApp(buildSelfApp(agentAddress, userDefinedData));
      setStep("scan");
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setErrorMessage(`Passkey creation failed: ${msg}`);
    } finally {
      setLoading(false);
    }
  };

  const handleSuccess = () => {
    setStep("success");
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const handleError = (error: unknown) => {
    const msg = error instanceof Error ? error.message : String(error);
    if (msg.includes("AlreadyRegistered") || msg.includes("already")) {
      setErrorMessage("This agent is already registered.");
    } else {
      setErrorMessage(`Verification failed: ${msg}`);
    }
  };

  const copyToClipboard = (text: string, field: string) => {
    navigator.clipboard.writeText(text);
    setCopiedField(field);
    setTimeout(() => setCopiedField(null), 2000);
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
                <span className="font-bold text-sm">Agent Identity</span>
              </div>
              <Badge variant="success">recommended</Badge>
              <p className="text-xs text-muted mt-2">
                Agent gets its own independent keypair. Your wallet key stays safe.
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
                <span className="font-bold text-sm">Verified Wallet</span>
              </div>
              <p className="text-xs text-muted mt-2">
                Your wallet address = agent identity. For on-chain gating.
              </p>
            </button>

            {/* Wallet-free mode card */}
            <button
              onClick={() => setMode("walletfree")}
              className={`text-left p-5 rounded-xl border-2 transition-all ${
                mode === "walletfree"
                  ? "border-accent bg-surface-2"
                  : "border-border hover:border-border-strong"
              }`}
            >
              <div className="flex items-center gap-2 mb-2">
                <span className="w-8 h-8 rounded-full bg-accent/20 flex items-center justify-center">
                  <Smartphone size={16} className="text-accent" />
                </span>
                <span className="font-bold text-sm">No Wallet</span>
              </div>
              <p className="text-xs text-muted mt-2">
                No crypto wallet needed. Just your passport and the Self app.
              </p>
            </button>

            {/* Smart Wallet mode card */}
            <button
              onClick={() => passkeySupported && setMode("smartwallet")}
              className={`text-left p-5 rounded-xl border-2 transition-all ${
                !passkeySupported
                  ? "border-border opacity-50 cursor-not-allowed"
                  : mode === "smartwallet"
                    ? "border-accent-success bg-surface-2"
                    : "border-border hover:border-border-strong"
              }`}
            >
              <div className="flex items-center gap-2 mb-2">
                <span className="w-8 h-8 rounded-full bg-accent-success/20 flex items-center justify-center">
                  <Fingerprint size={16} className="text-accent-success" />
                </span>
                <span className="font-bold text-sm">Smart Wallet</span>
              </div>
              <p className="text-xs text-muted mt-2">
                {passkeySupported
                  ? "Face ID or fingerprint. No MetaMask, no seed phrase. Gasless."
                  : "Passkeys not supported in this browser."}
              </p>
            </button>
          </div>

          {/* Security explainer for selected mode */}
          <Card className="w-full">
            <div className="flex items-center gap-2 mb-3">
              <Lock size={16} className="text-accent" />
              <p className="font-bold text-sm">
                {mode === "simple"
                  ? "How Verified Wallet works"
                  : mode === "advanced"
                    ? "How Agent Identity works"
                    : mode === "smartwallet"
                      ? "How Smart Wallet works"
                      : "How No Wallet works"}
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
            ) : mode === "advanced" ? (
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
            ) : mode === "smartwallet" ? (
              <ul className="text-sm text-muted space-y-1.5 list-disc list-inside">
                <li>
                  A <strong className="text-foreground">passkey</strong> (Face ID / fingerprint) creates a
                  Kernel smart account &mdash; no MetaMask, no seed phrase.
                </li>
                <li>
                  A fresh <strong className="text-foreground">agent keypair</strong> is also generated.
                  The agent signs requests with its own ECDSA key.
                </li>
                <li>
                  The smart wallet becomes the <strong className="text-foreground">guardian</strong> &mdash;
                  you can revoke your agent anytime with your biometrics, gaslessly.
                </li>
                <li>
                  The smart wallet <strong className="text-foreground">deploys on first use</strong> (counterfactual).
                  All management transactions are sponsored &mdash; no gas needed.
                </li>
              </ul>
            ) : (
              <>
                <ul className="text-sm text-muted space-y-1.5 list-disc list-inside">
                  <li>
                    <strong className="text-foreground">No crypto wallet required.</strong> You only need
                    the Self app on your phone and a valid passport.
                  </li>
                  <li>
                    A fresh <strong className="text-foreground">agent keypair</strong> is generated in your browser.
                    The agent owns its own on-chain identity NFT.
                  </li>
                  <li>
                    Scan your passport with the <strong className="text-foreground">Self app</strong> &mdash;
                    the contract verifies your identity and mints the NFT to the agent&apos;s address.
                  </li>
                  <li>
                    You can <strong className="text-foreground">deregister anytime</strong> by scanning your passport
                    again &mdash; the ZK proof links back to your unique human identity.
                  </li>
                </ul>

                {/* Expandable key management info */}
                <button
                  onClick={() => setShowKeyInfo(!showKeyInfo)}
                  className="flex items-center gap-2 mt-4 pt-3 border-t border-border text-sm font-medium text-accent hover:text-accent-2 transition-colors w-full"
                >
                  {showKeyInfo ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                  How do I manage my agent&apos;s key?
                </button>

                {showKeyInfo && (
                  <div className="mt-3 space-y-3 text-sm text-muted">
                    <p>
                      When you register, a <strong className="text-foreground">private key</strong> is generated
                      in your browser. This key controls your agent&apos;s on-chain identity. You must save it securely.
                    </p>
                    <div className="bg-surface-2 rounded-lg p-3 space-y-2">
                      <p className="font-bold text-foreground text-xs">Key management tips:</p>
                      <ul className="text-xs space-y-1 list-disc list-inside">
                        <li>Copy the private key and store it in a password manager (1Password, Bitwarden, etc.)</li>
                        <li>Never share the private key with anyone</li>
                        <li>Your agent software uses this key to sign requests and prove its identity</li>
                        <li>If the key is lost, you can deregister by scanning your passport and create a new agent</li>
                      </ul>
                    </div>

                    <div className="bg-accent-success/5 border border-accent-success/20 rounded-lg p-3">
                      <div className="flex items-center gap-2 mb-1">
                        <Fingerprint size={14} className="text-accent-success" />
                        <p className="font-bold text-foreground text-xs">Prefer passkeys?</p>
                      </div>
                      <p className="text-xs text-muted">
                        Try <strong className="text-foreground">Smart Wallet</strong> mode instead &mdash; uses
                        Face ID or fingerprint to create a smart account as guardian. No raw keys to manage.
                      </p>
                    </div>
                  </div>
                )}
              </>
            )}
          </Card>

          {/* Disclosure toggles */}
          <Card className="w-full">
            <button
              type="button"
              onClick={() => setShowDisclosures((v) => !v)}
              className="flex items-center gap-2 w-full text-left"
            >
              <Shield size={16} className="text-accent" />
              <p className="font-bold text-sm">Credential Disclosures</p>
              <span className="text-xs text-subtle">(optional)</span>
              {showDisclosures ? (
                <ChevronUp size={16} className="ml-auto text-muted" />
              ) : (
                <ChevronDown size={16} className="ml-auto text-muted" />
              )}
            </button>

            {showDisclosures && (
              <div className="mt-3">
                <p className="text-xs text-muted mb-2">
                  Choose what your agent can carry as verified claims. Your raw passport data
                  is <strong className="text-foreground">never stored or shared</strong> &mdash;
                  the Self app generates a <strong className="text-foreground">zero-knowledge proof</strong> on
                  your phone, and only the attested result (e.g. &ldquo;nationality: GBR&rdquo; or
                  &ldquo;over 18&rdquo;) is stored on-chain. No personal documents ever leave your device.
                </p>
                <p className="text-xs text-muted mb-4">
                  All disclosures are optional. Unselected fields are not included.
                </p>

                <div className="grid grid-cols-2 gap-2 mb-4">
                  {([
                    ["nationality", "Nationality", false],
                    ["name", "Full Name", false],
                    ["date_of_birth", "Date of Birth", false],
                    ["gender", "Gender", false],
                    ["issuing_state", "Issuing State", false],
                    ["ofac", "Not on OFAC List", false],
                  ] as const).map(([key, label, disabled]) => (
                    <label
                      key={key}
                      className={`flex items-center gap-2 px-3 py-2 rounded-lg bg-surface-2 border border-border transition-colors text-sm ${
                        disabled
                          ? "opacity-40 cursor-not-allowed"
                          : "hover:border-border-strong cursor-pointer"
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={disclosures[key] as boolean}
                        disabled={disabled}
                        onChange={(e) =>
                          setDisclosures((d) => ({ ...d, [key]: e.target.checked }))
                        }
                        className="rounded border-border text-accent focus:ring-accent"
                      />
                      {label}
                      {disabled && <span className="text-xs text-subtle ml-auto">coming soon</span>}
                    </label>
                  ))}
                </div>

                <div className="flex items-center gap-3">
                  <label className="text-sm text-muted">Age Verification</label>
                  <select
                    value={disclosures.minimumAge}
                    onChange={(e) =>
                      setDisclosures((d) => ({ ...d, minimumAge: Number(e.target.value) }))
                    }
                    className="bg-surface-2 border border-border rounded-lg px-3 py-1.5 text-sm focus:border-accent focus:outline-none"
                  >
                    <option value={0}>None</option>
                    <option value={18}>Over 18</option>
                    <option value={21}>Over 21</option>
                  </select>
                </div>
              </div>
            )}
          </Card>

          {mode === "walletfree" ? (
            <Button onClick={handleWalletFreeStart} variant="primary" size="lg">
              <Smartphone size={18} />
              Generate Agent &amp; Scan Passport
            </Button>
          ) : mode === "smartwallet" ? (
            <Button onClick={handleSmartWalletStart} variant="primary" size="lg" disabled={loading}>
              {loading ? (
                <>
                  <Loader2 size={18} className="animate-spin" />
                  Creating Passkey...
                </>
              ) : (
                <>
                  <Fingerprint size={18} />
                  Create Passkey &amp; Generate Agent
                </>
              )}
            </Button>
          ) : (
            <Button onClick={() => setStep("connect")} variant="primary" size="lg">
              {mode === "simple" ? "Continue with Verified Wallet" : "Continue with Agent Identity"}
            </Button>
          )}

          {errorMessage && (
            <p className="text-sm text-accent-error text-center">{errorMessage}</p>
          )}
        </div>
      )}

      {/* Step 2: Connect wallet (not shown for wallet-free mode) */}
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
            ) : mode === "advanced" ? (
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
            ) : mode === "smartwallet" ? (
              <>
                <div className="flex items-center justify-center gap-2 mb-1">
                  <Fingerprint size={14} className="text-accent-success" />
                  <p className="text-xs text-muted">Smart Wallet registration</p>
                </div>
                <p className="text-xs text-muted mb-1">Agent address</p>
                <p className="font-mono text-sm">{agentWallet?.address}</p>
                <p className="text-xs text-muted mt-2">
                  Guardian (smart wallet):{" "}
                  <span className="font-mono text-foreground">
                    {smartWalletAddress?.slice(0, 6)}...{smartWalletAddress?.slice(-4)}
                  </span>
                </p>
              </>
            ) : (
              <>
                <div className="flex items-center justify-center gap-2 mb-1">
                  <Smartphone size={14} className="text-accent" />
                  <p className="text-xs text-muted">Wallet-free registration</p>
                </div>
                <p className="text-xs text-muted mb-1">
                  Agent address (will own the NFT)
                </p>
                <p className="font-mono text-sm">{agentWallet?.address}</p>
              </>
            )}
          </Card>
          <Card className="w-full max-w-md">
            <div className="flex items-center gap-2 mb-3">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/self-icon.png" alt="Self" width={28} height={28} className="rounded" />
              <p className="font-bold text-sm">Scan with the Self App</p>
            </div>
            <p className="text-sm text-muted mb-3">
              Self uses <strong className="text-foreground">zero-knowledge cryptography</strong> to
              prove you&apos;re a real person without storing or sharing your personal data.
              Your passport is scanned locally on your phone &mdash; only a mathematical
              proof is sent, never your documents.
            </p>
            <div className="flex gap-2">
              <a
                href="https://apps.apple.com/us/app/self/id6446136401"
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1.5 px-3 py-1.5 bg-surface-2 border border-border rounded-lg text-xs font-medium hover:border-border-strong transition-colors"
              >
                {/* Apple icon */}
                <svg viewBox="0 0 384 512" width="14" height="14" fill="currentColor"><path d="M318.7 268.7c-.2-36.7 16.4-64.4 50-84.8-18.8-26.9-47.2-41.7-84.7-44.6-35.5-2.8-74.3 20.7-88.5 20.7-15 0-49.4-19.7-76.4-19.7C63.3 141.2 4 184.8 4 273.5c0 26.2 4.8 53.3 14.4 81.2 12.8 36.7 59 126.7 107.2 125.2 25.2-.6 43-17.9 75.8-17.9 31.8 0 48.3 17.9 76.4 17.9 48.6-.7 90.4-82.5 102.6-119.3-65.2-30.7-61.7-90-61.7-91.9zm-56.6-164.2c27.3-32.4 24.8-61.9 24-72.5-24.1 1.4-52 16.4-67.9 34.9-17.5 19.8-27.8 44.3-25.6 71.9 26.1 2 49.9-11.4 69.5-34.3z"/></svg>
                App Store
              </a>
              <a
                href="https://play.google.com/store/apps/details?id=com.proofofpassportapp"
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1.5 px-3 py-1.5 bg-surface-2 border border-border rounded-lg text-xs font-medium hover:border-border-strong transition-colors"
              >
                {/* Play Store icon */}
                <svg viewBox="0 0 512 512" width="14" height="14" fill="currentColor"><path d="M325.3 234.3L104.6 13l280.8 161.2-60.1 60.1zM47 0C34 6.8 25.3 19.2 25.3 35.3v441.3c0 16.1 8.7 28.5 21.7 35.3l256.6-256L47 0zm425.2 225.6l-58.9-34.1-65.7 64.5 65.7 64.5 60.1-34.1c18-14.3 18-46.5-1.2-60.8zM104.6 499l280.8-161.2-60.1-60.1L104.6 499z"/></svg>
                Google Play
              </a>
            </div>
          </Card>
          {mode === "smartwallet" && smartWalletAddress && (
            <div className="bg-accent/5 border border-accent/20 rounded-lg px-4 py-3 text-xs text-muted w-full max-w-md">
              <strong className="text-foreground">Testnet:</strong> On Celo Sepolia, the smart wallet is computed
              but not deployed. Gasless passkey operations are available on Celo Mainnet.
            </div>
          )}
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
              if (mode === "walletfree" || mode === "smartwallet") {
                setStep("mode");
                setAgentWallet(null);
                setSmartWalletAddress(null);
              } else {
                setStep("connect");
              }
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
          <MatrixRain duration={2000} fadeOut={2000} speed={3} maxOpacity={0.3} />
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
              {/* Agent credentials (shown for both advanced and walletfree) */}
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
                        onClick={() => copyToClipboard(agentWallet?.address || "", "address")}
                        className="p-2 text-muted hover:text-foreground bg-surface-2 hover:bg-surface-1 rounded border border-border transition-colors shrink-0"
                        title="Copy"
                      >
                        {copiedField === "address" ? <Check size={14} className="text-accent-success" /> : <Copy size={14} />}
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
                        onClick={() => copyToClipboard(agentWallet?.privateKey || "", "privateKey")}
                        className="p-2 text-muted hover:text-foreground bg-surface-2 hover:bg-surface-1 rounded border border-border transition-colors shrink-0"
                        title="Copy"
                      >
                        {copiedField === "privateKey" ? <Check size={14} className="text-accent-success" /> : <Copy size={14} />}
                      </button>
                    </div>
                  </div>
                </div>
              </Card>

              {/* How to use your agent */}
              <div className="w-full space-y-3">
                <p className="font-bold text-sm">How to use your agent</p>
                <p className="text-xs text-muted">
                  Set <code className="bg-surface-2 font-mono text-accent-2 px-1 rounded">AGENT_PRIVATE_KEY</code> in
                  your agent&apos;s environment, then use one of these patterns.
                  If the key is <strong className="text-foreground">lost</strong>, deregister and create a new agent.
                  If <strong className="text-foreground">leaked</strong>, deregister immediately.
                </p>

                {(() => {
                  const agentSnippets = getAgentSnippets(activeAgentFeatures);
                  return (
                    <>
                      <div className="flex gap-2 flex-wrap">
                        {agentSnippets.map((snippet, i) => (
                          <button
                            key={snippet.title}
                            onClick={() => setActiveAgentSnippet(i)}
                            className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
                              i === activeAgentSnippet
                                ? "bg-gradient-to-r from-accent to-accent-2 text-white"
                                : "bg-surface-2 text-muted hover:text-foreground"
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

                      <p className="text-xs text-muted">{agentSnippets[activeAgentSnippet].description}</p>
                      <CodeBlock tabs={agentSnippets[activeAgentSnippet].snippets} />
                    </>
                  );
                })()}
              </div>

              {/* Registration details */}
              <Card className="w-full">
                <p className="font-bold text-sm mb-3">Registration Details</p>
                <div className="space-y-3 text-sm">
                  {mode === "walletfree" || mode === "smartwallet" ? (
                    <>
                      <div>
                        <p className="text-xs text-muted mb-1">
                          Registration Mode
                        </p>
                        <div className="flex items-center gap-2">
                          {mode === "smartwallet" ? (
                            <>
                              <Badge variant="success">Smart Wallet</Badge>
                              <span className="text-xs text-muted">Passkey guardian, gasless management</span>
                            </>
                          ) : (
                            <>
                              <Badge variant="info">Wallet-Free</Badge>
                              <span className="text-xs text-muted">Agent owns its own NFT</span>
                            </>
                          )}
                        </div>
                      </div>
                      <div>
                        <p className="text-xs text-muted mb-1">
                          NFT Owner
                          <span className="text-subtle"> &mdash; the agent&apos;s address (self-owned)</span>
                        </p>
                        <p className="font-mono break-all bg-surface-2 border border-border rounded px-2 py-1">
                          {agentWallet?.address}
                        </p>
                      </div>
                      {mode === "smartwallet" && smartWalletAddress && (
                        <div>
                          <p className="text-xs text-muted mb-1">
                            Guardian (Smart Wallet)
                            <span className="text-subtle"> &mdash; your passkey controls this address</span>
                          </p>
                          <p className="font-mono break-all bg-surface-2 border border-border rounded px-2 py-1">
                            {smartWalletAddress}
                          </p>
                        </div>
                      )}
                    </>
                  ) : (
                    <div>
                      <p className="text-xs text-muted mb-1">
                        Registered by
                        <span className="text-subtle"> &mdash; your wallet, the NFT owner who can deregister</span>
                      </p>
                      <p className="font-mono break-all bg-surface-2 border border-border rounded px-2 py-1">
                        {walletAddress}
                      </p>
                    </div>
                  )}
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

              {mode === "smartwallet" && (
                <Card className="w-full">
                  <div className="flex items-center gap-2 mb-2">
                    <Fingerprint size={16} className="text-accent-success" />
                    <p className="font-bold text-sm">Passkey Management</p>
                  </div>
                  <p className="text-xs text-muted">
                    Your passkey can revoke this agent anytime via Face ID / fingerprint.
                    Visit <strong className="text-foreground">My Agents</strong> and sign in with your passkey
                    to manage your agent gaslessly. The smart wallet deploys on first management action.
                  </p>
                </Card>
              )}

              {mode === "walletfree" && (
                <Card className="w-full">
                  <p className="font-bold text-sm mb-2">How to deregister</p>
                  <p className="text-xs text-muted">
                    Since no wallet was used, you can deregister by visiting the{" "}
                    <strong className="text-foreground">Verify</strong> page, looking up your agent,
                    and scanning your passport again. The ZK proof links to your unique identity &mdash;
                    only you can deregister your agent.
                  </p>
                </Card>
              )}
            </>
          )}

          <div className="flex gap-3">
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
            <Button
              onClick={() => {
                // Pass the agent private key to demo page via sessionStorage
                // so it auto-fills — key is cleared after demo page reads it
                const pk = mode === "simple"
                  ? undefined  // simple mode uses wallet, no separate agent key
                  : agentWallet?.privateKey;
                if (pk) sessionStorage.setItem("demo-agent-key", pk);
                router.push("/demo");
              }}
              variant="secondary"
              size="lg"
            >
              <Rocket size={18} />
              Try Demo
            </Button>
          </div>
        </div>
      )}
    </main>
  );
}
