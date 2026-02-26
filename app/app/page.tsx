// SPDX-FileCopyrightText: 2025-2026 Social Connect Labs, Inc.
// SPDX-License-Identifier: BUSL-1.1
// NOTE: Converts to Apache-2.0 on 2029-06-11 per LICENSE.

"use client";

import React from "react";
import Link from "next/link";
import dynamic from "next/dynamic";
import {
  Key,
  ArrowRight,
  Shield,
  Code2,
  BookOpen,
  Cpu,
  Bot,
  ExternalLink,
  ScanLine,
  Zap,
  UserCheck,
  CalendarCheck,
  ShieldOff,
  Users,
  Globe,
  BadgeCheck,
  Fingerprint,
  Layers,
  MessageCircle,
  Repeat2,
  Heart,
  Bookmark,
} from "lucide-react";
import { Card } from "@/components/Card";
import { Badge } from "@/components/Badge";
import { Button } from "@/components/Button";
import CodeBlock from "@/components/CodeBlock";

const Lottie = dynamic(() => import("lottie-react"), { ssr: false });

import { useState, useEffect } from "react";

export default function Home() {
  const [animationData, setAnimationData] = useState<object | null>(null);
  const trustGapTweetUrl = "https://x.com/galnagli/status/2017585025475092585";

  useEffect(() => {
    fetch("/lottie_agents.json")
      .then((res) => res.json())
      .then(setAnimationData);
  }, []);

  const openTrustGapTweet = () => {
    window.open(trustGapTweetUrl, "_blank", "noopener,noreferrer");
  };

  return (
    <main className="min-h-screen">
      {/* ────────────── Hero ────────────── */}
      <section className="relative overflow-hidden hero-glow bg-grid">
        <div className="relative z-10 max-w-6xl mx-auto px-6 pt-28 pb-16 md:pt-36 md:pb-20">
          <div className="flex flex-col md:flex-row items-center gap-10 md:gap-16">
            {/* Left: text content */}
            <div className="flex-1 flex flex-col items-start text-left">
              <Badge variant="info" className="mb-5">
                Trusted Identity for AI Agents
              </Badge>
              <h1 className="text-4xl sm:text-5xl lg:text-6xl font-bold tracking-tight text-foreground mb-6 leading-[1.1]">
                Give Your AI Agent a{" "}
                <span className="text-gradient">Verified Identity</span>
              </h1>
              <div className="flex flex-col gap-4 max-w-xl mb-8">
                <div className="flex items-start gap-3">
                  <span className="w-8 h-8 rounded-full bg-accent-2/10 flex items-center justify-center flex-shrink-0 mt-0.5">
                    <Bot size={16} className="text-accent-2" />
                  </span>
                  <p className="text-base text-muted leading-relaxed">
                    Your agents book travel, manage finances, and negotiate on your behalf.
                  </p>
                </div>
                <div className="flex items-start gap-3">
                  <span className="w-8 h-8 rounded-full bg-accent-warn/10 flex items-center justify-center flex-shrink-0 mt-0.5">
                    <Shield size={16} className="text-accent-warn" />
                  </span>
                  <p className="text-base text-foreground font-medium leading-relaxed">
                    But how does anyone know there&apos;s a real person behind them?
                  </p>
                </div>
                <div className="flex items-start gap-3">
                  <span className="w-8 h-8 rounded-full bg-accent-success/10 flex items-center justify-center flex-shrink-0 mt-0.5">
                    <Fingerprint size={16} className="text-accent-success" />
                  </span>
                  <p className="text-base text-muted leading-relaxed">
                    Self Agent ID lets agents prove they&apos;re human-backed, privately and instantly. <strong className="text-foreground">No personal data shared. Ever.</strong>
                  </p>
                </div>
              </div>
              <div className="flex flex-col sm:flex-row gap-3 mb-8">
                <Link href="/agents/register">
                  <Button variant="primary" size="lg">
                    Register Your Agent
                  </Button>
                </Link>
                <Link href="/explainer">
                  <Button variant="secondary" size="lg">
                    How It Works
                  </Button>
                </Link>
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

            {/* Right: Lottie animation */}
            <div className="flex-1 relative max-w-2xl md:max-w-3xl w-full">
              <div className="absolute inset-0 bg-gradient-to-br from-accent/5 via-accent-2/5 to-transparent rounded-3xl -m-4" />
              {animationData ? (
                <div className="relative pointer-events-none origin-center scale-[2]" style={{ maskImage: "radial-gradient(ellipse 85% 85% at 50% 50%, black 60%, transparent 100%)", WebkitMaskImage: "radial-gradient(ellipse 85% 85% at 50% 50%, black 60%, transparent 100%)" }}>
                  <Lottie animationData={animationData} loop autoplay />
                </div>
              ) : (
                /* Fallback: show the icon while animation loads */
                <div className="flex items-center justify-center py-16">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src="/self-icon.png"
                    alt="Self"
                    width={80}
                    height={80}
                    className="rounded-2xl opacity-60"
                  />
                </div>
              )}
            </div>
          </div>
        </div>
      </section>

      {/* ────────────── The Trust Gap ────────────── */}
      <section className="bg-surface-1 px-6 py-20">
        <div className="max-w-2xl mx-auto">
          <h2 className="text-3xl font-bold text-center mb-10">The Trust Gap</h2>

          {/* Tweet quote card */}
          <div
            role="link"
            tabIndex={0}
            onClick={openTrustGapTweet}
            onKeyDown={(e) => {
              if (
                e.target === e.currentTarget &&
                (e.key === "Enter" || e.key === " ")
              ) {
                e.preventDefault();
                openTrustGapTweet();
              }
            }}
            aria-label="Open referenced X post in a new tab"
            className="block cursor-pointer rounded-xl focus:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface-1"
          >
            <Card glow className="relative border-accent-warn/20 bg-white hover:border-accent-warn/40 transition-colors">
              <div className="absolute top-4 right-4 text-subtle">
                <ExternalLink size={14} />
              </div>

              {/* Author */}
              <div className="flex items-center gap-3 mb-4">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src="/profile_picture.jpg"
                  alt="Gal Nagli"
                  width={44}
                  height={44}
                  className="rounded-full"
                />
                <div>
                  <p className="text-sm font-bold text-foreground">Gal Nagli</p>
                  <p className="text-xs text-subtle">@galnagli</p>
                </div>
              </div>

              {/* Tweet text */}
              <blockquote className="text-lg text-foreground leading-relaxed mb-4">
                The number of registered AI agents is also fake, there is no rate limiting on account creation, my <a href="https://x.com/openclaw" target="_blank" rel="noopener noreferrer" className="text-accent-2 hover:underline" onClick={(e) => e.stopPropagation()}>@openclaw</a> agent just registered <strong className="text-accent-warn">500,000 users</strong> on <a href="https://x.com/moltbook" target="_blank" rel="noopener noreferrer" className="text-accent-2 hover:underline" onClick={(e) => e.stopPropagation()}>@moltbook</a> - don&apos;t trust all the media hype 🙂
              </blockquote>

              {/* Embedded media */}
              <div className="grid grid-cols-2 gap-1 rounded-xl overflow-hidden mb-4" onClick={(e) => e.stopPropagation()}>
                {/* Video */}
                <video
                  src="/video.mp4"
                  controls
                  muted
                  playsInline
                  preload="metadata"
                  className="w-full h-full object-cover aspect-square"
                />
                {/* Screenshot */}
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src="/screen.jpeg"
                  alt="Moltbook showing 634,737 AI agents registered"
                  className="w-full h-full object-cover aspect-square"
                />
              </div>

              {/* Engagement stats */}
              <div className="flex items-center gap-8 text-subtle text-sm font-medium">
                <span className="flex items-center gap-2">
                  <MessageCircle size={20} />
                  368
                </span>
                <span className="flex items-center gap-2">
                  <Repeat2 size={20} />
                  830
                </span>
                <span className="flex items-center gap-2 text-red-500">
                  <Heart size={20} className="fill-red-500" />
                  5.4K
                </span>
                <span className="flex items-center gap-2">
                  <Bookmark size={20} />
                  1.1K
                </span>
              </div>
            </Card>
          </div>

          <p className="text-center text-muted mt-8 max-w-lg mx-auto leading-relaxed">
            Self Agent ID makes this impossible. One identity per person. Verified on-chain. <strong className="text-foreground">Sybil-resistant by design.</strong>
          </p>
        </div>
      </section>

      {/* ────────────── How It Works ────────────── */}
      <section className="px-6 py-20">
        <div className="max-w-4xl mx-auto">
          <h2 className="text-3xl font-bold text-center mb-12">
            How It Works
          </h2>

          <div className="grid grid-cols-1 md:grid-cols-[1fr_auto_1fr_auto_1fr] items-stretch gap-4 md:gap-0">
            {[
              {
                icon: ScanLine,
                title: "Scan an Identity Document",
                desc: "Open the Self app and scan the QR code. A cryptographic proof is generated on your phone. No personal data leaves your device.",
              },
              {
                icon: Bot,
                title: "Your Agent Gets an Identity",
                desc: "A verified identity is created that links your agent to a real human. You stay completely anonymous. You choose exactly which credentials your agent can carry.",
              },
              {
                icon: Zap,
                title: "Services Verify Instantly",
                desc: "Any service can check your agent's identity with a single API call. No extra setup needed.",
              },
            ].map((step, i) => (
              <React.Fragment key={i}>
                {i > 0 && (
                  <div className="hidden md:flex items-center justify-center px-2">
                    <ArrowRight size={20} className="text-subtle flex-shrink-0" />
                  </div>
                )}
                {i > 0 && (
                  <div className="flex md:hidden items-center justify-center">
                    <ArrowRight size={20} className="text-subtle rotate-90" />
                  </div>
                )}
                <Card glow className="flex flex-col items-center text-center h-full">
                  <div className="w-20 h-20 rounded-full bg-accent/10 flex items-center justify-center mb-4">
                    <step.icon size={40} className="text-accent" />
                  </div>
                  <h3 className="font-bold mb-2">{step.title}</h3>
                  <p className="text-sm text-muted leading-relaxed">
                    {step.desc}
                  </p>
                </Card>
              </React.Fragment>
            ))}
          </div>
        </div>
      </section>

      {/* ─── Who Is It For ─── */}
      <section className="bg-surface-1 px-6 py-16">
        <div className="max-w-4xl mx-auto">
          <h2 className="text-3xl font-bold text-center mb-10">Who Is It For</h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {[
              {
                icon: Cpu,
                iconColor: "text-accent",
                bgColor: "bg-accent/20",
                title: "Agent Operators",
                desc: "Register your AI agent with a passport scan. Choose from four modes \u2014 wallet-based, agent keypair, wallet-free, or passkey smart wallet. Your agent gets a soulbound NFT and an A2A-compatible identity card that any service can verify instantly.",
                btnIcon: Key,
                btnLabel: "Register Agent",
                btnVariant: "primary" as const,
                href: "/agents/register",
              },
              {
                icon: Code2,
                iconColor: "text-accent-2",
                bgColor: "bg-accent-2/20",
                title: "Service Developers",
                desc: "Add one line of middleware to verify agents are human-backed. The SDK recovers the signer from ECDSA signatures and checks the on-chain registry \u2014 with configurable sybil limits, credential checks, and reputation-based access control.",
                btnIcon: Code2,
                btnLabel: "Integration Guide",
                btnVariant: "secondary" as const,
                href: "/integration",
              },
              {
                icon: Bot,
                iconColor: "text-purple-400",
                bgColor: "bg-purple-500/20",
                title: "AI Coding Assistants",
                desc: "Use the MCP server or Claude Code plugin to manage agent identity directly from your IDE. Register, sign requests, verify agents, and query credentials \u2014 10 tools that work in any MCP-compatible IDE (Claude Code, Cursor, Windsurf, Copilot, and more).",
                btnIcon: Bot,
                btnLabel: "MCP & Plugin",
                btnVariant: "secondary" as const,
                href: "/integration#mcp",
              },
            ].map((item) => (
              <Card key={item.title} className="flex flex-col h-full">
                <div className="flex items-center gap-3 mb-4">
                  <span className={`w-12 h-12 rounded-full ${item.bgColor} flex items-center justify-center flex-shrink-0`}>
                    <item.icon size={24} className={item.iconColor} />
                  </span>
                  <h3 className="font-bold text-lg">{item.title}</h3>
                </div>
                <p className="text-sm text-muted mb-6 flex-1">
                  {item.desc}
                </p>
                <Link href={item.href}>
                  <Button variant={item.btnVariant} size="sm">
                    <item.btnIcon size={14} />
                    {item.btnLabel}
                  </Button>
                </Link>
              </Card>
            ))}
          </div>
        </div>
      </section>

      {/* ────────────── What Your Agent Can Prove ────────────── */}
      <section className="bg-surface-1 px-6 py-20">
        <div className="max-w-4xl mx-auto">
          <h2 className="text-3xl font-bold text-center mb-4">
            What Your Agent Can Prove
          </h2>
          <p className="text-center text-muted max-w-2xl mx-auto mb-12">
            You decide what your agent can share. Nothing more. Even if your
            agent is compromised, only the credentials you explicitly granted
            can ever be accessed.
          </p>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {[
              {
                icon: UserCheck,
                title: "Backed by a Real Human",
                desc: "Prove your agent is operated by a verified person, not a bot or script.",
                variant: "success" as const,
              },
              {
                icon: CalendarCheck,
                title: "Operator is Over 18",
                desc: "Age-gated services can verify your agent's operator meets the requirement.",
                variant: "info" as const,
              },
              {
                icon: ShieldOff,
                title: "Not on Sanctions Lists",
                desc: "Services can check OFAC compliance without accessing your personal data.",
                variant: "info" as const,
              },
              {
                icon: Users,
                title: "One Human, One Agent",
                desc: "Prevent one person from registering unlimited agents. Sybil resistance built in.",
                variant: "info" as const,
              },
              {
                icon: Globe,
                title: "Nationality Verified",
                desc: "Optionally prove your nationality without revealing your name or identity.",
                variant: "muted" as const,
              },
              {
                icon: BadgeCheck,
                title: "Name Verified",
                desc: "Optionally share your verified name when services require it.",
                variant: "muted" as const,
              },
            ].map((cred) => (
              <Card key={cred.title} glow>
                <div className="flex items-center gap-3 mb-3">
                  <div
                    className={`w-9 h-9 rounded-full flex items-center justify-center ${
                      cred.variant === "success"
                        ? "bg-accent-success/10"
                        : cred.variant === "info"
                          ? "bg-accent-2/10"
                          : "bg-surface-2"
                    }`}
                  >
                    <cred.icon
                      size={18}
                      className={
                        cred.variant === "success"
                          ? "text-accent-success"
                          : cred.variant === "info"
                            ? "text-accent-2"
                            : "text-muted"
                      }
                    />
                  </div>
                  <h3 className="font-bold text-sm">{cred.title}</h3>
                </div>
                <p className="text-sm text-muted leading-relaxed">
                  {cred.desc}
                </p>
              </Card>
            ))}
          </div>

          <p className="text-center text-sm text-muted mt-8 max-w-xl mx-auto">
            All credentials are generated from a zero-knowledge proof. Your
            identity document data never leaves your phone. Your agent only
            knows what you allow it to know.
          </p>
        </div>
      </section>

      {/* ────────────── Properties ────────────── */}
      <section className="px-6 py-20">
        <div className="max-w-4xl mx-auto">
          <h2 className="text-3xl font-bold text-center mb-12">
            Built for Trust at Scale
          </h2>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
            {[
              {
                icon: Shield,
                title: "Private",
                desc: "Zero-knowledge proofs reveal nothing about your identity. Only a proof of verification is stored.",
              },
              {
                icon: Fingerprint,
                title: "Sybil-Resistant",
                desc: "Each identity document maps to a unique identifier. One person can't register unlimited agents.",
              },
              {
                icon: Layers,
                title: "Composable",
                desc: "A single API call integrates into any backend, service, or agent framework.",
              },
              {
                icon: BookOpen,
                title: "Open Standard",
                desc: "Built as an extension to ERC-8004, the emerging standard for agent registries.",
              },
            ].map((prop) => (
              <Card key={prop.title} glow>
                <prop.icon size={20} className="text-accent mb-3" />
                <h3 className="font-bold mb-2">{prop.title}</h3>
                <p className="text-sm text-muted leading-relaxed">
                  {prop.desc}
                </p>
              </Card>
            ))}
          </div>
        </div>
      </section>

      {/* ────────────── For Developers ────────────── */}
      <section className="dark-section px-6 py-20">
        <div className="max-w-4xl mx-auto">
          <div className="flex items-center justify-center gap-2 mb-4">
            <Code2 size={20} className="text-accent" />
            <h2 className="text-3xl font-bold">Integrate in Minutes</h2>
          </div>
          <p className="text-center text-muted mb-6 max-w-xl mx-auto">
            Add agent verification to your service with a few lines of code.
            SDKs available for TypeScript, Python, and Rust. Building with AI agents?
            Use the MCP server to give your agent identity directly from your IDE.
          </p>

          {/* Package badges */}
          <div className="flex gap-2 flex-wrap justify-center mb-10">
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

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <Card>
              <h3 className="font-bold text-sm mb-1">Verify Agents</h3>
              <p className="text-xs text-muted mb-4">
                Add middleware to verify incoming agent requests
              </p>
              <CodeBlock
                tabs={[
                  {
                    label: "TypeScript",
                    language: "typescript",
                    code: `import { SelfAgentVerifier } from "@selfxyz/agent-sdk";

const verifier = SelfAgentVerifier.create()
  .requireAge(18)
  .requireOFAC()
  .build();

// One line of middleware
app.use(verifier.auth());`,
                  },
                ]}
              />
            </Card>
            <Card>
              <h3 className="font-bold text-sm mb-1">Sign Requests</h3>
              <p className="text-xs text-muted mb-4">
                Authenticate your agent with any service
              </p>
              <CodeBlock
                tabs={[
                  {
                    label: "TypeScript",
                    language: "typescript",
                    code: `import { SelfAgentClient } from "@selfxyz/agent-sdk";

const agent = new SelfAgentClient({
  privateKey: process.env.AGENT_KEY,
});

// Requests are signed automatically
const res = await agent.fetch(url);`,
                  },
                ]}
              />
            </Card>
          </div>

          <div className="flex justify-center mt-8">
            <Link href="/integration">
              <Button variant="primary">
                See the full integration guide <ArrowRight size={14} />
              </Button>
            </Link>
          </div>
        </div>
      </section>

      {/* ────────────── Bottom CTA ────────────── */}
      <section className="px-6 py-20">
        <div className="max-w-2xl mx-auto text-center">
          <h2 className="text-3xl font-bold mb-4">
            Ready to Give Your Agent an Identity?
          </h2>
          <p className="text-muted mb-8">
            Register your first agent in minutes. No personal data required.
          </p>
          <div className="flex flex-col sm:flex-row justify-center gap-3">
            <Link href="/agents/register">
              <Button variant="primary" size="lg">
                Register Your Agent
              </Button>
            </Link>
            <Link href="/explainer">
              <Button variant="secondary" size="lg">
                Read the Docs
              </Button>
            </Link>
          </div>
        </div>
      </section>
    </main>
  );
}
