"use client";

import Link from "next/link";
import {
  Search,
  FileCode2,
  Key,
  ShieldCheck,
  CheckCircle2,
  ArrowRight,
  Cpu,
  Wallet,
  Smartphone,
} from "lucide-react";
import { Card } from "@/components/Card";
import { Badge } from "@/components/Badge";

function StepNumber({ n }: { n: number }) {
  return (
    <span className="flex-shrink-0 w-7 h-7 rounded-full bg-gradient-to-br from-accent to-accent-2 text-white text-sm font-bold flex items-center justify-center">
      {n}
    </span>
  );
}

export default function Home() {
  return (
    <main className="min-h-screen">
      {/* Hero */}
      <section className="relative overflow-hidden hero-glow bg-grid">
        <div className="relative z-10 max-w-4xl mx-auto px-6 pt-32 pb-20 text-center">
          <Badge variant="info" className="mb-6">
            Proof-of-Human for AI Agents
          </Badge>
          <div className="flex items-center justify-center gap-4 mb-4">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/self-icon.png" alt="Self" width={56} height={56} className="rounded-xl" />
            <h1 className="text-5xl sm:text-6xl font-bold">
              <span className="text-gradient">Self Agent ID</span>
            </h1>
          </div>
          <p className="text-lg text-muted max-w-xl mx-auto mb-10">
            Register AI agents with on-chain proof-of-human verification via{" "}
            <a href="https://self.xyz" target="_blank" rel="noopener noreferrer" className="text-foreground hover:text-accent transition-colors underline underline-offset-2 whitespace-nowrap">Self Protocol</a>. Prove your agent is backed by a real, unique human.
          </p>

          <div className="flex flex-col sm:flex-row gap-3 justify-center">
            <Link
              href="/register"
              className="inline-flex items-center justify-center gap-2 px-6 py-3 rounded-lg font-medium bg-gradient-to-r from-accent to-accent-2 text-white hover:opacity-90 transition-all"
            >
              <Key size={18} />
              Register Agent
            </Link>
            <Link
              href="/my-agents"
              className="inline-flex items-center justify-center gap-2 px-6 py-3 rounded-lg font-medium bg-surface-2 border border-border text-foreground hover:border-border-strong transition-all"
            >
              <Cpu size={18} />
              My Agents
            </Link>
            <Link
              href="/verify"
              className="inline-flex items-center justify-center gap-2 px-6 py-3 rounded-lg font-medium bg-surface-2 border border-border text-foreground hover:border-border-strong transition-all"
            >
              <Search size={18} />
              Verify Agent
            </Link>
            <Link
              href="/explainer"
              className="inline-flex items-center justify-center gap-2 px-6 py-3 rounded-lg font-medium bg-surface-1 border border-border text-muted hover:text-foreground hover:border-border-strong transition-all"
            >
              <FileCode2 size={18} />
              How It Works
            </Link>
            <Link
              href="/erc8004"
              className="inline-flex items-center justify-center gap-2 px-6 py-3 rounded-lg font-medium bg-surface-1 border border-border text-muted hover:text-foreground hover:border-border-strong transition-all"
            >
              ERC-8004 Proposal
            </Link>
          </div>
        </div>

        {/* Orbital illustration (md+) */}
        <div className="hidden lg:block absolute top-1/2 right-[5%] -translate-y-1/2 w-[340px] h-[340px]">
          {/* Rings */}
          <div className="absolute inset-0 rounded-full border border-border opacity-40" />
          <div className="absolute inset-[25%] rounded-full border border-accent/30" />
          <div className="absolute inset-[45%] rounded-full border border-accent-2/30" />
          {/* Dots */}
          <div className="absolute top-0 left-1/2 -translate-x-1/2 -translate-y-1/2 flex flex-col items-center gap-1">
            <span className="w-3 h-3 rounded-full bg-accent-success" />
            <span className="text-[10px] text-muted">Human</span>
          </div>
          <div className="absolute top-1/2 right-0 translate-x-1/2 -translate-y-1/2 flex flex-col items-center gap-1">
            <span className="w-3 h-3 rounded-full bg-accent" />
            <span className="text-[10px] text-muted">ZK Proof</span>
          </div>
          <div className="absolute bottom-0 left-1/2 -translate-x-1/2 translate-y-1/2 flex flex-col items-center gap-1">
            <span className="w-3 h-3 rounded-full bg-accent-2" />
            <span className="text-[10px] text-muted">On-Chain</span>
          </div>
        </div>
      </section>

      {/* How It Works */}
      <section className="max-w-4xl mx-auto px-6 py-12">
        <h2 className="text-2xl font-bold text-center mb-10">How It Works</h2>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Agent Operators */}
          <Card>
            <h3 className="text-lg font-bold mb-1">For Agent Operators</h3>
            <p className="text-sm text-muted mb-5">
              Register your AI agent so services trust it
            </p>

            {/* Three modes */}
            <div className="space-y-3 mb-6">
              <div className="flex gap-3 p-3 rounded-lg bg-surface-2 border border-border">
                <Wallet size={18} className="text-accent flex-shrink-0 mt-0.5" />
                <div>
                  <p className="font-medium text-sm">Verified Wallet</p>
                  <p className="text-xs text-muted">Your wallet address is the agent identity. Simplest option for crypto-native users.</p>
                </div>
              </div>
              <div className="flex gap-3 p-3 rounded-lg bg-surface-2 border border-border">
                <Key size={18} className="text-accent flex-shrink-0 mt-0.5" />
                <div>
                  <p className="font-medium text-sm">Agent Identity</p>
                  <p className="text-xs text-muted">Agent gets its own keypair, separate from your wallet. Best for dedicated agent infrastructure.</p>
                </div>
              </div>
              <div className="flex gap-3 p-3 rounded-lg bg-surface-2 border border-border">
                <Smartphone size={18} className="text-accent-2 flex-shrink-0 mt-0.5" />
                <div>
                  <p className="font-medium text-sm">No Wallet Needed</p>
                  <p className="text-xs text-muted">No crypto wallet required. Just scan your passport with the Self app &mdash; an agent key is generated for you automatically.</p>
                </div>
              </div>
            </div>

            <ol className="space-y-4">
              {[
                {
                  title: "Choose your mode",
                  desc: "Pick from Verified Wallet, Agent Identity, or No Wallet. Non-crypto users can skip wallet setup entirely.",
                },
                {
                  title: "Connect wallet (if applicable)",
                  desc: "Wallet modes require connecting MetaMask or similar. No Wallet mode skips this step.",
                },
                {
                  title: "Scan with Self app",
                  desc: "Scan the QR code with the Self app. A ZK proof of your passport is generated — no personal data is shared.",
                },
                {
                  title: "Agent is registered",
                  desc: "An NFT is minted on-chain binding your agent key to a verified human. Save your credentials securely.",
                },
                {
                  title: "Agent signs requests",
                  desc: "Your agent uses the SDK to sign every outgoing request. Services verify the signature against the on-chain registry.",
                },
              ].map((step, i) => (
                <li key={i} className="flex gap-3">
                  <StepNumber n={i + 1} />
                  <div>
                    <p className="font-medium text-sm">{step.title}</p>
                    <p className="text-xs text-muted">{step.desc}</p>
                  </div>
                </li>
              ))}
            </ol>
          </Card>

          {/* Integration Partners */}
          <Card>
            <h3 className="text-lg font-bold mb-1">For Integration Partners</h3>
            <p className="text-sm text-muted mb-5">
              Verify that agents calling your service are human-backed
            </p>
            <ol className="space-y-4">
              {[
                {
                  title: "Install the SDK",
                  desc: (
                    <>
                      <code className="bg-surface-2 font-mono text-accent-2 px-1 rounded text-xs">
                        npm install @selfxyz/agent-sdk
                      </code>{" "}
                      — or use the on-chain registry directly.
                    </>
                  ),
                },
                {
                  title: "Add middleware",
                  desc: (
                    <>
                      One line for Express:{" "}
                      <code className="bg-surface-2 font-mono text-accent-2 px-1 rounded text-xs">
                        app.use(verifier.expressMiddleware())
                      </code>
                    </>
                  ),
                },
                {
                  title: "Requests are verified",
                  desc: (
                    <>
                      The SDK recovers the signer, derives the agent key, and checks{" "}
                      <code className="bg-surface-2 font-mono text-accent-2 px-1 rounded text-xs">
                        isVerifiedAgent()
                      </code>
                    </>
                  ),
                },
                {
                  title: "Sybil resistant by default",
                  desc: "One agent per human enforced automatically. Each passport generates a unique nullifier.",
                },
                {
                  title: "On-chain gating (optional)",
                  desc: (
                    <>
                      Smart contracts verify via{" "}
                      <code className="bg-surface-2 font-mono text-accent-2 px-1 rounded text-xs">
                        msg.sender
                      </code>
                      {" "}— add an{" "}
                      <code className="bg-surface-2 font-mono text-accent-2 px-1 rounded text-xs">
                        onlyVerifiedAgent
                      </code>{" "}
                      modifier.
                    </>
                  ),
                },
              ].map((step, i) => (
                <li key={i} className="flex gap-3">
                  <StepNumber n={i + 1} />
                  <div>
                    <p className="font-medium text-sm">{step.title}</p>
                    <p className="text-xs text-muted">{step.desc}</p>
                  </div>
                </li>
              ))}
            </ol>
          </Card>
        </div>

        {/* Verification Flow */}
        <Card className="mt-8">
          <h3 className="text-xs font-bold text-center mb-4 text-muted uppercase tracking-widest">
            Verification Flow
          </h3>
          <div className="flex flex-col sm:flex-row items-center justify-center gap-3 text-sm">
            {[
              { icon: Key, label: "Agent signs request", variant: "default" as const },
              { icon: ShieldCheck, label: "Service recovers signer", variant: "default" as const },
              { icon: Search, label: "Checks on-chain registry", variant: "default" as const },
              { icon: CheckCircle2, label: "Verified human-backed", variant: "success" as const },
            ].map((step, i) => (
              <div key={i} className="flex items-center gap-3">
                {i > 0 && (
                  <ArrowRight
                    size={16}
                    className="text-subtle hidden sm:block"
                  />
                )}
                {i > 0 && (
                  <ArrowRight
                    size={16}
                    className="text-subtle sm:hidden rotate-90"
                  />
                )}
                <div
                  className={`flex items-center gap-2 px-4 py-2 rounded-lg border font-medium ${
                    step.variant === "success"
                      ? "border-accent-success/30 bg-accent-success/5 text-accent-success"
                      : "border-border bg-surface-2 text-foreground"
                  }`}
                >
                  <step.icon size={16} />
                  {step.label}
                </div>
              </div>
            ))}
          </div>
        </Card>
      </section>

    </main>
  );
}
