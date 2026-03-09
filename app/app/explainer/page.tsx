// SPDX-FileCopyrightText: 2025-2026 Social Connect Labs, Inc.
// SPDX-License-Identifier: BUSL-1.1
// NOTE: Converts to Apache-2.0 on 2029-06-11 per LICENSE.

"use client";

import Link from "next/link";
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
  ExternalLink,
  Code2,
  Terminal,
} from "lucide-react";
import { PrivyIcon } from "@/components/PrivyIcon";
import CodeBlock from "@/components/CodeBlock";
import { useNetwork } from "@/lib/NetworkContext";
import { Card } from "@/components/Card";
import { Badge } from "@/components/Badge";
import { Button } from "@/components/Button";

export default function ExplainerPage() {
  const { network } = useNetwork();

  return (
    <main className="min-h-screen">
      {/* ───────────────────────── 1. Hero ───────────────────────── */}
      <section className="relative overflow-hidden hero-glow bg-grid">
        <div className="relative z-10 flex flex-col items-center justify-center text-center px-6 pt-32 pb-20 md:pb-28">
          <Badge variant="info" className="mb-4">
            Proposed Extension to ERC-8004
          </Badge>
          <img
            src="/self-icon.png"
            alt="Self"
            width={64}
            height={64}
            className="rounded-xl mb-4"
          />
          <h1 className="text-4xl sm:text-5xl font-bold tracking-tight text-foreground mb-6">
            Proof-of-Human for AI Agents
          </h1>
          <p className="text-lg text-muted max-w-2xl mb-10">
            A composable, privacy-preserving standard that lets any smart
            contract or service verify an AI agent is operated by a real, unique
            human, without revealing who that human is.
          </p>
          <div className="flex flex-col sm:flex-row gap-3">
            <Link href="/integration">
              <Button variant="primary" size="lg">
                Integration Guide
              </Button>
            </Link>
            <a href="#spec">
              <Button variant="secondary" size="lg">
                Read the Spec
              </Button>
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
              AI agents are becoming autonomous participants: booking travel,
              managing finances, negotiating on our behalf. Every service they
              touch faces the same question:{" "}
              <strong className="text-foreground">
                &ldquo;Is this agent backed by a real person, or is it a
                bot?&rdquo;
              </strong>
            </p>
            <p>
              Without a standard, every platform builds its own verification.
              Fragmented, expensive, and unreliable. Proof-of-human gives agents
              a portable credential that any service can check instantly,
              without knowing who the human is.
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
              { icon: Users, label: "Human", sub: "Scans document" },
              { icon: Lock, label: "ZK Proof", sub: "Generated locally" },
              {
                icon: FileCode2,
                label: "SelfAgentRegistry",
                sub: "On-chain record",
              },
              {
                icon: CheckCircle2,
                label: "Services Verify",
                sub: "Read contract state",
              },
            ].map((step, i) => (
              <div key={i} className="flex items-center gap-3">
                {i > 0 && (
                  <ArrowRight
                    size={20}
                    className="text-subtle hidden md:block"
                  />
                )}
                {i > 0 && (
                  <ArrowRight
                    size={20}
                    className="text-subtle md:hidden rotate-90"
                  />
                )}
                <Card
                  className={`flex flex-col items-center gap-1.5 min-w-[140px] text-center ${
                    i === 3 ? "border-l-2 border-l-accent-success" : ""
                  }`}
                >
                  <step.icon
                    size={24}
                    className={i === 3 ? "text-accent-success" : "text-accent"}
                  />
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

      {/* ───────────────────── CTA: Integration Guide ──────────────────────── */}
      <section className="px-6 py-12">
        <div className="max-w-4xl mx-auto">
          <Card className="border border-accent/30 bg-accent/5 text-center">
            <div className="flex items-center justify-center gap-2 mb-2">
              <Code2 size={20} className="text-accent" />
              <p className="font-bold text-lg">Ready to Integrate?</p>
            </div>
            <p className="text-sm text-muted mb-4 max-w-lg mx-auto">
              Get code snippets for verifying agents in your service,
              authenticating your agent with services, and using the CLI for
              terminal workflows &mdash; in TypeScript, Python, and Rust.
            </p>
            <div className="flex justify-center gap-3">
              <Link href="/integration">
                <Button variant="primary">Integration Guide</Button>
              </Link>
              <Link href="/demo">
                <Button variant="secondary">Try the Demo</Button>
              </Link>
            </div>
          </Card>
        </div>
      </section>

      {/* ───────────────────────── 4. Security Model ───────────────────────── */}
      <section className="bg-surface-1 px-6 py-20">
        <div className="max-w-4xl mx-auto">
          <h2 className="text-3xl font-bold text-center mb-4">
            Security Model
          </h2>
          <p className="text-center text-muted max-w-2xl mx-auto mb-12">
            The registry supports six registration modes. All produce the same
            on-chain result (a verified, sybil-resistant agent NFT) but they
            differ in who holds the agent&apos;s private key, what key type is
            used, and how the human manages their agent.
          </p>

          {/* Six modes grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 mb-12">
            {/* Linked Agent */}
            <Card>
              <div className="flex items-center gap-2 mb-4">
                <span className="w-8 h-8 rounded-full bg-accent-2/20 flex items-center justify-center">
                  <Key size={16} className="text-accent-2" />
                </span>
                <h3 className="font-bold text-lg">Linked Agent</h3>
              </div>
              <p className="text-sm font-medium mb-2">Agent Key + Wallet Guardian</p>
              <p className="text-sm text-muted mb-4">
                A fresh EVM agent keypair is generated. Your connected wallet
                becomes the guardian, giving you direct revocation control. The
                human proves humanity via Self, and the agent key is linked to
                your wallet on-chain.
              </p>
              <div className="space-y-2 text-sm text-muted">
                <p className="font-bold text-foreground">
                  How it&apos;s secured:
                </p>
                <ul className="list-disc list-inside space-y-1">
                  <li>
                    ECDSA signature in registration proves agent key ownership
                  </li>
                  <li>ZK proof binds human identity to nullifier</li>
                  <li>
                    Agent signs requests with its <em>own</em> key &mdash; human
                    wallet never exposed
                  </li>
                  <li>Guardian wallet can revoke the agent at any time</li>
                </ul>
              </div>
              <div className="mt-4 pt-4 border-t border-border">
                <p className="text-xs text-muted">
                  <strong className="text-foreground">Best for:</strong>{" "}
                  Developers who already have a wallet and want direct
                  revocation control over their agents.
                </p>
              </div>
            </Card>

            {/* Wallet-Free */}
            <Card>
              <div className="flex items-center gap-2 mb-4">
                <span className="w-8 h-8 rounded-full bg-accent/20 flex items-center justify-center">
                  <Lock size={16} className="text-accent" />
                </span>
                <h3 className="font-bold text-lg">Wallet-Free</h3>
              </div>
              <p className="text-sm font-medium mb-2">No Wallet Required</p>
              <p className="text-sm text-muted mb-4">
                No crypto wallet required. A fresh agent keypair is generated in
                the browser, and the agent&apos;s own address owns the NFT.
                Revoke anytime by scanning your passport again in the Self app.
              </p>
              <div className="space-y-2 text-sm text-muted">
                <p className="font-bold text-foreground">
                  How it&apos;s secured:
                </p>
                <ul className="list-disc list-inside space-y-1">
                  <li>
                    Agent signs challenge with its own key during registration
                  </li>
                  <li>ZK proof binds human identity to nullifier</li>
                  <li>Deregister anytime by scanning passport again</li>
                </ul>
              </div>
              <div className="mt-4 pt-4 border-t border-border">
                <p className="text-xs text-muted">
                  <strong className="text-foreground">Best for:</strong>{" "}
                  Quick start without any wallet setup or crypto knowledge.
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
                A passkey (Face ID / fingerprint) creates a Kernel smart account
                as guardian. No MetaMask, no seed phrase. The agent still has
                its own ECDSA key for signing requests; the smart wallet handles
                on-chain management gaslessly via Pimlico.
              </p>
              <div className="space-y-2 text-sm text-muted">
                <p className="font-bold text-foreground">
                  How it&apos;s secured:
                </p>
                <ul className="list-disc list-inside space-y-1">
                  <li>
                    Passkey (WebAuthn) backed by device biometrics,
                    phishing-resistant
                  </li>
                  <li>Smart wallet = guardian, can revoke agent gaslessly</li>
                  <li>Agent signs requests with its own ECDSA key</li>
                </ul>
              </div>
              <div className="mt-4 pt-4 border-t border-border">
                <p className="text-xs text-muted">
                  <strong className="text-foreground">Best for:</strong> Users
                  who want the simplest experience with no seed phrases, no
                  browser extensions, and gasless management.
                </p>
              </div>
            </Card>

            {/* Social Login (Privy) */}
            <Card>
              <div className="flex items-center gap-2 mb-4">
                <PrivyIcon size={20} />
                <h3 className="font-bold text-lg">Social Login (Privy)</h3>
              </div>
              <p className="text-sm font-medium mb-2">
                Email / Google / Twitter &rarr; Embedded Wallet
              </p>
              <p className="text-sm text-muted mb-4">
                Sign in with a social account via Privy. An embedded wallet is
                created automatically &mdash; no browser extension or seed
                phrase. A separate agent keypair is generated, and the Privy
                wallet becomes the guardian.
              </p>
              <div className="space-y-2 text-sm text-muted">
                <p className="font-bold text-foreground">
                  How it&apos;s secured:
                </p>
                <ul className="list-disc list-inside space-y-1">
                  <li>
                    Privy authenticates the human via social login (MPC-secured
                    embedded wallet)
                  </li>
                  <li>
                    Agent generates its own keypair &mdash; signs challenge
                    proving key ownership
                  </li>
                  <li>ZK proof binds human identity to nullifier</li>
                  <li>
                    Agent operates with its own key at runtime &mdash; no Privy
                    dependency
                  </li>
                </ul>
              </div>
              <div className="mt-4 pt-4 border-t border-border">
                <p className="text-xs text-muted">
                  <strong className="text-foreground">Best for:</strong> Users
                  who prefer social login (email, Google, Twitter) over browser
                  extensions. No crypto wallet setup required.
                </p>
              </div>
            </Card>

            {/* Ed25519 */}
            <Card>
              <div className="flex items-center gap-2 mb-4">
                <span className="w-8 h-8 rounded-full bg-accent/20 flex items-center justify-center">
                  <Terminal size={16} className="text-accent" />
                </span>
                <h3 className="font-bold text-lg">Ed25519</h3>
              </div>
              <p className="text-sm font-medium mb-2">Existing Agent Key</p>
              <p className="text-sm text-muted mb-4">
                For agents that already have Ed25519 keys (common in AI
                frameworks like Eliza, OpenClaw, and SSH-style agents). Paste
                your agent&apos;s existing public key &mdash; no new key
                generation needed. The agent signs a challenge to prove key
                ownership.
              </p>
              <div className="space-y-2 text-sm text-muted">
                <p className="font-bold text-foreground">
                  How it&apos;s secured:
                </p>
                <ul className="list-disc list-inside space-y-1">
                  <li>Ed25519 signature proves agent key ownership</li>
                  <li>ZK proof binds human identity to nullifier</li>
                  <li>Deregister anytime by scanning passport again</li>
                </ul>
              </div>
              <div className="mt-4 pt-4 border-t border-border">
                <p className="text-xs text-muted">
                  <strong className="text-foreground">Best for:</strong>{" "}
                  AI agents using Ed25519 keys natively (Eliza, OpenClaw, SSH
                  agents, etc.).
                </p>
              </div>
            </Card>

            {/* Ed25519 + Guardian */}
            <Card>
              <div className="flex items-center gap-2 mb-4">
                <span className="w-8 h-8 rounded-full bg-accent/20 flex items-center justify-center">
                  <Terminal size={16} className="text-accent" />
                </span>
                <h3 className="font-bold text-lg">Ed25519 + Guardian</h3>
              </div>
              <p className="text-sm font-medium mb-2">
                Ed25519 Key + Wallet Guardian
              </p>
              <p className="text-sm text-muted mb-4">
                Same as Ed25519, but your connected wallet becomes the guardian.
                This gives you direct wallet-based revocation control over the
                agent, in addition to passport-based revocation.
              </p>
              <div className="space-y-2 text-sm text-muted">
                <p className="font-bold text-foreground">
                  How it&apos;s secured:
                </p>
                <ul className="list-disc list-inside space-y-1">
                  <li>Ed25519 signature proves agent key ownership</li>
                  <li>ZK proof binds human identity to nullifier</li>
                  <li>Guardian wallet can revoke the agent at any time</li>
                  <li>Passport revocation also available as fallback</li>
                </ul>
              </div>
              <div className="mt-4 pt-4 border-t border-border">
                <p className="text-xs text-muted">
                  <strong className="text-foreground">Best for:</strong>{" "}
                  Ed25519 agents where a human wants direct wallet-based
                  revocation control.
                </p>
              </div>
            </Card>
          </div>

          {/* Shared security layers */}
          <div className="space-y-10">
            <div>
              <h3 className="font-bold text-lg mb-3">
                ZK-Attested Credentials
              </h3>
              <p className="text-muted mb-4">
                Agents can optionally carry ZK-attested claims from their human
                backer, such as age verification (over 18 or 21), OFAC sanctions
                clearance, nationality, or name. During registration, the user
                chooses which fields to disclose. The Self app generates a
                zero-knowledge proof on the user&apos;s phone. Only the attested
                result is stored on-chain, never raw passport data.
              </p>
              <p className="text-muted">
                Any service can query an agent&apos;s credentials on-chain or
                via the SDK. No additional identity check needed. Unselected
                fields are simply not included. All disclosures are fully
                optional and chosen by the user at registration time.
              </p>
            </div>

            <div>
              <h3 className="font-bold text-lg mb-3">
                Off-Chain: Request Signing
              </h3>
              <p className="text-muted mb-4">
                The on-chain registry proves{" "}
                <em>&ldquo;this address is human-backed.&rdquo;</em> But when an
                agent makes an API call, the service needs to prove{" "}
                <em>
                  &ldquo;this request actually came from that address.&rdquo;
                </em>{" "}
                Without this, anyone could claim to be a registered agent.
              </p>
              <p className="text-muted mb-4">
                The SDK solves this with ECDSA request signing. Regardless of
                registration mode, the flow is the same:
              </p>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
                <Card>
                  <p className="font-bold text-sm mb-2">Agent Side</p>
                  <p className="text-sm text-muted">
                    Signs each request with the agent&apos;s private key. The
                    signature covers the timestamp, HTTP method, URL, and body
                    hash, preventing replay and tampering.
                  </p>
                </Card>
                <Card>
                  <p className="font-bold text-sm mb-2">Service Side</p>
                  <p className="text-sm text-muted">
                    Recovers the signer address from the ECDSA signature
                    (cryptographic, can&apos;t be faked), converts it to a
                    bytes32 key, and checks{" "}
                    <code className="bg-surface-2 font-mono text-accent-2 px-1 rounded">
                      isVerifiedAgent()
                    </code>{" "}
                    on-chain.
                  </p>
                </Card>
              </div>
              <p className="text-muted">
                The signer&apos;s identity is{" "}
                <strong className="text-foreground">
                  recovered from the signature itself
                </strong>
                , never trusted from a header. This closes the off-chain
                verification gap completely.
              </p>
              <p className="text-muted mt-3">
                <strong className="text-foreground">Fully composable.</strong>{" "}
                SDKs are available for{" "}
                <code className="bg-surface-2 font-mono text-accent-2 px-1 rounded">
                  TypeScript
                </code>
                ,{" "}
                <code className="bg-surface-2 font-mono text-accent-2 px-1 rounded">
                  Python
                </code>
                , and{" "}
                <code className="bg-surface-2 font-mono text-accent-2 px-1 rounded">
                  Rust
                </code>
                , with the signing protocol open for raw implementations in any
                language. Sign requests in Python, verify in Rust, or vice
                versa. The signing protocol is language-agnostic &mdash; all
                SDKs produce identical signatures.
              </p>
            </div>

            {/* Sybil resistance */}
            <div>
              <h3 className="font-bold text-lg mb-3">Sybil Resistance</h3>
              <p className="text-muted mb-4">
                Each human gets a unique, privacy-preserving nullifier derived
                from their passport. The registry tracks how many agents share
                each nullifier. Services can enforce their own limits:
              </p>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <Card>
                  <p className="font-bold text-sm mb-1">Strict (max 1)</p>
                  <p className="text-xs text-muted">
                    One agent per human. Best for governance voting, airdrops,
                    and any context where uniqueness matters.
                  </p>
                </Card>
                <Card>
                  <p className="font-bold text-sm mb-1">Moderate (max N)</p>
                  <p className="text-xs text-muted">
                    Allow a few agents per human. Good for agent marketplaces
                    where one person might run multiple bots.
                  </p>
                </Card>
                <Card>
                  <p className="font-bold text-sm mb-1">Detection only</p>
                  <p className="text-xs text-muted">
                    Allow unlimited but flag duplicates with{" "}
                    <code className="bg-surface-2 font-mono text-accent-2 px-1 rounded text-xs">
                      sameHuman()
                    </code>
                    . Good for analytics and reputation.
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
          <h2 className="text-3xl font-bold text-center mb-4">
            A2A Agent Cards &amp; Reputation Scoring
          </h2>
          <p className="text-center text-muted mb-10">
            Every registered agent gets an A2A-compatible identity card with a
            trust score backed by on-chain verification.
          </p>

          {/* Verification Strength Scale */}
          <Card className="mb-8">
            <p className="font-bold text-sm mb-3">
              Verification Strength Scale
            </p>
            <p className="text-xs text-muted mb-4">
              The score comes from the proof provider that verified the agent,
              not computed client-side. Self Protocol uses passport/biometric
              NFC verification (strength 100).
            </p>
            <div className="space-y-2 font-mono text-xs">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-full bg-green-500 flex items-center justify-center text-white font-bold text-[10px]">
                  100
                </div>
                <div className="flex-1 bg-green-500/20 rounded h-4" />
                <span className="text-muted w-48">Biometric Passport</span>
              </div>
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-full bg-green-500 flex items-center justify-center text-white font-bold text-[10px]">
                  100
                </div>
                <div className="flex-1 bg-green-500/20 rounded h-4" />
                <span className="text-muted w-48">Biometric ID Card</span>
              </div>
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-full bg-green-500 flex items-center justify-center text-white font-bold text-[10px]">
                  80
                </div>
                <div className="flex-1 bg-green-500/20 rounded h-4 w-4/5" />
                <span className="text-muted w-48">Aadhaar</span>
              </div>
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-full bg-blue-500 flex items-center justify-center text-white font-bold text-[10px]">
                  50
                </div>
                <div className="flex-1 bg-blue-500/20 rounded h-4 w-1/2" />
                <span className="text-muted w-48">Third-Party Identity Check</span>
              </div>
            </div>
          </Card>

          {/* Developer Examples */}
          <Card className="mb-8">
            <p className="font-bold text-sm mb-3">
              For Developers: Reputation-Based Access Control
            </p>
            <p className="text-xs text-muted mb-4">
              Use the HTTP API to check an agent&apos;s verification strength
              before granting access.
            </p>
            <pre className="bg-surface-2 border border-border rounded-lg p-4 text-xs overflow-auto mb-4">
              {`// Quick check: Only accept passport-verified agents
const baseUrl = "https://self-agent-id.vercel.app"; // replace with your deployment URL
const res = await fetch(\`\${baseUrl}/api/reputation/42220/\${agentId}\`);
const { score, proofType } = await res.json();

if (score < 100) {
  throw new Error("Agent must be verified with passport");
}`}
            </pre>
            <pre className="bg-surface-2 border border-border rounded-lg p-4 text-xs overflow-auto mb-4">
              {`// Tiered access based on verification strength
const accessLevel = score >= 100 ? "full"       // biometric passport/ID
                  : score >= 80  ? "standard"    // Aadhaar
                  : score >= 50  ? "limited"     // third-party identity check
                  : "rejected";`}
            </pre>
            <pre className="bg-surface-2 border border-border rounded-lg p-4 text-xs overflow-auto">
              {`// On-chain: Use SelfReputationProvider directly
SelfReputationProvider rep = SelfReputationProvider(0x...);
uint8 score = rep.getReputationScore(agentId);
require(score >= 80, "Insufficient verification");`}
            </pre>
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
                  <p className="text-muted">
                    Agent NFT + human proof + ZK-attested credentials
                  </p>
                </div>
              </div>
              <div className="flex items-start gap-3">
                <Badge variant="info">Reputation</Badge>
                <div>
                  <p className="font-medium">SelfReputationProvider</p>
                  <p className="text-muted">
                    Verification strength score from proof providers
                  </p>
                </div>
              </div>
              <div className="flex items-start gap-3">
                <Badge variant="muted">Validation</Badge>
                <div>
                  <p className="font-medium">SelfValidationProvider</p>
                  <p className="text-muted">
                    Real-time proof status + freshness check
                  </p>
                </div>
              </div>
            </div>
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
            This extension adds proof-of-human capabilities to the ERC-8004
            Agent Registry standard. The additions are shown below.
          </p>

          <div className="space-y-8">
            <div>
              <h3 className="font-bold text-lg mb-2">ERC-8004 Base Standard</h3>
              <p className="text-sm text-muted mb-3">
                The base agent registry that every ERC-8004 implementation
                provides.
              </p>
              <CodeBlock
                tabs={[
                  {
                    label: "Solidity",
                    language: "solidity",
                    code: `/// @title IERC8004 - Agent Registry (Base Standard)
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
                    code: `/// @title IERC8004ProofOfHuman - Extension Interface
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
