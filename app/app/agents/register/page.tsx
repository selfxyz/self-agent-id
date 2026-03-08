"use client";

import React, { useState, useEffect, useMemo, useRef } from "react";

import { useRouter } from "next/navigation";
import Link from "next/link";
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
  Terminal,
  Bot,
} from "lucide-react";
import { PrivyIcon } from "@/components/PrivyIcon";
import { connectWallet } from "@/lib/wallet";
import {} from "@/lib/constants";
import { useNetwork } from "@/lib/NetworkContext";
import { getAgentSnippets, AGENT_FEATURES } from "@/lib/snippets";
import CodeBlock from "@/components/CodeBlock";
import { Card } from "@/components/Card";
import { Badge } from "@/components/Badge";
import { Button } from "@/components/Button";
import { isPasskeySupported, createPasskeyWallet } from "@/lib/aa";
import { savePasskey } from "@/lib/passkey-storage";
import { saveAgentPrivateKey } from "@/lib/agentKeyVault";
import { usePrivyState, isPrivyConfigured } from "@/lib/privy";

import { typedRegistry } from "@/lib/contract-types";
import { writeAgentCard as writeAgentCardShared } from "@/lib/writeAgentCard";
import {
  computeEd25519ChallengeHash,
  computeExtKpub,
  buildEd25519UserData,
  isValidEd25519PubkeyHex,
  base64ToHex,
  deriveEd25519Address,
} from "@/lib/ed25519";
// Dynamic import to avoid SSR issues with Self QR SDK
const SelfQRcodeWrapper = dynamic(
  () => import("@selfxyz/qrcode").then((mod) => mod.SelfQRcodeWrapper),
  { ssr: false },
);

// SelfAppBuilder loaded lazily on client side
let SelfAppBuilderClass:
  | typeof import("@selfxyz/qrcode").SelfAppBuilder
  | null = null;

type Mode = "self-custody" | "linked" | "walletfree" | "smartwallet" | "privy" | "ed25519" | "ed25519-linked";
type AgentPath = "onchain" | "offchain" | null;
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
  const { network } = useNetwork();
  const [mode, setMode] = useState<Mode>("linked");
  const [agentPath, setAgentPath] = useState<AgentPath>(null);
  const [walletAddress, setWalletAddress] = useState<string | null>(null);
  const [selfApp, setSelfApp] = useState<ReturnType<
    InstanceType<typeof import("@selfxyz/qrcode").SelfAppBuilder>["build"]
  > | null>(null);
  const [step, setStep] = useState<Step>("mode");
  const [alreadyRegistered, setAlreadyRegistered] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");

  // Smart wallet mode state
  const [smartWalletAddress, setSmartWalletAddress] = useState<string | null>(
    null,
  );
  const [passkeySupported, setPasskeySupported] = useState(true);
  const [loading, setLoading] = useState(false);

  // Ed25519 mode state
  const [ed25519PubkeyInput, setEd25519PubkeyInput] = useState("");
  const [ed25519PubkeyHex, setEd25519PubkeyHex] = useState<string | null>(null);
  const [ed25519SignatureInput, setEd25519SignatureInput] = useState("");
  const [ed25519ChallengeHex, setEd25519ChallengeHex] = useState<string | null>(null);
  const [ed25519Step, setEd25519Step] = useState<"pubkey" | "challenge" | "signature" | "scan">("pubkey");

  // Privy mode state
  const [privyWalletAddress, setPrivyWalletAddress] = useState<string | null>(
    null,
  );

  const {
    login: privyLogin,
    ready: privyReady,
    authenticated: privyAuthenticated,
    wallets: privyWallets,
  } = usePrivyState();
  const pendingRedirect = useRef(false);

  useEffect(() => {
    setPasskeySupported(isPasskeySupported());
    // Restore mode after Privy OAuth redirect (deferred to avoid hydration mismatch).
    // Consume and clear immediately — the ref carries the signal to the registration useEffect.
    const saved = sessionStorage.getItem("register-mode");
    if (saved === "privy") {
      sessionStorage.removeItem("register-mode");
      pendingRedirect.current = true;
      setMode("privy");
    }
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
  const [agentWallet, setAgentWallet] = useState<ethers.HDNodeWallet | null>(
    null,
  );
  const [showPrivateKey, setShowPrivateKey] = useState(false);
  const [showKeyInfo, setShowKeyInfo] = useState(false);
  const [activeAgentSnippet, setActiveAgentSnippet] = useState(0);
  const [activeAgentFeatures, setActiveAgentFeatures] = useState<Set<string>>(
    new Set(),
  );

  // Guard against double-triggering handleSuccess (websocket + on-chain poll race)
  const successTriggeredRef = useRef(false);

  // Agent Card flow state
  const [cardStep, setCardStep] = useState<
    "pending" | "writing" | "done" | "skipped"
  >("pending");
  const [verificationStrength, setVerificationStrength] = useState<
    number | null
  >(null);
  const [showCardJson, setShowCardJson] = useState(false);
  const [cardJson, setCardJson] = useState<string>("");
  const [agentIdResult, setAgentIdResult] = useState<string | null>(null);
  const [copiedField, setCopiedField] = useState<string | null>(null);

  const agentSnippets = useMemo(
    () =>
      getAgentSnippets(
        network.registryAddress,
        network.rpcUrl,
        activeAgentFeatures,
      ),
    [network.registryAddress, network.rpcUrl, activeAgentFeatures],
  );

  // On-chain polling fallback: if websocket misses "proof_verified",
  // poll the contract to detect successful registration while on the scan step.
  useEffect(() => {
    if (step !== "scan") return;
    // For Ed25519 mode, poll using the pubkey as agentKey
    if (mode === "ed25519") {
      if (!ed25519PubkeyHex) return;
      const agentKey = "0x" + ed25519PubkeyHex.padStart(64, "0");
      const interval = setInterval(() => {
        void (async () => {
          try {
            const provider = new ethers.JsonRpcProvider(network.rpcUrl);
            const registry = typedRegistry(network.registryAddress, provider);
            const isVerified = await registry.isVerifiedAgent(agentKey);
            if (isVerified) {
              console.log("[on-chain poll] Ed25519 agent registered, triggering success");
              clearInterval(interval);
              handleSuccess();
            }
          } catch (err) {
            console.warn("[on-chain poll] Ed25519 check failed:", err);
          }
        })();
      }, 5000);
      return () => clearInterval(interval);
    }

    const addressToCheck =
      mode === "self-custody" ? walletAddress : agentWallet?.address;
    if (!addressToCheck) return;

    const interval = setInterval(() => {
      void (async () => {
        try {
          const registered = await checkIfRegistered(addressToCheck);
          if (registered) {
            console.log(
              "[on-chain poll] Agent registered on-chain, triggering success",
            );
            clearInterval(interval);
            handleSuccess();
          }
        } catch (err) {
          console.warn("[on-chain poll] Check failed:", err);
        }
      })();
    }, 5000); // poll every 5 seconds

    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, mode, walletAddress, agentWallet?.address]);

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
    import("@selfxyz/qrcode")
      .then((mod) => {
        SelfAppBuilderClass = mod.SelfAppBuilder;
      })
      .catch((err) => {
        console.error("Failed to load @selfxyz/qrcode:", err);
      });
  }, []);

  const checkIfRegistered = async (address: string): Promise<boolean> => {
    try {
      const provider = new ethers.JsonRpcProvider(network.rpcUrl);
      const registry = typedRegistry(network.registryAddress, provider);
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

    return new SelfAppBuilderClass!({
      version: 2,
      appName: process.env.NEXT_PUBLIC_SELF_APP_NAME || "Self Agent ID",
      scope: process.env.NEXT_PUBLIC_SELF_SCOPE_SEED || "self-agent-id",
      endpoint: network.registryAddress.toLowerCase(),
      logoBase64: "https://i.postimg.cc/mrmVf9hm/self.png",
      userId,
      endpointType: network.selfEndpointType,
      userIdType: "hex",
      userDefinedData,
      disclosures: disc,
    }).build();
  };

  const signAgentChallenge = async (
    newWallet: ethers.Wallet | ethers.HDNodeWallet,
    humanIdentifier: string,
  ) => {
    // Read per-agent nonce from registry to prevent signature replay attacks.
    // New agents have nonce = 0; nonce increments on each successful registration.
    const provider = new ethers.JsonRpcProvider(network.rpcUrl);
    const registry = typedRegistry(network.registryAddress, provider);
    const nonce: bigint = await registry.agentNonces(newWallet.address);

    // Challenge format matches _verifyAgentSignature in SelfAgentRegistry:
    // keccak256("self-agent-id:register:" + humanAddress + chainId + registry + nonce)
    const messageHash = ethers.keccak256(
      ethers.solidityPacked(
        ["string", "address", "uint256", "address", "uint256"],
        [
          "self-agent-id:register:",
          humanIdentifier,
          BigInt(network.chainId),
          network.registryAddress,
          nonce,
        ],
      ),
    );

    const signature = await newWallet.signMessage(ethers.getBytes(messageHash));
    const sig = ethers.Signature.from(signature);

    return sig;
  };

  // --- Ed25519 handler functions ---

  const handleEd25519ValidateKey = async () => {
    setErrorMessage("");
    let hex = ed25519PubkeyInput.trim();

    // Try base64 if not valid hex
    if (!/^[0-9a-fA-F]{64}$/.test(hex)) {
      try {
        hex = base64ToHex(hex);
      } catch {
        setErrorMessage("Invalid key. Paste 64 hex chars or 44-char base64.");
        return;
      }
    }

    if (!isValidEd25519PubkeyHex(hex)) {
      setErrorMessage("Invalid Ed25519 public key — not a valid curve point.");
      return;
    }

    setEd25519PubkeyHex(hex);

    // Fetch nonce from contract
    try {
      const provider = new ethers.JsonRpcProvider(network.rpcUrl);
      const registry = typedRegistry(network.registryAddress, provider);
      const pubkeyBytes32 = "0x" + hex.padStart(64, "0");
      const nonce: bigint = await registry.ed25519Nonce(pubkeyBytes32);

      // The humanAddress is unknown at this point — it comes from the ZK proof.
      // Use address(0) as placeholder; the contract derives humanAddress from output.userIdentifier.
      // Actually, for the challenge, we need to use the same address the contract will see.
      // In the Ed25519 flow, the userId passed to Self app becomes the humanAddress.
      // We use the derived address as the userId.
      const derivedAddr = deriveEd25519Address(hex);

      const challengeHash = computeEd25519ChallengeHash({
        humanAddress: derivedAddr,
        chainId: BigInt(network.chainId),
        registryAddress: network.registryAddress,
        nonce,
      });

      setEd25519ChallengeHex(challengeHash);
      setEd25519Step("challenge");
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setErrorMessage(`Failed to fetch nonce: ${msg}`);
    }
  };

  const handleEd25519SubmitSignature = async () => {
    setErrorMessage("");
    const sigHex = ed25519SignatureInput.trim().replace(/^0x/, "");

    if (!/^[0-9a-fA-F]{128}$/.test(sigHex)) {
      setErrorMessage("Invalid signature. Must be 128 hex characters (64 bytes).");
      return;
    }

    if (!ed25519PubkeyHex) return;

    try {
      setLoading(true);

      // Compute extKpub (this is computationally intensive)
      const extKpub = computeExtKpub(ed25519PubkeyHex);

      // Build userData
      const cfgIdx = getConfigIndex(disclosures);
      const userData = buildEd25519UserData({
        configIndex: parseInt(cfgIdx),
        ed25519Pubkey: ed25519PubkeyHex,
        signature: sigHex,
        extKpub,
        guardian: undefined, // No guardian for basic Ed25519 flow
      });

      if (!SelfAppBuilderClass) {
        setErrorMessage("Self SDK still loading. Please try again.");
        return;
      }

      // Use derived address as userId
      const derivedAddr = deriveEd25519Address(ed25519PubkeyHex);
      setSelfApp(buildSelfApp(derivedAddr.toLowerCase(), userData));
      setEd25519Step("scan");
      setStep("scan");
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setErrorMessage(`Failed to build registration data: ${msg}`);
    } finally {
      setLoading(false);
    }
  };

  const handleConnect = async () => {
    setErrorMessage("");
    const address = await connectWallet(network);
    if (!address) return;

    setWalletAddress(address);

    if (mode === "self-custody") {
      const registered = await checkIfRegistered(address);
      if (registered) {
        setAlreadyRegistered(true);
        setStep("connect");
        return;
      }
    }

    if (!SelfAppBuilderClass) {
      setErrorMessage("Self SDK still loading. Please try again.");
      setStep("connect");
      return;
    }

    setAlreadyRegistered(false);

    const cfgIdx = getConfigIndex(disclosures);

    if (mode === "self-custody") {
      setSelfApp(buildSelfApp(address, "R" + cfgIdx));
      setStep("scan");
    } else {
      // Advanced mode: generate keypair, sign challenge
      const newWallet = ethers.Wallet.createRandom();
      setAgentWallet(newWallet);

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

    if (!SelfAppBuilderClass) {
      setErrorMessage("Self SDK still loading. Please try again.");
      return;
    }

    // Generate agent keypair (no wallet needed)
    const newWallet = ethers.Wallet.createRandom();
    setAgentWallet(newWallet);

    // Use checksummed address for userId to ensure ethers.solidityPacked
    // treats it as a proper address (ethers v6 normalizes, but be explicit)
    const agentAddress = ethers.getAddress(newWallet.address);

    // Sign challenge: the contract will derive humanAddress from output.userIdentifier,
    // which comes from the userId field. Both must use the same address.
    const sig = await signAgentChallenge(newWallet, agentAddress);

    // Build "W" + config(1) + agentAddr(40) + guardian(40) + r(64) + s(64) + v(2) = 212 chars
    const cfgIdx = getConfigIndex(disclosures);
    const agentAddrHex = newWallet.address.slice(2).toLowerCase();
    const guardianHex = "0".repeat(40); // no guardian (address(0))
    const rHex = sig.r.slice(2);
    const sHex = sig.s.slice(2);
    const vHex = sig.v.toString(16).padStart(2, "0");
    const userDefinedData =
      "W" + cfgIdx + agentAddrHex + guardianHex + rHex + sHex + vHex;

    // Pass lowercase address with 0x to buildSelfApp (SDK strips 0x for userId)
    setSelfApp(buildSelfApp(agentAddress.toLowerCase(), userDefinedData));
    setStep("scan");
  };

  const handleSmartWalletStart = async () => {
    setErrorMessage("");
    setLoading(true);

    if (!SelfAppBuilderClass) {
      setErrorMessage("Self SDK still loading. Please try again.");
      setLoading(false);
      return;
    }

    try {
      // 1. Create passkey → Kernel smart wallet (counterfactual)
      const passkeySuffix = crypto
        .getRandomValues(new Uint8Array(2))
        .reduce((s, b) => s + b.toString(16).padStart(2, "0"), "");
      const { credentialId, walletAddress: swAddress } =
        await createPasskeyWallet(`Self Agent ID (${passkeySuffix})`, network);
      setSmartWalletAddress(swAddress);

      // 2. Generate agent keypair
      const newWallet = ethers.Wallet.createRandom();
      setAgentWallet(newWallet);
      saveAgentPrivateKey({
        agentAddress: newWallet.address,
        privateKey: newWallet.privateKey,
        guardianAddress: swAddress,
      });

      // 3. Agent signs challenge (use checksummed address for solidityPacked consistency)
      const agentAddress = ethers.getAddress(newWallet.address);
      const sig = await signAgentChallenge(newWallet, agentAddress);

      // 4. Build userDefinedData: "W" + config(1) + agentAddr(40) + smartWalletAddr(40) + r(64) + s(64) + v(2)
      const cfgIdx = getConfigIndex(disclosures);
      const agentAddrHex = newWallet.address.slice(2).toLowerCase();
      const guardianHex = swAddress.slice(2).toLowerCase();
      const rHex = sig.r.slice(2);
      const sHex = sig.s.slice(2);
      const vHex = sig.v.toString(16).padStart(2, "0");
      const userDefinedData =
        "W" + cfgIdx + agentAddrHex + guardianHex + rHex + sHex + vHex;

      // 5. Save passkey for later sign-in
      savePasskey({
        credentialId,
        walletAddress: swAddress,
        createdAt: Date.now(),
      });

      setSelfApp(buildSelfApp(agentAddress.toLowerCase(), userDefinedData));
      setStep("scan");
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setErrorMessage(`Passkey creation failed: ${msg}`);
    } finally {
      setLoading(false);
    }
  };

  // When Privy authenticates and embedded wallet is ready, complete registration.
  // Handles both the in-session case (loading=true) and the post-redirect case
  // (mode restored from sessionStorage, loading=false, privyWalletAddress not yet set).
  useEffect(() => {
    if (mode !== "privy" || !privyAuthenticated) return;
    // Find embedded wallet
    const embedded = privyWallets.find(
      (w: { walletClientType: string }) => w.walletClientType === "privy",
    );
    if (!embedded) return;
    if (!loading && !pendingRedirect.current) return;

    // Already completed registration (wallet address captured) — don't re-run
    if (privyWalletAddress) return;

    pendingRedirect.current = false;
    if (!loading) setLoading(true);

    const completePrivyRegistration = async () => {
      try {
        const embeddedAddress = ethers.getAddress(embedded.address);
        setPrivyWalletAddress(embeddedAddress);

        // Generate fresh agent keypair
        const newWallet = ethers.Wallet.createRandom();
        setAgentWallet(newWallet);
        saveAgentPrivateKey({
          agentAddress: newWallet.address,
          privateKey: newWallet.privateKey,
        });

        // Agent signs challenge (Privy wallet as humanIdentifier)
        const sig = await signAgentChallenge(newWallet, embeddedAddress);

        // Build "K" format userDefinedData (same as advanced mode)
        const cfgIdx = getConfigIndex(disclosures);
        const agentAddrHex = newWallet.address.slice(2).toLowerCase();
        const rHex = sig.r.slice(2);
        const sHex = sig.s.slice(2);
        const vHex = sig.v.toString(16).padStart(2, "0");
        const userDefinedData =
          "K" + cfgIdx + agentAddrHex + rHex + sHex + vHex;

        setSelfApp(
          buildSelfApp(embeddedAddress.toLowerCase(), userDefinedData),
        );
        setStep("scan");
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        setErrorMessage(`Privy registration failed: ${msg}`);
      } finally {
        setLoading(false);
      }
    };

    void completePrivyRegistration();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    mode,
    privyAuthenticated,
    privyWallets.length,
    loading,
    privyWalletAddress,
  ]);

  const handlePrivyStart = () => {
    setErrorMessage("");

    if (!SelfAppBuilderClass) {
      setErrorMessage("Self SDK still loading. Please try again.");
      return;
    }

    if (!privyLogin) {
      setErrorMessage("Privy is not configured. Set NEXT_PUBLIC_PRIVY_APP_ID.");
      return;
    }

    setLoading(true);
    // Persist mode so it survives the OAuth redirect/reload
    sessionStorage.setItem("register-mode", "privy");
    // Open Privy login modal — the useEffect above handles the rest
    privyLogin();
  };

  const writeAgentCard = async () => {
    try {
      // Privy and wallet-free modes don't have window.ethereum — skip card writing
      if ((mode === "privy" || mode === "walletfree") && !window.ethereum) {
        setCardStep("skipped");
        return;
      }
      const agentAddress =
        mode === "self-custody" ? walletAddress! : agentWallet!.address;
      const agentKey = ethers.zeroPadValue(agentAddress, 32);

      const provider = new ethers.BrowserProvider(
        window.ethereum! as unknown as ethers.Eip1193Provider,
      );
      const registry = typedRegistry(network.registryAddress, provider);

      const agentId: bigint = await registry.getAgentId(agentKey);
      if (agentId === 0n) {
        setCardStep("skipped");
        return;
      }
      setAgentIdResult(agentId.toString());
      setCardStep("writing");

      const signer = await provider.getSigner();
      const result = await writeAgentCardShared(
        agentId,
        network.registryAddress,
        network,
        signer,
      );
      setCardJson(result.cardJson);
      setVerificationStrength(result.verificationStrength);
      setCardStep("done");
    } catch (err) {
      console.warn("[writeAgentCard] Skipped:", err);
      setCardStep("skipped");
    }
  };

  const handleSuccess = () => {
    // Guard against double-triggering (websocket + on-chain poll race)
    if (successTriggeredRef.current) return;
    successTriggeredRef.current = true;

    setStep("success");
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const handleError = (error: unknown) => {
    let msg: string;
    if (error instanceof Error) {
      msg = error.message;
    } else if (typeof error === "object" && error !== null) {
      msg = JSON.stringify(error);
    } else {
      msg = String(error);
    }
    console.error("[handleError] Self verification error:", error);
    console.error("[handleError] Current mode:", mode);
    console.error("[handleError] Agent wallet address:", agentWallet?.address);
    console.error("[handleError] Wallet address:", walletAddress);
    console.error("[handleError] Self app config:", selfApp);
    if (msg.includes("AlreadyRegistered") || msg.includes("already")) {
      setErrorMessage("This agent is already registered.");
    } else {
      setErrorMessage(`Verification failed: ${msg}`);
    }
  };

  const copyToClipboard = (text: string, field: string) => {
    void navigator.clipboard.writeText(text);
    setCopiedField(field);
    setTimeout(() => setCopiedField(null), 2000);
  };

  return (
    <div className="max-w-xl mx-auto">
      <h1 className="text-3xl font-bold text-center mb-8">Register Agent</h1>

      {/* Step 1: Choose mode */}
      {step === "mode" && (
        <div className="flex flex-col items-center gap-6 w-full">
          {/* Level 1: Path selection (onchain vs offchain) */}
          {agentPath === null && (
            <>
              <p className="text-muted text-center max-w-md">
                What kind of agent are you registering?
              </p>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 w-full">
                <button
                  onClick={() => setAgentPath("onchain")}
                  className="text-left p-5 rounded-xl border-2 border-border hover:border-accent transition-all"
                >
                  <div className="flex items-center gap-2 mb-2">
                    <span className="w-8 h-8 rounded-full bg-accent/20 flex items-center justify-center">
                      <Wallet size={16} className="text-accent" />
                    </span>
                    <span className="font-bold text-sm">My agent is onchain</span>
                  </div>
                  <p className="text-xs text-muted mt-2">
                    Your agent has an EVM wallet (MetaMask, passkey, social
                    login). Register with your existing wallet or generate a
                    dedicated agent key.
                  </p>
                </button>

                <button
                  onClick={() => { setAgentPath("offchain"); setMode("ed25519"); }}
                  className="text-left p-5 rounded-xl border-2 border-border hover:border-accent transition-all"
                >
                  <div className="flex items-center gap-2 mb-2">
                    <span className="w-8 h-8 rounded-full bg-accent/20 flex items-center justify-center">
                      <Terminal size={16} className="text-accent" />
                    </span>
                    <span className="font-bold text-sm">My agent is not onchain</span>
                  </div>
                  <p className="text-xs text-muted mt-2">
                    Your agent uses Ed25519 keys (OpenClaw, Eliza, etc.). Paste
                    your existing public key — no wallet needed.
                  </p>
                </button>
              </div>
            </>
          )}

          {/* Level 2a: Onchain sub-modes */}
          {agentPath === "onchain" && (
            <>
              <button
                onClick={() => { setAgentPath(null); setMode("linked"); }}
                className="flex items-center gap-1 text-sm text-muted hover:text-foreground transition-colors self-start"
              >
                <ChevronLeft size={16} />
                Back
              </button>

              <p className="text-muted text-center max-w-md">
                Choose how you want to register on-chain: wallet identity for direct
                human use, or a dedicated agent identity for autonomous software.
              </p>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 w-full">
                {/* Advanced mode card — recommended, shown first */}
                <button
                  onClick={() => setMode("linked")}
                  className={`text-left p-5 rounded-xl border-2 transition-all ${
                    mode === "linked"
                      ? "border-accent bg-surface-2"
                      : "border-border hover:border-border-strong"
                  }`}
                >
                  <div className="flex items-center gap-2 mb-2">
                    <span className="w-8 h-8 rounded-full bg-accent/20 flex items-center justify-center">
                      <Key size={16} className="text-accent" />
                    </span>
                    <span className="font-bold text-sm">Linked Agent</span>
                  </div>
                  <Badge variant="success">recommended</Badge>
                  <p className="text-xs text-muted mt-2">
                    Agent gets its own keypair, linked to your human wallet. Recommended for autonomous agents.
                  </p>
                </button>

                {/* Simple mode card */}
                <button
                  onClick={() => setMode("self-custody")}
                  className={`text-left p-5 rounded-xl border-2 transition-all ${
                    mode === "self-custody"
                      ? "border-accent bg-surface-2"
                      : "border-border hover:border-border-strong"
                  }`}
                >
                  <div className="flex items-center gap-2 mb-2">
                    <span className="w-8 h-8 rounded-full bg-accent/20 flex items-center justify-center">
                      <Wallet size={16} className="text-accent" />
                    </span>
                    <span className="font-bold text-sm">Self-Custody</span>
                  </div>
                  <p className="text-xs text-muted mt-2">
                    Your wallet address IS the agent. Best for humans who operate their own agent.
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
                    <span className="font-bold text-sm">Wallet-Free</span>
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
                      ? "Face ID or fingerprint. No MetaMask, no seed phrase. Gasless on Celo mainnet."
                      : "Passkeys not supported in this browser."}
                  </p>
                </button>

                {/* Privy (Social Login) mode card */}
                {isPrivyConfigured() && (
                  <button
                    onClick={() => setMode("privy")}
                    className={`text-left p-5 rounded-xl border-2 transition-all sm:col-span-2 ${
                      mode === "privy"
                        ? "border-purple-500 bg-surface-2"
                        : "border-border hover:border-border-strong"
                    }`}
                  >
                    <div className="flex items-center gap-2 mb-2">
                      <PrivyIcon size={20} />
                      <span className="font-bold text-sm">
                        Social Login (Privy)
                      </span>
                    </div>
                    <p className="text-xs text-muted mt-2">
                      Sign in with email, Google, or Twitter. No browser extension
                      needed. Privy creates an embedded wallet for you.
                    </p>
                  </button>
                )}
              </div>
            </>
          )}

          {/* Level 2b: Ed25519 (offchain) mode */}
          {agentPath === "offchain" && (
            <>
              <button
                onClick={() => { setAgentPath(null); setMode("linked"); }}
                className="flex items-center gap-1 text-sm text-muted hover:text-foreground transition-colors self-start"
              >
                <ChevronLeft size={16} />
                Back
              </button>

              <Card className="w-full">
                <div className="flex items-center gap-2 mb-3">
                  <Terminal size={16} className="text-accent" />
                  <p className="font-bold text-sm">Ed25519 Agent Registration</p>
                </div>

                {ed25519Step === "pubkey" && (
                  <>
                    <p className="text-sm text-muted mb-4">
                      Paste your agent&apos;s existing Ed25519 public key. No EVM wallet needed.
                    </p>
                    <label className="block text-sm font-medium text-foreground mb-1">
                      Your agent&apos;s Ed25519 public key
                    </label>
                    <input
                      type="text"
                      value={ed25519PubkeyInput}
                      onChange={(e) => setEd25519PubkeyInput(e.target.value)}
                      placeholder="Paste hex (64 chars) or base64 (44 chars)"
                      className="w-full bg-surface-2 border border-border rounded-lg px-3 py-2 text-sm font-mono placeholder:text-subtle focus:border-accent focus:outline-none"
                    />
                    <Button
                      onClick={() => void handleEd25519ValidateKey()}
                      variant="primary"
                      size="lg"
                      className="mt-4 w-full"
                      disabled={!ed25519PubkeyInput.trim()}
                    >
                      <Key size={18} />
                      Validate Key &amp; Get Challenge
                    </Button>
                  </>
                )}

                {ed25519Step === "challenge" && ed25519ChallengeHex && (
                  <>
                    <div className="flex items-center gap-2 mb-2">
                      <CheckCircle2 size={14} className="text-accent-success" />
                      <p className="text-sm text-accent-success">Key validated</p>
                    </div>
                    <p className="text-sm text-muted mb-3">
                      Sign this challenge hash with your agent&apos;s Ed25519 private key, then paste the signature below.
                    </p>
                    <label className="block text-sm font-medium text-foreground mb-1">
                      Challenge to sign (32 bytes)
                    </label>
                    <div className="flex items-center gap-2 mb-4">
                      <code className="flex-1 bg-surface-2 border border-border rounded-lg px-3 py-2 text-xs font-mono break-all">
                        {ed25519ChallengeHex}
                      </code>
                      <button
                        onClick={() => copyToClipboard(ed25519ChallengeHex, "challenge")}
                        className="p-2 rounded-lg hover:bg-surface-2 transition-colors"
                        title="Copy challenge"
                      >
                        {copiedField === "challenge" ? <Check size={16} className="text-accent-success" /> : <Copy size={16} className="text-muted" />}
                      </button>
                    </div>
                    <p className="text-xs text-muted mb-3">
                      Sign the raw 32 bytes (remove the 0x prefix) using your agent&apos;s Ed25519 private key.
                      The signature should be 64 bytes (128 hex chars) in standard Ed25519 format (R || S).
                    </p>
                    <label className="block text-sm font-medium text-foreground mb-1">
                      Ed25519 signature (128 hex chars)
                    </label>
                    <textarea
                      value={ed25519SignatureInput}
                      onChange={(e) => setEd25519SignatureInput(e.target.value)}
                      placeholder="Paste 128-char hex signature (r + s)"
                      rows={3}
                      className="w-full bg-surface-2 border border-border rounded-lg px-3 py-2 text-sm font-mono placeholder:text-subtle focus:border-accent focus:outline-none resize-none"
                    />
                    <Button
                      onClick={() => void handleEd25519SubmitSignature()}
                      variant="primary"
                      size="lg"
                      className="mt-4 w-full"
                      disabled={!ed25519SignatureInput.trim() || loading}
                    >
                      {loading ? (
                        <>
                          <Loader2 size={18} className="animate-spin" />
                          Computing...
                        </>
                      ) : (
                        <>
                          <Rocket size={18} />
                          Submit Signature &amp; Scan Passport
                        </>
                      )}
                    </Button>
                  </>
                )}

                {ed25519Step === "scan" && (
                  <div className="flex items-center gap-2">
                    <CheckCircle2 size={14} className="text-accent-success" />
                    <p className="text-sm text-accent-success">Signature verified — scan your passport below.</p>
                  </div>
                )}
              </Card>
            </>
          )}

          {/* Security explainer for selected mode (shown when a path is selected) */}
          {agentPath !== null && <Card className="w-full">
            <div className="flex items-center gap-2 mb-3">
              <Lock size={16} className="text-accent" />
              <p className="font-bold text-sm">
                {mode === "self-custody"
                  ? "How Self-Custody works"
                  : mode === "linked"
                    ? "How Linked Agent works"
                    : mode === "smartwallet"
                      ? "How Smart Wallet works"
                      : mode === "privy"
                        ? "How Social Login works"
                        : mode === "ed25519"
                          ? "How Ed25519 Registration works"
                          : "How Wallet-Free works"}
              </p>
            </div>
            {mode === "self-custody" ? (
              <ul className="text-sm text-muted space-y-1.5 list-disc list-inside">
                <li>
                  Connect your{" "}
                  <strong className="text-foreground">browser wallet</strong>{" "}
                  (MetaMask, etc.). That address becomes your on-chain identity.
                </li>
                <li>
                  Scan your passport with the{" "}
                  <strong className="text-foreground">Self app</strong>. A ZK
                  proof binds your wallet to a unique human nullifier.
                </li>
                <li>
                  Smart contracts can then check{" "}
                  <code className="bg-surface-2 font-mono text-accent-2 px-1 rounded text-xs">
                    isVerifiedAgent(your_address)
                  </code>{" "}
                  to gate access to verified humans.
                </li>
                <li>
                  Best for{" "}
                  <strong className="text-foreground">on-chain gating</strong>{" "}
                  where you transact directly (DAOs, token access). For
                  autonomous agents, choose Linked Agent.
                </li>
              </ul>
            ) : mode === "linked" ? (
              <ul className="text-sm text-muted space-y-1.5 list-disc list-inside">
                <li>
                  Connect your{" "}
                  <strong className="text-foreground">browser wallet</strong>{" "}
                  (MetaMask, etc.), used only during registration to prove your
                  identity.
                </li>
                <li>
                  A fresh{" "}
                  <strong className="text-foreground">agent keypair</strong> is
                  generated in your browser. Your browser signs a challenge with
                  that key to prove key ownership during registration.
                </li>
                <li>
                  Scan your passport with the{" "}
                  <strong className="text-foreground">Self app</strong> &mdash;
                  the contract verifies both the ZK proof and the registration
                  signature in one step.
                </li>
                <li>
                  Your agent operates with{" "}
                  <strong className="text-foreground">its own key</strong>. Your
                  wallet key is never exposed to agent software.
                </li>
              </ul>
            ) : mode === "smartwallet" ? (
              <ul className="text-sm text-muted space-y-1.5 list-disc list-inside">
                <li>
                  A <strong className="text-foreground">passkey</strong> (Face
                  ID / fingerprint) creates a Kernel smart account. No MetaMask,
                  no seed phrase.
                </li>
                <li>
                  A fresh{" "}
                  <strong className="text-foreground">agent keypair</strong> is
                  also generated. That key is used later by your agent software
                  to sign API requests.
                </li>
                <li>
                  The smart wallet becomes the{" "}
                  <strong className="text-foreground">guardian</strong>. You can
                  revoke your agent anytime with your biometrics, gaslessly.
                </li>
                <li>
                  Powered by{" "}
                  <strong className="text-foreground">
                    ZeroDev Kernel accounts
                  </strong>{" "}
                  with passkey auth and{" "}
                  <strong className="text-foreground">Pimlico</strong> sponsored
                  ops on Celo mainnet. The smart wallet deploys on first use
                  (counterfactual) &mdash; see{" "}
                  <a
                    href="https://docs.zerodev.app/sdk/advanced/counterfactual-address"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-accent hover:text-accent-2 underline"
                  >
                    counterfactual address docs
                  </a>
                  .
                </li>
              </ul>
            ) : mode === "privy" ? (
              <ul className="text-sm text-muted space-y-1.5 list-disc list-inside">
                <li>
                  Sign in with{" "}
                  <strong className="text-foreground">
                    email, Google, or Twitter
                  </strong>{" "}
                  via Privy. No browser extension or seed phrase needed.
                </li>
                <li>
                  Privy creates an{" "}
                  <strong className="text-foreground">embedded wallet</strong>{" "}
                  for you automatically. This wallet address becomes the NFT
                  owner (human identifier).
                </li>
                <li>
                  A fresh{" "}
                  <strong className="text-foreground">agent keypair</strong> is
                  generated in your browser. The agent signs a challenge proving
                  key ownership, same as Linked Agent mode.
                </li>
                <li>
                  Scan your passport with the{" "}
                  <strong className="text-foreground">Self app</strong> &mdash;
                  the contract verifies both the ZK proof and the agent
                  signature in one step.
                </li>
                <li>
                  Your agent operates with{" "}
                  <strong className="text-foreground">its own key</strong>. The
                  Privy wallet is only used during registration. No Privy
                  dependency at runtime.
                </li>
              </ul>
            ) : mode === "ed25519" ? (
              <ul className="text-sm text-muted space-y-1.5 list-disc list-inside">
                <li>
                  Your agent already has an{" "}
                  <strong className="text-foreground">Ed25519 keypair</strong>.
                  Paste the 32-byte public key.
                </li>
                <li>
                  Sign a registration challenge with your agent&apos;s private key
                  (instructions provided).
                </li>
                <li>
                  Scan your passport with the{" "}
                  <strong className="text-foreground">Self app</strong>. The
                  contract verifies both the ZK proof and your Ed25519 signature
                  on-chain.
                </li>
                <li>
                  Your agent&apos;s public key becomes the on-chain identity.{" "}
                  <strong className="text-foreground">No EVM wallet needed.</strong>
                </li>
              </ul>
            ) : (
              <>
                <ul className="text-sm text-muted space-y-1.5 list-disc list-inside">
                  <li>
                    <strong className="text-foreground">
                      No crypto wallet required.
                    </strong>{" "}
                    You only need the Self app on your phone and a valid
                    passport.
                  </li>
                  <li>
                    A fresh{" "}
                    <strong className="text-foreground">agent keypair</strong>{" "}
                    is generated in your browser. The agent owns its own
                    on-chain identity NFT.
                  </li>
                  <li>
                    Scan your passport with the{" "}
                    <strong className="text-foreground">Self app</strong>. The
                    contract verifies your identity and mints the NFT to the
                    agent&apos;s address.
                  </li>
                  <li>
                    You can{" "}
                    <strong className="text-foreground">
                      deregister anytime
                    </strong>{" "}
                    by scanning your passport again. The ZK proof links back to
                    your unique human identity.
                  </li>
                </ul>

                {/* Expandable key management info */}
                <button
                  onClick={() => setShowKeyInfo(!showKeyInfo)}
                  className="flex items-center gap-2 mt-4 pt-3 border-t border-border text-sm font-medium text-accent hover:text-accent-2 transition-colors w-full"
                >
                  {showKeyInfo ? (
                    <ChevronUp size={14} />
                  ) : (
                    <ChevronDown size={14} />
                  )}
                  How do I manage my agent&apos;s key?
                </button>

                {showKeyInfo && (
                  <div className="mt-3 space-y-3 text-sm text-muted">
                    <p>
                      When you register, a{" "}
                      <strong className="text-foreground">private key</strong>{" "}
                      is generated in your browser. This key controls your
                      agent&apos;s on-chain identity. You must save it securely.
                    </p>
                    <div className="bg-surface-2 rounded-lg p-3 space-y-2">
                      <p className="font-bold text-foreground text-xs">
                        Key management tips:
                      </p>
                      <ul className="text-xs space-y-1 list-disc list-inside">
                        <li>
                          Copy the private key and store it in a password
                          manager (1Password, Bitwarden, etc.)
                        </li>
                        <li>Never share the private key with anyone</li>
                        <li>
                          Your agent software uses this key to sign requests and
                          prove its identity
                        </li>
                        <li>
                          If the key is lost, you can deregister by scanning
                          your passport and create a new agent
                        </li>
                      </ul>
                    </div>

                    <div className="bg-accent-success/5 border border-accent-success/20 rounded-lg p-3">
                      <div className="flex items-center gap-2 mb-1">
                        <Fingerprint
                          size={14}
                          className="text-accent-success"
                        />
                        <p className="font-bold text-foreground text-xs">
                          Prefer passkeys?
                        </p>
                      </div>
                      <p className="text-xs text-muted">
                        Try{" "}
                        <strong className="text-foreground">
                          Smart Wallet
                        </strong>{" "}
                        mode instead. Uses Face ID or fingerprint to create a
                        smart account as guardian. No raw keys to manage.
                      </p>
                    </div>
                  </div>
                )}
              </>
            )}
          </Card>}

          {/* Disclosure toggles */}
          {agentPath !== null && <Card className="w-full">
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
                  Choose what your agent can carry as verified claims. Your raw
                  passport data is{" "}
                  <strong className="text-foreground">
                    never stored or shared
                  </strong>
                  . The Self app generates a{" "}
                  <strong className="text-foreground">
                    zero-knowledge proof
                  </strong>{" "}
                  on your phone, and only the attested result (e.g.
                  &ldquo;nationality: GBR&rdquo; or &ldquo;over 18&rdquo;) is
                  stored on-chain. No personal documents ever leave your device.
                </p>
                <p className="text-xs text-muted mb-4">
                  All disclosures are optional. Unselected fields are not
                  included.
                </p>

                <div className="grid grid-cols-2 gap-2 mb-4">
                  {(
                    [
                      ["nationality", "Nationality", false],
                      ["name", "Full Name", false],
                      ["date_of_birth", "Date of Birth", false],
                      ["gender", "Gender", false],
                      ["issuing_state", "Issuing State", false],
                      ["ofac", "Not on OFAC List", false],
                    ] as const
                  ).map(([key, label, disabled]) => (
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
                        checked={disclosures[key]}
                        disabled={disabled}
                        onChange={(e) =>
                          setDisclosures((d) => ({
                            ...d,
                            [key]: e.target.checked,
                          }))
                        }
                        className="rounded border-border text-accent focus:ring-accent"
                      />
                      {label}
                      {disabled && (
                        <span className="text-xs text-subtle ml-auto">
                          coming soon
                        </span>
                      )}
                    </label>
                  ))}
                </div>

                <div className="flex items-center gap-3">
                  <label className="text-sm text-muted">Age Verification</label>
                  <select
                    value={disclosures.minimumAge}
                    onChange={(e) =>
                      setDisclosures((d) => ({
                        ...d,
                        minimumAge: Number(e.target.value),
                      }))
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
          </Card>}

          {agentPath === "onchain" && (mode === "walletfree" ? (
            <Button
              onClick={() => void handleWalletFreeStart()}
              variant="primary"
              size="lg"
            >
              <Smartphone size={18} />
              Generate Agent &amp; Scan Passport
            </Button>
          ) : mode === "smartwallet" ? (
            <Button
              onClick={() => void handleSmartWalletStart()}
              variant="primary"
              size="lg"
              disabled={loading}
            >
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
          ) : mode === "privy" ? (
            <Button
              onClick={() => handlePrivyStart()}
              variant="primary"
              size="lg"
              disabled={loading || !privyReady}
            >
              {loading ? (
                <>
                  <Loader2 size={18} className="animate-spin" />
                  Signing in...
                </>
              ) : (
                <>
                  <PrivyIcon size={18} />
                  Sign In &amp; Generate Agent
                </>
              )}
            </Button>
          ) : (
            <div className="w-full flex flex-col items-center gap-2">
              <p className="text-xs text-muted text-center max-w-md">
                {mode === "self-custody"
                  ? "Next step: connect your wallet. That same address will be your verified on-chain identity."
                  : "Next step: connect your wallet to prove the human. A separate agent keypair is generated in-browser for your agent."}
              </p>
              <Button
                onClick={() => setStep("connect")}
                variant="primary"
                size="lg"
              >
                {mode === "self-custody"
                  ? "Continue: Connect Self-Custody Wallet"
                  : "Continue: Connect Wallet for Linked Agent"}
              </Button>
            </div>
          ))}

          {/* CLI / Agent-guided registration */}
          <Card className="w-full border border-accent/30 bg-accent/5">
            <div className="flex items-start gap-3">
              <Terminal size={18} className="text-accent mt-0.5 shrink-0" />
              <p className="text-sm text-muted">
                Prefer terminal workflows? Use the{" "}
                <Link
                  href="/cli"
                  className="text-accent hover:text-accent-2 underline underline-offset-2 font-medium"
                >
                  CLI
                </Link>{" "}
                to register from your terminal, or let your backend orchestrate
                registration via the{" "}
                <strong className="text-foreground">agent-guided flow</strong>{" "}
                (recommended for automated onboarding).
              </p>
            </div>
          </Card>

          {/* MCP / Plugin registration */}
          <Card className="w-full border border-purple-500/30 bg-purple-500/5">
            <div className="flex items-start gap-3">
              <Bot size={18} className="text-purple-400 mt-0.5 shrink-0" />
              <p className="text-sm text-muted">
                Using an AI coding assistant? The{" "}
                <Link
                  href="/integration#mcp"
                  className="text-accent hover:text-accent-2 underline underline-offset-2 font-medium"
                >
                  MCP server &amp; plugin
                </Link>{" "}
                can register and manage agents directly from your editor.
              </p>
            </div>
          </Card>

          {errorMessage && (
            <p className="text-sm text-accent-error text-center">
              {errorMessage}
            </p>
          )}
        </div>
      )}

      {/* Step 2: Connect wallet (not shown for wallet-free mode) */}
      {step === "connect" && (
        <div className="flex flex-col items-center gap-4 w-full">
          {!walletAddress ? (
            <>
              <p className="text-muted text-center max-w-md">
                {mode === "self-custody"
                  ? "Connect your browser wallet (MetaMask, etc.). Your wallet address will become your agent\u2019s on-chain identity."
                  : "Connect your browser wallet (MetaMask, etc.). A new agent keypair will be generated and linked to your wallet."}
              </p>
              <Button
                onClick={() => void handleConnect()}
                variant="primary"
                size="lg"
              >
                <Wallet size={18} />
                Connect Wallet
              </Button>
            </>
          ) : alreadyRegistered ? (
            <>
              <Card variant="warn" className="w-full text-center">
                <div className="flex items-center justify-center gap-2 mb-2">
                  <AlertTriangle size={18} className="text-accent-warn" />
                  <p className="font-bold text-accent-warn">
                    Already Registered
                  </p>
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
                  router.push(
                    "/agents/verify?key=" + encodeURIComponent(agentKey),
                  );
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
              <Button onClick={() => void handleConnect()} variant="primary">
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
            {mode === "self-custody" ? (
              <>
                <p className="text-xs text-muted mb-1">
                  Registering wallet as agent
                </p>
                <p className="font-mono text-sm">{walletAddress}</p>
              </>
            ) : mode === "linked" ? (
              <>
                <p className="text-xs text-muted mb-1">
                  Registering agent{" "}
                  <span className="font-mono text-foreground">
                    {agentWallet?.address.slice(0, 6)}...
                    {agentWallet?.address.slice(-4)}
                  </span>{" "}
                  under wallet
                </p>
                <p className="font-mono text-sm">{walletAddress}</p>
              </>
            ) : mode === "privy" ? (
              <>
                <div className="flex items-center justify-center gap-2 mb-1">
                  <PrivyIcon size={14} />
                  <p className="text-xs text-muted">
                    Social Login (Privy) registration
                  </p>
                </div>
                <p className="text-xs text-muted mb-1">Agent address</p>
                <p className="font-mono text-sm">{agentWallet?.address}</p>
                <p className="text-xs text-muted mt-2">
                  Owner (Privy wallet):{" "}
                  <span className="font-mono text-foreground">
                    {privyWalletAddress?.slice(0, 6)}...
                    {privyWalletAddress?.slice(-4)}
                  </span>
                </p>
              </>
            ) : mode === "smartwallet" ? (
              <>
                <div className="flex items-center justify-center gap-2 mb-1">
                  <Fingerprint size={14} className="text-accent-success" />
                  <p className="text-xs text-muted">
                    Smart Wallet registration
                  </p>
                </div>
                <p className="text-xs text-muted mb-1">Agent address</p>
                <p className="font-mono text-sm">{agentWallet?.address}</p>
                <p className="text-xs text-muted mt-2">
                  Guardian (smart wallet):{" "}
                  <span className="font-mono text-foreground">
                    {smartWalletAddress?.slice(0, 6)}...
                    {smartWalletAddress?.slice(-4)}
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
              <img
                src="/self-icon.png"
                alt="Self"
                width={28}
                height={28}
                className="rounded"
              />
              <p className="font-bold text-sm">Scan with the Self App</p>
            </div>
            <p className="text-sm text-muted mb-3">
              Self uses{" "}
              <strong className="text-foreground">
                zero-knowledge cryptography
              </strong>{" "}
              to prove you&apos;re a real person without storing or sharing your
              personal data. Your passport is scanned locally on your phone.
              Only a mathematical proof is sent, never your documents.
            </p>
            <div className="flex gap-2">
              <a
                href="https://apps.apple.com/us/app/self-zk-passport-identity/id6478563710"
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1.5 px-3 py-1.5 bg-surface-2 border border-border rounded-lg text-xs font-medium hover:border-border-strong transition-colors"
              >
                {/* Apple icon */}
                <svg
                  viewBox="0 0 384 512"
                  width="14"
                  height="14"
                  fill="currentColor"
                >
                  <path d="M318.7 268.7c-.2-36.7 16.4-64.4 50-84.8-18.8-26.9-47.2-41.7-84.7-44.6-35.5-2.8-74.3 20.7-88.5 20.7-15 0-49.4-19.7-76.4-19.7C63.3 141.2 4 184.8 4 273.5c0 26.2 4.8 53.3 14.4 81.2 12.8 36.7 59 126.7 107.2 125.2 25.2-.6 43-17.9 75.8-17.9 31.8 0 48.3 17.9 76.4 17.9 48.6-.7 90.4-82.5 102.6-119.3-65.2-30.7-61.7-90-61.7-91.9zm-56.6-164.2c27.3-32.4 24.8-61.9 24-72.5-24.1 1.4-52 16.4-67.9 34.9-17.5 19.8-27.8 44.3-25.6 71.9 26.1 2 49.9-11.4 69.5-34.3z" />
                </svg>
                App Store
              </a>
              <a
                href="https://play.google.com/store/apps/details?id=com.proofofpassportapp"
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1.5 px-3 py-1.5 bg-surface-2 border border-border rounded-lg text-xs font-medium hover:border-border-strong transition-colors"
              >
                {/* Play Store icon */}
                <svg
                  viewBox="0 0 512 512"
                  width="14"
                  height="14"
                  fill="currentColor"
                >
                  <path d="M325.3 234.3L104.6 13l280.8 161.2-60.1 60.1zM47 0C34 6.8 25.3 19.2 25.3 35.3v441.3c0 16.1 8.7 28.5 21.7 35.3l256.6-256L47 0zm425.2 225.6l-58.9-34.1-65.7 64.5 65.7 64.5 60.1-34.1c18-14.3 18-46.5-1.2-60.8zM104.6 499l280.8-161.2-60.1-60.1L104.6 499z" />
                </svg>
                Google Play
              </a>
            </div>
          </Card>
          {mode === "smartwallet" &&
            smartWalletAddress &&
            network.isTestnet && (
              <div className="bg-accent/5 border border-accent/20 rounded-lg px-4 py-3 text-xs text-muted w-full max-w-md">
                <strong className="text-foreground">Testnet:</strong> On{" "}
                {network.label}, the smart wallet is computed but not deployed.
                Gasless passkey operations are available on Celo Mainnet
                (Pimlico + ZeroDev).
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
              if (
                mode === "walletfree" ||
                mode === "smartwallet" ||
                mode === "privy"
              ) {
                setStep("mode");
                setAgentWallet(null);
                setSmartWalletAddress(null);
                setPrivyWalletAddress(null);
              } else {
                setStep("connect");
              }
              setSelfApp(null);
              setErrorMessage("");
              successTriggeredRef.current = false;
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

          {/* Agent Card progress */}
          <Card className="w-full">
            <div className="flex items-center gap-3 text-sm">
              <CheckCircle2
                size={16}
                className="text-accent-success shrink-0"
              />
              <span>Step 1/2: Agent Registered</span>
            </div>
            <div className="flex items-center gap-3 text-sm mt-2">
              {cardStep === "writing" ? (
                <Loader2
                  size={16}
                  className="text-accent animate-spin shrink-0"
                />
              ) : cardStep === "done" ? (
                <CheckCircle2
                  size={16}
                  className="text-accent-success shrink-0"
                />
              ) : cardStep === "skipped" ? (
                <XCircle size={16} className="text-muted shrink-0" />
              ) : (
                <Bot size={16} className="text-muted shrink-0" />
              )}
              <span>
                {cardStep === "writing"
                  ? "Step 2/2: Setting Agent Card (confirm in wallet)..."
                  : cardStep === "done"
                    ? "Step 2/2: Agent Card Set"
                    : cardStep === "skipped"
                      ? "Step 2/2: Agent Card skipped — set it later via updateAgentMetadata()"
                      : "Step 2/2: Set Agent Card"}
              </span>
            </div>
            {cardStep === "pending" && (
              <Button
                className="mt-3 w-full"
                onClick={() => void writeAgentCard()}
              >
                Set Agent Card (on-chain)
              </Button>
            )}
          </Card>

          {/* Verification Strength Badge */}
          {verificationStrength !== null && (
            <div className="flex items-center gap-2">
              <div
                className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold text-white ${
                  verificationStrength >= 80
                    ? "bg-green-500"
                    : verificationStrength >= 60
                      ? "bg-blue-500"
                      : verificationStrength >= 40
                        ? "bg-amber-500"
                        : "bg-gray-500"
                }`}
              >
                {verificationStrength}
              </div>
              <span className="text-sm">
                Verification Strength:{" "}
                <strong>
                  {verificationStrength >= 100
                    ? "Passport"
                    : verificationStrength >= 80
                      ? "KYC"
                      : verificationStrength >= 60
                        ? "Govt ID"
                        : "Liveness"}
                </strong>
              </span>
            </div>
          )}

          {/* API Links */}
          {agentIdResult && cardStep === "done" && (
            <Card className="w-full">
              <p className="font-bold text-sm mb-2">API Endpoints</p>
              <div className="space-y-2 text-xs">
                <div>
                  <p className="text-muted mb-1">Agent Card Resolver</p>
                  <div className="flex items-center gap-2">
                    <code className="font-mono break-all bg-surface-2 border border-border rounded px-2 py-1 flex-1">
                      /api/cards/{network.chainId}/{agentIdResult}
                    </code>
                    <button
                      onClick={() =>
                        copyToClipboard(
                          `${window.location.origin}/api/cards/${network.chainId}/${agentIdResult}`,
                          "cardUrl",
                        )
                      }
                      className="p-2 text-muted hover:text-foreground bg-surface-2 hover:bg-surface-1 rounded border border-border transition-colors shrink-0"
                    >
                      {copiedField === "cardUrl" ? (
                        <Check size={14} className="text-accent-success" />
                      ) : (
                        <Copy size={14} />
                      )}
                    </button>
                  </div>
                </div>
                <div>
                  <p className="text-muted mb-1">Reputation Score</p>
                  <div className="flex items-center gap-2">
                    <code className="font-mono break-all bg-surface-2 border border-border rounded px-2 py-1 flex-1">
                      /api/reputation/{network.chainId}/{agentIdResult}
                    </code>
                    <button
                      onClick={() =>
                        copyToClipboard(
                          `${window.location.origin}/api/reputation/${network.chainId}/${agentIdResult}`,
                          "repUrl",
                        )
                      }
                      className="p-2 text-muted hover:text-foreground bg-surface-2 hover:bg-surface-1 rounded border border-border transition-colors shrink-0"
                    >
                      {copiedField === "repUrl" ? (
                        <Check size={14} className="text-accent-success" />
                      ) : (
                        <Copy size={14} />
                      )}
                    </button>
                  </div>
                </div>
              </div>
              {/* Collapsible JSON preview */}
              <button
                onClick={() => setShowCardJson(!showCardJson)}
                className="text-xs text-accent hover:text-accent-2 mt-3 flex items-center gap-1"
              >
                {showCardJson ? (
                  <ChevronUp size={14} />
                ) : (
                  <ChevronDown size={14} />
                )}
                {showCardJson ? "Hide" : "Show"} Agent Card JSON
              </button>
              {showCardJson && cardJson && (
                <pre className="mt-2 text-xs bg-surface-2 border border-border rounded p-3 overflow-auto max-h-48">
                  {cardJson}
                </pre>
              )}
            </Card>
          )}

          {mode === "self-custody" ? (
            <>
              <Card className="w-full">
                <p className="font-bold text-sm mb-3">Self-Custody</p>
                <div className="space-y-3 text-sm">
                  <div>
                    <p className="text-xs text-muted mb-1">
                      Your Wallet Address
                    </p>
                    <p className="font-mono break-all bg-surface-2 border border-border rounded px-2 py-1">
                      {walletAddress}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-muted mb-1">
                      On-chain Agent Key (bytes32)
                    </p>
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
                    Your wallet address is now registered as a{" "}
                    <strong className="text-foreground">verified human</strong>{" "}
                    on-chain.
                  </li>
                  <li>
                    Smart contracts can check{" "}
                    <code className="bg-surface-2 font-mono text-accent-2 px-1 rounded">
                      isVerifiedAgent(bytes32(your_address))
                    </code>{" "}
                    to gate access to verified humans only.
                  </li>
                  <li>
                    <strong className="text-foreground">
                      You transact directly.
                    </strong>{" "}
                    There is no separate agent. This is best for on-chain gating
                    (DAOs, token access, DeFi).
                  </li>
                  <li>
                    For autonomous agents that sign requests to services, use{" "}
                    <strong className="text-foreground">Linked Agent</strong>{" "}
                    mode instead.
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
                  <p className="font-bold text-sm text-accent-warn">
                    Agent Credentials
                  </p>
                </div>
                <p className="text-sm text-muted mb-3">
                  A fresh Ethereum keypair was generated in your browser for
                  your agent. Copy these credentials now &mdash; this is the
                  only place we display the private key.
                  {mode === "smartwallet"
                    ? " For demo convenience, this browser keeps a local copy linked to your passkey wallet."
                    : " If you leave without saving it, it cannot be recovered."}
                </p>

                <div className="space-y-3">
                  <div>
                    <p className="text-xs font-medium text-accent-warn mb-1">
                      Agent Address
                      <span className="font-normal text-muted">
                        {" "}
                        (your agent&apos;s public identity)
                      </span>
                    </p>
                    <div className="flex items-center gap-2">
                      <p className="font-mono break-all bg-surface-2 border border-border rounded px-2 py-1 text-sm flex-1">
                        {agentWallet?.address}
                      </p>
                      <button
                        onClick={() =>
                          copyToClipboard(agentWallet?.address || "", "address")
                        }
                        className="p-2 text-muted hover:text-foreground bg-surface-2 hover:bg-surface-1 rounded border border-border transition-colors shrink-0"
                        title="Copy"
                      >
                        {copiedField === "address" ? (
                          <Check size={14} className="text-accent-success" />
                        ) : (
                          <Copy size={14} />
                        )}
                      </button>
                    </div>
                  </div>

                  <div>
                    <p className="text-xs font-medium text-accent-warn mb-1">
                      Agent Private Key
                      <span className="font-normal text-muted">
                        {" "}
                        (used by your agent to sign requests)
                      </span>
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
                        {showPrivateKey ? (
                          <EyeOff size={14} />
                        ) : (
                          <Eye size={14} />
                        )}
                      </button>
                      <button
                        onClick={() =>
                          copyToClipboard(
                            agentWallet?.privateKey || "",
                            "privateKey",
                          )
                        }
                        className="p-2 text-muted hover:text-foreground bg-surface-2 hover:bg-surface-1 rounded border border-border transition-colors shrink-0"
                        title="Copy"
                      >
                        {copiedField === "privateKey" ? (
                          <Check size={14} className="text-accent-success" />
                        ) : (
                          <Copy size={14} />
                        )}
                      </button>
                    </div>
                  </div>
                </div>
              </Card>

              {/* How to use your agent */}
              <div className="w-full space-y-3">
                <p className="font-bold text-sm">How to use your agent</p>
                <p className="text-xs text-muted">
                  Set{" "}
                  <code className="bg-surface-2 font-mono text-accent-2 px-1 rounded">
                    AGENT_PRIVATE_KEY
                  </code>{" "}
                  in your agent&apos;s environment, then use one of these
                  patterns. If the key is{" "}
                  <strong className="text-foreground">lost</strong>, deregister
                  and create a new agent. If{" "}
                  <strong className="text-foreground">leaked</strong>,
                  deregister immediately.
                </p>

                <div className="flex gap-2 flex-wrap">
                  {agentSnippets.map((snippet, i) => (
                    <button
                      key={snippet.title}
                      onClick={() => setActiveAgentSnippet(i)}
                      className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors border ${
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

                <p className="text-xs text-muted">
                  {agentSnippets[activeAgentSnippet].description}
                </p>
                <CodeBlock tabs={agentSnippets[activeAgentSnippet].snippets} />
              </div>

              {/* Registration details */}
              <Card className="w-full">
                <p className="font-bold text-sm mb-3">Registration Details</p>
                <div className="space-y-3 text-sm">
                  {mode === "walletfree" ||
                  mode === "smartwallet" ||
                  mode === "privy" ? (
                    <>
                      <div>
                        <p className="text-xs text-muted mb-1">
                          Registration Mode
                        </p>
                        <div className="flex items-center gap-2">
                          {mode === "smartwallet" ? (
                            <>
                              <Badge variant="success">Smart Wallet</Badge>
                              <span className="text-xs text-muted">
                                Passkey guardian, gasless management
                              </span>
                            </>
                          ) : mode === "privy" ? (
                            <>
                              <Badge variant="info">Social Login (Privy)</Badge>
                              <span className="text-xs text-muted">
                                Embedded wallet as owner
                              </span>
                            </>
                          ) : (
                            <>
                              <Badge variant="info">Wallet-Free</Badge>
                              <span className="text-xs text-muted">
                                Agent owns its own NFT
                              </span>
                            </>
                          )}
                        </div>
                      </div>
                      {mode === "privy" && privyWalletAddress ? (
                        <div>
                          <p className="text-xs text-muted mb-1">
                            NFT Owner (Privy Wallet)
                            <span className="text-subtle">
                              {" "}
                              (your social login wallet)
                            </span>
                          </p>
                          <p className="font-mono break-all bg-surface-2 border border-border rounded px-2 py-1">
                            {privyWalletAddress}
                          </p>
                        </div>
                      ) : (
                        <div>
                          <p className="text-xs text-muted mb-1">
                            NFT Owner
                            <span className="text-subtle">
                              {" "}
                              (the agent&apos;s address, self-owned)
                            </span>
                          </p>
                          <p className="font-mono break-all bg-surface-2 border border-border rounded px-2 py-1">
                            {agentWallet?.address}
                          </p>
                        </div>
                      )}
                      {mode === "smartwallet" && smartWalletAddress && (
                        <div>
                          <p className="text-xs text-muted mb-1">
                            Guardian (Smart Wallet)
                            <span className="text-subtle">
                              {" "}
                              (your passkey controls this address)
                            </span>
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
                        <span className="text-subtle">
                          {" "}
                          (your wallet, the NFT owner who can deregister)
                        </span>
                      </p>
                      <p className="font-mono break-all bg-surface-2 border border-border rounded px-2 py-1">
                        {walletAddress}
                      </p>
                    </div>
                  )}
                  <div>
                    <p className="text-xs text-muted mb-1">
                      Agent Key (bytes32)
                      <span className="text-subtle">
                        {" "}
                        (the on-chain identifier services use to verify)
                      </span>
                    </p>
                    <p className="font-mono break-all bg-surface-2 border border-border rounded px-2 py-1 text-xs">
                      {agentWallet &&
                        ethers.zeroPadValue(agentWallet.address, 32)}
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
                    Your passkey can revoke this agent anytime via Face ID /
                    fingerprint. Visit{" "}
                    <strong className="text-foreground">My Agents</strong> and
                    sign in with your passkey to manage your agent gaslessly.
                    The smart wallet deploys on first management action.
                  </p>
                </Card>
              )}

              {mode === "walletfree" && (
                <Card className="w-full">
                  <p className="font-bold text-sm mb-2">How to deregister</p>
                  <p className="text-xs text-muted">
                    Since no wallet was used, you can deregister by visiting the{" "}
                    <strong className="text-foreground">Verify</strong> page,
                    looking up your agent, and scanning your passport again. The
                    ZK proof links to your unique identity, so only you can
                    deregister your agent.
                  </p>
                </Card>
              )}

              {mode === "privy" && (
                <Card className="w-full">
                  <div className="flex items-center gap-2 mb-2">
                    <PrivyIcon size={16} />
                    <p className="font-bold text-sm">Privy Wallet Info</p>
                  </div>
                  <p className="text-xs text-muted">
                    Your Privy embedded wallet owns the agent NFT. To
                    deregister, use the Linked Agent deregister flow with the
                    same wallet. Your agent operates independently with its own
                    private key &mdash; no Privy dependency at runtime.
                  </p>
                </Card>
              )}
            </>
          )}

          <div className="flex gap-3">
            <Button
              onClick={() => {
                const key =
                  mode === "self-custody"
                    ? ethers.zeroPadValue(walletAddress!, 32)
                    : ethers.zeroPadValue(agentWallet!.address, 32);
                router.push("/agents/verify?key=" + encodeURIComponent(key));
              }}
              variant="primary"
              size="lg"
            >
              Verify Agent
            </Button>
            <Button
              onClick={() => {
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
    </div>
  );
}
