"use client";

import { useState, useEffect } from "react";
import MatrixRain from "@/components/MatrixRain";
import MatrixText from "@/components/MatrixText";
import Link from "next/link";
import {
  Key,
  ShieldCheck,
  ArrowRight,
  Shield,
  Ban,
  Code2,
  BookOpen,
  Cpu,
  Handshake,
  FileCheck,
  Bot,
} from "lucide-react";
import { Card } from "@/components/Card";
import { Badge } from "@/components/Badge";
import { Button } from "@/components/Button";

export default function Home() {
  const [showIntro, setShowIntro] = useState(false);

  useEffect(() => {
    if (!sessionStorage.getItem("matrix-intro-shown")) {
      setShowIntro(true);
      sessionStorage.setItem("matrix-intro-shown", "1");
    }
  }, []);

  return (
    <main className="min-h-screen">
      {showIntro && <MatrixRain duration={2000} fadeOut={2000} speed={1} maxOpacity={1} />}

      {/* ─── Hero ─── */}
      <section className="relative overflow-hidden hero-glow bg-grid">
        <div className="relative z-10 max-w-4xl mx-auto px-6 pt-28 pb-14 text-center">
          <Badge variant="info" className="mb-6">
            Proof-of-Human for AI Agents
          </Badge>
          <div className="flex items-center justify-center mb-4">
            <MatrixText text="Self Agent ID" fontSize={110} />
          </div>
          <p className="text-lg text-muted max-w-2xl mx-auto mb-8">
            An on-chain registry that proves AI agents are backed by real, unique humans &mdash;
            using zero-knowledge passport verification via{" "}
            <a href="https://self.xyz" target="_blank" rel="noopener noreferrer" className="text-foreground hover:text-accent transition-colors underline underline-offset-2 whitespace-nowrap">Self Protocol</a>.
            {" "}Privacy-preserving, sybil-resistant, and composable across any EVM chain or backend service.
          </p>

          <div className="flex flex-col sm:flex-row gap-3 justify-center">
            <Link href="/register">
              <Button variant="primary" size="lg">
                <Key size={18} />
                Register Agent
              </Button>
            </Link>
            <Link href="/integration">
              <Button variant="secondary" size="lg">
                <Code2 size={18} />
                Integration Guide
              </Button>
            </Link>
            <Link href="/explainer">
              <Button variant="ghost" size="lg">
                <BookOpen size={18} />
                How It Works
              </Button>
            </Link>
          </div>

          {/* Package badges */}
          <div className="flex gap-2 flex-wrap justify-center mt-6">
            <code className="bg-surface-2 font-mono text-emerald-400 px-2.5 py-0.5 rounded text-xs">
              npm · @selfxyz/agent-sdk
            </code>
            <code className="bg-surface-2 font-mono text-blue-400 px-2.5 py-0.5 rounded text-xs">
              pip · selfxyz-agent-sdk
            </code>
            <code className="bg-surface-2 font-mono text-orange-400 px-2.5 py-0.5 rounded text-xs">
              cargo · self-agent-sdk
            </code>
            <code className="bg-surface-2 font-mono text-purple-400 px-2.5 py-0.5 rounded text-xs">
              mcp · @selfxyz/mcp-server
            </code>
          </div>
        </div>

        {/* Orbital illustration (lg+) */}
        <div className="hidden lg:block absolute top-1/2 right-[5%] -translate-y-1/2 w-[340px] h-[340px]">
          <div className="absolute inset-0 rounded-full border border-border opacity-40" />
          <div className="absolute inset-[25%] rounded-full border border-accent/30" />
          <div className="absolute inset-[45%] rounded-full border border-accent-2/30" />
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

      {/* ─── The Problem ─── */}
      <section className="bg-surface-1 px-6 py-12">
        <div className="max-w-3xl mx-auto text-center">
          <p className="text-lg text-muted leading-relaxed">
            AI agents are becoming autonomous participants &mdash; booking travel, managing finances,
            negotiating on our behalf. Every service they touch faces the same question:{" "}
            <strong className="text-foreground">&ldquo;Is this agent backed by a real person,
            or is it part of a bot farm?&rdquo;</strong>{" "}
            Self Agent ID gives agents a portable, privacy-preserving credential that any service,
            agent, or smart contract can verify instantly.
          </p>
        </div>
      </section>

      {/* ─── Verification Capabilities ─── */}
      <section className="max-w-4xl mx-auto px-6 py-12">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
          <Card glow>
            <Shield size={20} className="text-accent mb-2" />
            <h3 className="font-bold mb-2">Verify Agents Are Human</h3>
            <p className="text-sm text-muted leading-relaxed">
              Services call one function to check if an agent is backed by a real passport holder.
              ZK proofs confirm humanity without revealing any personal data.
            </p>
          </Card>
          <Card glow>
            <Ban size={20} className="text-accent mb-2" />
            <h3 className="font-bold mb-2">Gate by Age or Sanctions</h3>
            <p className="text-sm text-muted leading-relaxed">
              Require agents to be 18+, 21+, or OFAC-cleared. Six verification configs combine age thresholds
              with sanctions screening &mdash; all ZK-attested from passport data.
            </p>
          </Card>
          <Card glow>
            <Handshake size={20} className="text-accent mb-2" />
            <h3 className="font-bold mb-2">Agent-to-Agent Trust</h3>
            <p className="text-sm text-muted leading-relaxed">
              Agents verify each other before collaborating. The SDK checks the counterparty&apos;s
              on-chain registration, credentials, and sybil status in a single call.
            </p>
          </Card>
          <Card glow>
            <FileCheck size={20} className="text-accent mb-2" />
            <h3 className="font-bold mb-2">On-Chain Contract Gating</h3>
            <p className="text-sm text-muted leading-relaxed">
              Smart contracts call the registry directly to gate functions behind verified agents.
              Check humanity, age, OFAC status, or reputation score &mdash; all on-chain.
            </p>
          </Card>
        </div>
      </section>

      {/* ─── Who Is It For ─── */}
      <section className="bg-surface-1 px-6 py-16">
        <div className="max-w-4xl mx-auto">
          <h2 className="text-3xl font-bold text-center mb-10">Who Is It For</h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <Card>
              <div className="flex items-center gap-2 mb-3">
                <span className="w-8 h-8 rounded-full bg-accent/20 flex items-center justify-center">
                  <Cpu size={16} className="text-accent" />
                </span>
                <h3 className="font-bold text-lg">Agent Operators</h3>
              </div>
              <p className="text-sm text-muted mb-4">
                Register your AI agent with a passport scan. Choose from four modes &mdash;
                wallet-based, agent keypair, wallet-free, or passkey smart wallet.
                Your agent gets a soulbound NFT and an A2A-compatible identity card
                that any service can verify instantly.
              </p>
              <Link href="/register">
                <Button variant="primary" size="sm">
                  <Key size={14} />
                  Register Agent
                </Button>
              </Link>
            </Card>

            <Card>
              <div className="flex items-center gap-2 mb-3">
                <span className="w-8 h-8 rounded-full bg-accent-2/20 flex items-center justify-center">
                  <Code2 size={16} className="text-accent-2" />
                </span>
                <h3 className="font-bold text-lg">Service Developers</h3>
              </div>
              <p className="text-sm text-muted mb-4">
                Add one line of middleware to verify agents are human-backed.
                The SDK recovers the signer from ECDSA signatures and checks the on-chain
                registry &mdash; with configurable sybil limits, credential checks,
                and reputation-based access control.
              </p>
              <Link href="/integration">
                <Button variant="secondary" size="sm">
                  <Code2 size={14} />
                  Integration Guide
                </Button>
              </Link>
            </Card>

            <Card>
              <div className="flex items-center gap-2 mb-3">
                <span className="w-8 h-8 rounded-full bg-purple-500/20 flex items-center justify-center">
                  <Bot size={16} className="text-purple-400" />
                </span>
                <h3 className="font-bold text-lg">AI Coding Assistants</h3>
              </div>
              <p className="text-sm text-muted mb-4">
                Use the MCP server or Claude Code plugin to manage agent identity directly
                from your IDE. Register, sign requests, verify agents, and query credentials
                &mdash; 10 tools that work in any MCP-compatible IDE (Claude Code, Cursor, Windsurf, Copilot, and more).
              </p>
              <Link href="/integration#mcp">
                <Button variant="secondary" size="sm">
                  <Bot size={14} />
                  MCP &amp; Plugin
                </Button>
              </Link>
            </Card>
          </div>
        </div>
      </section>

      {/* ─── How It Works (compact) ─── */}
      <section className="max-w-4xl mx-auto px-6 py-16">
        <h2 className="text-3xl font-bold text-center mb-3">How It Works</h2>
        <p className="text-sm text-muted text-center mb-8 max-w-lg mx-auto">
          A human registers once. Every request from their agent is verified in four steps.
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
          {[
            { step: "1", icon: Key, title: "Agent Signs", desc: "Agent attaches ECDSA signature to every request" },
            { step: "2", icon: ShieldCheck, title: "Service Checks", desc: "Service recovers the signer address from the signature" },
            { step: "3", icon: ArrowRight, title: "Registry Lookup", desc: "On-chain registry confirms the agent is verified" },
            { step: "4", icon: ShieldCheck, title: "Access Granted", desc: "Credentials checked, sybil limits enforced, request proceeds" },
          ].map((item) => (
            <div key={item.step} className="text-center">
              <div className="w-10 h-10 rounded-full bg-accent/10 border border-accent/30 flex items-center justify-center mx-auto mb-3">
                <span className="text-sm font-bold text-accent">{item.step}</span>
              </div>
              <h3 className="font-bold text-sm mb-1">{item.title}</h3>
              <p className="text-xs text-muted leading-relaxed">{item.desc}</p>
            </div>
          ))}
        </div>
        <div className="text-center mt-8">
          <Link href="/explainer" className="text-sm text-accent hover:text-accent-2 transition-colors underline underline-offset-2">
            Deep dive into the full architecture &rarr;
          </Link>
        </div>
      </section>
    </main>
  );
}
