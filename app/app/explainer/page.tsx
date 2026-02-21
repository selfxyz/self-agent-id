"use client";

import { useState, useMemo } from "react";
import Link from "next/link";
import MatrixText from "@/components/MatrixText";
import { ethers } from "ethers";
import {
  Users,
  Lock,
  FileCode2,
  CheckCircle2,
  ArrowRight,
  Shield,
  Eye,
  Layers,
  Fingerprint,
  Wallet,
  Key,
  Search,
  ExternalLink,
  Code2,
  Cpu,
} from "lucide-react";
import CodeBlock from "@/components/CodeBlock";
import { getServiceSnippets, getAgentSnippets, SERVICE_FEATURES, AGENT_FEATURES } from "@/lib/snippets";
import { REGISTRY_ABI } from "@/lib/constants";
import { useNetwork } from "@/lib/NetworkContext";
import { Card } from "@/components/Card";
import { Badge } from "@/components/Badge";
import { Button } from "@/components/Button";


type VerifyStatus = "idle" | "loading" | "verified" | "not-registered" | "error";

export default function ExplainerPage() {
  const { network } = useNetwork();
  const [pubKeyInput, setPubKeyInput] = useState("");
  const [verifyStatus, setVerifyStatus] = useState<VerifyStatus>("idle");
  const [verifyError, setVerifyError] = useState("");
  const [activeUseCase, setActiveUseCase] = useState(0);
  const [activeAgentSnippet, setActiveAgentSnippet] = useState(0);
  const [activeServiceFeatures, setActiveServiceFeatures] = useState<Set<string>>(new Set());
  const [activeAgentFeatures, setActiveAgentFeatures] = useState<Set<string>>(new Set());

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

  const snippets = useMemo(
    () => getServiceSnippets(network.registryAddress, network.rpcUrl, activeServiceFeatures),
    [network.registryAddress, network.rpcUrl, activeServiceFeatures]
  );
  const agentSnippets = useMemo(
    () => getAgentSnippets(network.registryAddress, network.rpcUrl, activeAgentFeatures),
    [network.registryAddress, network.rpcUrl, activeAgentFeatures]
  );

  const handleVerify = async () => {
    const trimmed = pubKeyInput.trim();
    if (!trimmed) return;

    setVerifyStatus("loading");
    setVerifyError("");

    try {
      const provider = new ethers.JsonRpcProvider(network.rpcUrl);
      const registry = new ethers.Contract(network.registryAddress, REGISTRY_ABI, provider);

      let key = trimmed;
      if (!key.startsWith("0x")) {
        key = "0x" + key;
      }

      let keyHash: string;
      if (key.length === 66) {
        keyHash = key;
      } else if (key.length === 42) {
        keyHash = ethers.zeroPadValue(key, 32);
      } else {
        setVerifyStatus("error");
        setVerifyError("Enter an address (0x + 40 hex) or bytes32 key (0x + 64 hex).");
        return;
      }

      const isVerified: boolean = await registry.isVerifiedAgent(keyHash);
      setVerifyStatus(isVerified ? "verified" : "not-registered");
    } catch (err: unknown) {
      setVerifyStatus("error");
      setVerifyError(err instanceof Error ? err.message : "Failed to query contract");
    }
  };

  return (
    <main className="min-h-screen">
      {/* ───────────────────────── 1. Hero ───────────────────────── */}
      <section className="relative overflow-hidden hero-glow bg-grid">
        <div className="relative z-10 flex flex-col items-center justify-center text-center px-6 pt-32 pb-20 md:pb-28">
          <Badge variant="info" className="mb-4">
            Proposed Extension to ERC-8004
          </Badge>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/self-icon.png" alt="Self" width={64} height={64} className="rounded-xl mb-4" />
          <div className="flex justify-center mb-6">
            <MatrixText text="Proof-of-Human for AI Agents" fontSize={52} />
          </div>
          <p className="text-lg text-muted max-w-2xl mb-10">
            A composable, privacy-preserving standard that lets any smart contract
            or service verify an AI agent is operated by a real, unique human
            &mdash; without revealing who that human is.
          </p>
          <div className="flex flex-col sm:flex-row gap-3">
            <a href="#demo">
              <Button variant="primary" size="lg">Try the Demo</Button>
            </a>
            <a href="#spec">
              <Button variant="secondary" size="lg">Read the Spec</Button>
            </a>
            <a
              href="https://github.com/selfxyz/self-agent-id"
              target="_blank"
              rel="noopener noreferrer"
            >
              <Button variant="ghost" size="lg">
                GitHub <ExternalLink size={14} />
              </Button>
            </a>
          </div>
        </div>
      </section>

      {/* ───────────────────────── 2. Problem ───────────────────────── */}
      <section className="bg-surface-1 px-6 py-20">
        <div className="max-w-3xl mx-auto text-center">
          <h2 className="text-3xl font-bold mb-6">The Problem</h2>
          <div className="text-lg text-muted leading-relaxed space-y-4">
            <p>
              AI agents are becoming autonomous participants in our digital lives &mdash;
              booking travel, managing finances, writing code, and negotiating on our
              behalf. As they act for us, every service they interact with faces the
              same question: <strong className="text-foreground">&ldquo;Is this agent backed by a real person,
              or is it part of a bot farm?&rdquo;</strong>
            </p>
            <p>
              Without a universal standard, every platform builds its own verification
              &mdash; fragmented, expensive, and unreliable. Proof-of-human gives agents
              a portable, privacy-preserving credential that any service can check
              instantly, without knowing who the human behind the agent is.
            </p>
          </div>
        </div>
      </section>

      {/* ───────────────────────── 3. Solution ───────────────────────── */}
      <section className="px-6 py-20">
        <div className="max-w-4xl mx-auto">
          <h2 className="text-3xl font-bold text-center mb-12">How It Works</h2>

          {/* Flow diagram */}
          <div className="flex flex-col md:flex-row items-center justify-center gap-3 mb-16">
            {[
              { icon: Users, label: "Human", sub: "Scans passport" },
              { icon: Lock, label: "ZK Proof", sub: "Generated locally" },
              { icon: FileCode2, label: "SelfAgentRegistry", sub: "On-chain record" },
              { icon: CheckCircle2, label: "Services Verify", sub: "Read contract state" },
            ].map((step, i) => (
              <div key={i} className="flex items-center gap-3">
                {i > 0 && (
                  <ArrowRight size={20} className="text-subtle hidden md:block" />
                )}
                {i > 0 && (
                  <ArrowRight size={20} className="text-subtle md:hidden rotate-90" />
                )}
                <Card className={`flex flex-col items-center gap-1.5 min-w-[140px] text-center ${
                  i === 3 ? "border-l-2 border-l-accent-success" : ""
                }`}>
                  <step.icon size={24} className={i === 3 ? "text-accent-success" : "text-accent"} />
                  <span className="font-semibold text-sm">{step.label}</span>
                  <span className="text-xs text-muted">{step.sub}</span>
                </Card>
              </div>
            ))}
          </div>

          {/* Properties grid */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
            {[
              {
                icon: Shield,
                title: "Trustless",
                desc: "On-chain verification with no central authority. Any contract can read the registry directly.",
              },
              {
                icon: Eye,
                title: "Private",
                desc: "ZK proofs reveal nothing about the human's identity. Only a nullifier is stored.",
              },
              {
                icon: Layers,
                title: "Composable",
                desc: "A single registry call integrates into any EVM contract, backend service, or agent framework.",
              },
              {
                icon: Fingerprint,
                title: "Sybil-resistant",
                desc: "Each human maps to a unique nullifier, preventing one person from registering unlimited agents.",
              },
            ].map((prop) => (
              <Card key={prop.title} glow>
                <prop.icon size={20} className="text-accent mb-2" />
                <h3 className="font-bold mb-2">{prop.title}</h3>
                <p className="text-sm text-muted leading-relaxed">
                  {prop.desc}
                </p>
              </Card>
            ))}
          </div>
        </div>
      </section>

      {/* ───────────────────── 3b. Integration Guide ──────────────────────── */}
      <section className="px-6 py-20">
        <div className="max-w-4xl mx-auto space-y-8">
          {/* Service developer snippets */}
          <div className="space-y-4">
            <div className="flex items-center gap-2">
              <Code2 size={20} className="text-accent" />
              <h2 className="text-3xl font-bold">Integration Guide for Developers</h2>
            </div>
            <p className="text-sm text-muted">
              These code snippets are for <strong className="text-foreground">service developers</strong> who want to verify
              agents in their applications. Pre-filled with the deployed contract address.
            </p>
            <div className="flex gap-3 flex-wrap">
              <code className="bg-surface-2 font-mono text-accent-2 px-3 py-1.5 rounded text-xs">
                npm install @selfxyz/agent-sdk
              </code>
              <code className="bg-surface-2 font-mono text-accent-2 px-3 py-1.5 rounded text-xs">
                pip install selfxyz-agent-sdk
              </code>
            </div>

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

          {/* Agent operator snippets */}
          <div className="space-y-4">
            <div className="flex items-center gap-2">
              <Cpu size={20} className="text-accent" />
              <h2 className="text-3xl font-bold">How to Use Your Agent</h2>
            </div>
            <p className="text-sm text-muted">
              If you are the <strong className="text-foreground">agent operator</strong>, use these snippets to
              authenticate your agent with services or submit on-chain transactions.
              Set <code className="bg-surface-2 font-mono text-accent-2 px-1 rounded text-xs">AGENT_PRIVATE_KEY</code> in
              your agent&apos;s environment first.
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
        </div>
      </section>

      {/* ───────────────────────── 4. Security Model ───────────────────────── */}
      <section className="bg-surface-1 px-6 py-20">
        <div className="max-w-4xl mx-auto">
          <h2 className="text-3xl font-bold text-center mb-4">Security Model</h2>
          <p className="text-center text-muted max-w-2xl mx-auto mb-12">
            The registry supports four registration modes. All produce the same
            on-chain result &mdash; a verified, sybil-resistant agent NFT &mdash;
            but they differ in who holds the agent&apos;s private key and how the
            human manages their agent.
          </p>

          {/* Four modes — 2x2 grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-12">
            {/* Verified Wallet */}
            <Card>
              <div className="flex items-center gap-2 mb-4">
                <span className="w-8 h-8 rounded-full bg-accent/20 flex items-center justify-center">
                  <Wallet size={16} className="text-accent" />
                </span>
                <h3 className="font-bold text-lg">Verified Wallet</h3>
              </div>
              <p className="text-sm font-medium mb-2">
                Wallet = Agent Identity
              </p>
              <p className="text-sm text-muted mb-4">
                The human&apos;s wallet address becomes the agent key. No extra
                keypair to manage &mdash; ideal for single-agent setups and quick
                integrations.
              </p>
              <div className="space-y-2 text-sm text-muted">
                <p className="font-bold text-foreground">How it&apos;s secured:</p>
                <ul className="list-disc list-inside space-y-1">
                  <li>Key is derived <em>inside</em> the contract callback &mdash; can&apos;t be spoofed</li>
                  <li>ZK proof binds wallet address to human nullifier</li>
                  <li>SDK signs requests with wallet key; services recover signer from ECDSA signature</li>
                </ul>
              </div>
              <div className="mt-4 pt-4 border-t border-border">
                <p className="text-xs text-muted">
                  <strong className="text-foreground">Best for:</strong> Single agent per user, quick setup, on-chain
                  gating where <code className="bg-surface-2 font-mono text-accent-2 px-1 rounded">msg.sender</code> is
                  the agent.
                </p>
              </div>
            </Card>

            {/* Agent Identity */}
            <Card>
              <div className="flex items-center gap-2 mb-4">
                <span className="w-8 h-8 rounded-full bg-accent-2/20 flex items-center justify-center">
                  <Key size={16} className="text-accent-2" />
                </span>
                <h3 className="font-bold text-lg">Agent Identity</h3>
              </div>
              <p className="text-sm font-medium mb-2">
                Independent Agent Key
              </p>
              <p className="text-sm text-muted mb-4">
                The agent generates its own keypair. During registration, the agent
                signs a challenge proving it controls the key. The human proves humanity
                via Self, and the agent proves key ownership via ECDSA &mdash; both in
                a single QR scan.
              </p>
              <div className="space-y-2 text-sm text-muted">
                <p className="font-bold text-foreground">How it&apos;s secured:</p>
                <ul className="list-disc list-inside space-y-1">
                  <li>ECDSA signature in registration proves agent key ownership</li>
                  <li>ZK proof binds human identity to nullifier</li>
                  <li>Agent signs requests with its <em>own</em> key &mdash; human wallet never exposed</li>
                </ul>
              </div>
              <div className="mt-4 pt-4 border-t border-border">
                <p className="text-xs text-muted">
                  <strong className="text-foreground">Best for:</strong> Multiple agents per user, key rotation,
                  delegation, autonomous agents that operate independently.
                </p>
              </div>
            </Card>

            {/* No Wallet */}
            <Card>
              <div className="flex items-center gap-2 mb-4">
                <span className="w-8 h-8 rounded-full bg-accent/20 flex items-center justify-center">
                  <Lock size={16} className="text-accent" />
                </span>
                <h3 className="font-bold text-lg">No Wallet</h3>
              </div>
              <p className="text-sm font-medium mb-2">
                Agent EOA Owns Its NFT
              </p>
              <p className="text-sm text-muted mb-4">
                No crypto wallet required. A fresh agent keypair is generated in the
                browser, and the agent&apos;s own address owns the NFT. An optional guardian
                can be set for recovery. The user manages the raw private key.
              </p>
              <div className="space-y-2 text-sm text-muted">
                <p className="font-bold text-foreground">How it&apos;s secured:</p>
                <ul className="list-disc list-inside space-y-1">
                  <li>Agent signs challenge with its own key during registration</li>
                  <li>ZK proof binds human identity to nullifier</li>
                  <li>Deregister anytime by scanning passport again</li>
                </ul>
              </div>
              <div className="mt-4 pt-4 border-t border-border">
                <p className="text-xs text-muted">
                  <strong className="text-foreground">Best for:</strong> Non-crypto users who just need an agent
                  registered quickly with their passport.
                </p>
              </div>
            </Card>

            {/* Smart Wallet */}
            <Card>
              <div className="flex items-center gap-2 mb-4">
                <span className="w-8 h-8 rounded-full bg-accent-success/20 flex items-center justify-center">
                  <Fingerprint size={16} className="text-accent-success" />
                </span>
                <h3 className="font-bold text-lg">Smart Wallet</h3>
              </div>
              <p className="text-sm font-medium mb-2">
                Passkey + Kernel Smart Account
              </p>
              <p className="text-sm text-muted mb-4">
                A passkey (Face ID / fingerprint) creates a Kernel smart account as
                guardian. No MetaMask, no seed phrase. The agent still has its own ECDSA
                key for signing requests; the smart wallet handles on-chain management
                gaslessly via Pimlico.
              </p>
              <div className="space-y-2 text-sm text-muted">
                <p className="font-bold text-foreground">How it&apos;s secured:</p>
                <ul className="list-disc list-inside space-y-1">
                  <li>Passkey (WebAuthn) backed by device biometrics &mdash; phishing-resistant</li>
                  <li>Smart wallet = guardian, can revoke agent gaslessly</li>
                  <li>Agent signs requests with its own ECDSA key</li>
                </ul>
              </div>
              <div className="mt-4 pt-4 border-t border-border">
                <p className="text-xs text-muted">
                  <strong className="text-foreground">Best for:</strong> Users who want the simplest experience
                  with no seed phrases, no browser extensions, and gasless management.
                </p>
              </div>
            </Card>
          </div>

          {/* Shared security layers */}
          <div className="space-y-10">
            <div>
              <h3 className="font-bold text-lg mb-3">ZK-Attested Credentials</h3>
              <p className="text-muted mb-4">
                Agents can optionally carry ZK-attested claims from their human backer &mdash;
                such as age verification (over 18), OFAC sanctions clearance, nationality, or name.
                During registration, the user chooses which fields to disclose. The Self app generates
                a zero-knowledge proof on the user&apos;s phone &mdash; only the attested result
                is stored on-chain, never raw passport data.
              </p>
              <p className="text-muted">
                Any service can query an agent&apos;s credentials on-chain or via the SDK &mdash;
                no additional identity check needed. Unselected fields are simply not included.
                All disclosures are fully optional and chosen by the user at registration time.
              </p>
            </div>

            <div>
              <h3 className="font-bold text-lg mb-3">Off-Chain: Request Signing</h3>
              <p className="text-muted mb-4">
                The on-chain registry proves <em>&ldquo;this address is human-backed.&rdquo;</em>{" "}
                But when an agent makes an API call, the service needs to prove{" "}
                <em>&ldquo;this request actually came from that address.&rdquo;</em>{" "}
                Without this, anyone could claim to be a registered agent.
              </p>
              <p className="text-muted mb-4">
                The SDK solves this with ECDSA request signing. In both modes, the
                flow is the same:
              </p>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
                <Card>
                  <p className="font-bold text-sm mb-2">Agent Side</p>
                  <p className="text-sm text-muted">
                    Signs each request with the agent&apos;s private key (wallet key in simple
                    mode, independent key in advanced mode). The signature covers the
                    timestamp, HTTP method, URL, and body hash &mdash; preventing replay
                    and tampering.
                  </p>
                </Card>
                <Card>
                  <p className="font-bold text-sm mb-2">Service Side</p>
                  <p className="text-sm text-muted">
                    Recovers the signer address from the ECDSA signature (cryptographic,
                    can&apos;t be faked), converts it to a bytes32 key, and checks{" "}
                    <code className="bg-surface-2 font-mono text-accent-2 px-1 rounded">isVerifiedAgent()</code>{" "}
                    on-chain.
                  </p>
                </Card>
              </div>
              <p className="text-muted">
                The signer&apos;s identity is <strong className="text-foreground">recovered from the signature itself</strong>,
                never trusted from a header. This closes the off-chain verification gap
                completely.
              </p>
              <p className="text-muted mt-3">
                <strong className="text-foreground">Fully composable</strong> &mdash; SDKs are available for{" "}
                <code className="bg-surface-2 font-mono text-accent-2 px-1 rounded">TypeScript</code>,{" "}
                <code className="bg-surface-2 font-mono text-accent-2 px-1 rounded">Python</code>, and raw implementations in any language.
                Sign requests in Python, verify in TypeScript, or vice versa. The signing
                protocol is language-agnostic &mdash; all SDKs produce identical signatures.
              </p>
            </div>

            {/* Sybil resistance */}
            <div>
              <h3 className="font-bold text-lg mb-3">Sybil Resistance</h3>
              <p className="text-muted mb-4">
                Each human gets a unique, privacy-preserving nullifier derived from their
                passport. The registry tracks how many agents share each nullifier.
                Services can enforce their own limits:
              </p>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <Card>
                  <p className="font-bold text-sm mb-1">Strict (max 1)</p>
                  <p className="text-xs text-muted">
                    One agent per human. Best for governance voting, airdrops, and
                    any context where uniqueness matters.
                  </p>
                </Card>
                <Card>
                  <p className="font-bold text-sm mb-1">Moderate (max N)</p>
                  <p className="text-xs text-muted">
                    Allow a few agents per human. Good for agent marketplaces where
                    one person might run multiple bots.
                  </p>
                </Card>
                <Card>
                  <p className="font-bold text-sm mb-1">Detection only</p>
                  <p className="text-xs text-muted">
                    Allow unlimited but flag duplicates with{" "}
                    <code className="bg-surface-2 font-mono text-accent-2 px-1 rounded text-xs">sameHuman()</code>.
                    Good for analytics and reputation.
                  </p>
                </Card>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ───────────────── 4b. A2A Agent Cards & Reputation ──────────── */}
      <section className="px-6 py-20">
        <div className="max-w-2xl mx-auto">
          <h2 className="text-3xl font-bold text-center mb-4">A2A Agent Cards &amp; Reputation Scoring</h2>
          <p className="text-center text-muted mb-10">
            Every registered agent gets an A2A-compatible identity card with a trust score backed by on-chain verification.
          </p>

          {/* Verification Strength Scale */}
          <Card className="mb-8">
            <p className="font-bold text-sm mb-3">Verification Strength Scale</p>
            <p className="text-xs text-muted mb-4">
              The score comes from the proof provider that verified the agent &mdash; not computed client-side.
              Self Protocol uses passport/biometric NFC verification (strength 100).
            </p>
            <div className="space-y-2 font-mono text-xs">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-full bg-green-500 flex items-center justify-center text-white font-bold text-[10px]">100</div>
                <div className="flex-1 bg-green-500/20 rounded h-4" />
                <span className="text-muted w-48">Passport / Biometric ID</span>
              </div>
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-full bg-green-500 flex items-center justify-center text-white font-bold text-[10px]">80</div>
                <div className="flex-1 bg-green-500/20 rounded h-4 w-4/5" />
                <span className="text-muted w-48">KYC Verification</span>
              </div>
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-full bg-blue-500 flex items-center justify-center text-white font-bold text-[10px]">60</div>
                <div className="flex-1 bg-blue-500/20 rounded h-4 w-3/5" />
                <span className="text-muted w-48">Government ID (no chip)</span>
              </div>
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-full bg-amber-500 flex items-center justify-center text-white font-bold text-[10px]">40</div>
                <div className="flex-1 bg-amber-500/20 rounded h-4 w-2/5" />
                <span className="text-muted w-48">Liveness Check</span>
              </div>
            </div>
          </Card>

          {/* Developer Examples */}
          <Card className="mb-8">
            <p className="font-bold text-sm mb-3">For Developers: Reputation-Based Access Control</p>
            <p className="text-xs text-muted mb-4">
              Use the HTTP API to check an agent&apos;s verification strength before granting access.
            </p>
            <pre className="bg-surface-2 border border-border rounded-lg p-4 text-xs overflow-auto mb-4">
{`// Quick check: Only accept passport-verified agents
const res = await fetch(\`https://selfagentid.xyz/api/reputation/42220/\${agentId}\`);
const { score, proofType } = await res.json();

if (score < 100) {
  throw new Error("Agent must be verified with passport");
}`}</pre>
            <pre className="bg-surface-2 border border-border rounded-lg p-4 text-xs overflow-auto mb-4">
{`// Tiered access based on verification strength
const accessLevel = score >= 100 ? "full"
                  : score >= 80  ? "standard"
                  : score >= 60  ? "limited"
                  : "rejected";`}</pre>
            <pre className="bg-surface-2 border border-border rounded-lg p-4 text-xs overflow-auto">
{`// On-chain: Use SelfReputationProvider directly
SelfReputationProvider rep = SelfReputationProvider(0x...);
uint8 score = rep.getReputationScore(agentId);
require(score >= 80, "Insufficient verification");`}</pre>
          </Card>

          {/* ERC-8004 Three Registries */}
          <Card>
            <p className="font-bold text-sm mb-3">ERC-8004: Three Registries</p>
            <p className="text-xs text-muted mb-4">
              Self Protocol covers all three registry types defined by ERC-8004:
            </p>
            <div className="space-y-3 text-xs">
              <div className="flex items-start gap-3">
                <Badge variant="success">Identity</Badge>
                <div>
                  <p className="font-medium">SelfAgentRegistry</p>
                  <p className="text-muted">Agent NFT + human proof + ZK-attested credentials</p>
                </div>
              </div>
              <div className="flex items-start gap-3">
                <Badge variant="info">Reputation</Badge>
                <div>
                  <p className="font-medium">SelfReputationProvider</p>
                  <p className="text-muted">Verification strength score from proof providers</p>
                </div>
              </div>
              <div className="flex items-start gap-3">
                <Badge variant="muted">Validation</Badge>
                <div>
                  <p className="font-medium">SelfValidationProvider</p>
                  <p className="text-muted">Real-time proof status + freshness check</p>
                </div>
              </div>
            </div>
          </Card>
        </div>
      </section>

      {/* ───────────────────────── 5. Live Demo ───────────────────────── */}
      <section id="demo" className="bg-surface-1 px-6 py-20">
        <div className="max-w-2xl mx-auto">
          <h2 className="text-3xl font-bold text-center mb-4">Live Demo</h2>
          <p className="text-center text-muted mb-10">
            Register a new agent or verify an existing one on Celo.
          </p>

          <div className="flex justify-center mb-10">
            <Link href="/register">
              <Button variant="primary" size="lg">Register an Agent</Button>
            </Link>
          </div>

          {/* Inline verify widget */}
          <Card>
            <div className="flex items-center gap-2 mb-4">
              <Search size={18} className="text-accent" />
              <h3 className="font-bold text-lg">Verify an Agent</h3>
            </div>
            <p className="text-sm text-muted mb-4">
              Paste an agent address or bytes32 key to check its on-chain status.
            </p>
            <div className="flex flex-col sm:flex-row gap-3 mb-4">
              <input
                type="text"
                placeholder="0x... (address or bytes32)"
                value={pubKeyInput}
                onChange={(e) => {
                  setPubKeyInput(e.target.value);
                  setVerifyStatus("idle");
                }}
                className="flex-1 px-4 py-3 bg-surface-2 border border-border rounded-lg text-sm font-mono focus:border-accent"
              />
              <Button
                onClick={handleVerify}
                disabled={verifyStatus === "loading"}
                variant="primary"
              >
                {verifyStatus === "loading" ? "Checking..." : "Verify"}
              </Button>
            </div>

            {verifyStatus === "verified" && (
              <div className="bg-accent-success/10 border border-accent-success/20 text-accent-success rounded-lg px-4 py-3 text-sm">
                Verified &mdash; this agent is registered and human-backed.
              </div>
            )}
            {verifyStatus === "not-registered" && (
              <div className="bg-accent-warn/10 border border-accent-warn/20 text-accent-warn rounded-lg px-4 py-3 text-sm">
                Not registered &mdash; this public key has no verified agent entry.
              </div>
            )}
            {verifyStatus === "error" && (
              <div className="bg-accent-error/10 border border-accent-error/20 text-accent-error rounded-lg px-4 py-3 text-sm">
                Error: {verifyError}
              </div>
            )}
          </Card>
        </div>
      </section>

      {/* ───────────────────────── 7. Interface Spec ───────────────────────── */}
      <section id="spec" className="px-6 py-20">
        <div className="max-w-4xl mx-auto">
          <h2 className="text-3xl font-bold text-center mb-4">
            Interface Specification
          </h2>
          <p className="text-center text-muted mb-10">
            This extension adds proof-of-human capabilities to the ERC-8004 Agent
            Registry standard. The additions are shown below.
          </p>

          <div className="space-y-8">
            <div>
              <h3 className="font-bold text-lg mb-2">ERC-8004 Base Standard</h3>
              <p className="text-sm text-muted mb-3">
                The base agent registry that every ERC-8004 implementation provides.
              </p>
              <CodeBlock
                tabs={[
                  {
                    label: "Solidity",
                    language: "solidity",
                    code: `/// @title IERC8004 — Agent Registry (Base Standard)
interface IERC8004 {
    function registerAgent(bytes32 agentPubKey) external returns (uint256);
    function getAgentId(bytes32 agentPubKey) external view returns (uint256);
    function ownerOf(uint256 agentId) external view returns (address);
}`,
                  },
                ]}
              />
            </div>

            <div>
              <div className="flex items-center gap-2 mb-2">
                <h3 className="font-bold text-lg">Proof-of-Human Extension</h3>
              </div>
              <p className="text-sm text-muted mb-3">
                These functions are added on top of ERC-8004 to provide
                human-verification guarantees. Any protocol can query these to
                check if an agent is backed by a verified human.
              </p>
              <CodeBlock
                tabs={[
                  {
                    label: "Solidity",
                    language: "solidity",
                    code: `/// @title IERC8004ProofOfHuman — Extension Interface
/// @notice Adds proof-of-human verification to ERC-8004 agents.
interface IERC8004ProofOfHuman is IERC8004 {
    // ── Registration ──────────────────────────────
    function registerWithHumanProof(
        string calldata agentMetadata,
        address proofProvider,
        bytes calldata proof,
        bytes calldata providerData
    ) external returns (uint256 agentId);

    function revokeHumanProof(
        uint256 agentId,
        address proofProvider,
        bytes calldata proof,
        bytes calldata providerData
    ) external;

    // ── Verification (read by any service/contract) ─
    function isVerifiedAgent(bytes32 agentPubKey) external view returns (bool);
    function hasHumanProof(uint256 agentId) external view returns (bool);
    function getHumanNullifier(uint256 agentId) external view returns (uint256);
    function getProofProvider(uint256 agentId) external view returns (address);

    // ── Sybil detection ───────────────────────────
    function getAgentCountForHuman(uint256 nullifier) external view returns (uint256);
    function sameHuman(uint256 a, uint256 b) external view returns (bool);
}`,
                  },
                ]}
              />
            </div>

            <div>
              <div className="flex items-center gap-2 mb-2">
                <h3 className="font-bold text-lg">IHumanProofProvider</h3>
              </div>
              <p className="text-sm text-muted mb-3">
                Pluggable interface for identity verification backends. Self
                Protocol is the reference provider; any ZK identity system can
                implement this.
              </p>
              <CodeBlock
                tabs={[
                  {
                    label: "Solidity",
                    language: "solidity",
                    code: `/// @title IHumanProofProvider
/// @notice Pluggable identity backend for proof-of-human.
interface IHumanProofProvider {
    /// @notice Verify a ZK proof and return (success, nullifier).
    function verifyHumanProof(
        bytes calldata proof,
        bytes calldata providerData
    ) external returns (bool verified, uint256 nullifier);

    /// @notice Human-readable provider name (e.g. "Self Protocol").
    function providerName() external view returns (string memory);

    /// @notice Verification strength score (0-100).
    function verificationStrength() external view returns (uint256);
}`,
                  },
                ]}
              />
            </div>
          </div>

          <div className="flex flex-col items-center gap-2 mt-8">
            <p className="text-center text-sm text-muted">
              View the reference implementation on{" "}
              <a
                href="https://github.com/selfxyz/self-agent-id"
                target="_blank"
                rel="noopener noreferrer"
                className="text-accent hover:text-accent-2 underline"
              >
                GitHub
              </a>{" "}
              or the deployed contract on{" "}
              <a
                href={`${network.blockExplorer}/address/${network.registryAddress}`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-accent hover:text-accent-2 underline"
              >
                {network.isTestnet ? "Blockscout" : "Celoscan"}
              </a>
              .
            </p>
          </div>
        </div>
      </section>
    </main>
  );
}
