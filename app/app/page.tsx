"use client";

import Link from "next/link";
import {
  ArrowRight,
  Shield,
  Fingerprint,
  Layers,
  BookOpen,
  ScanLine,
  Bot,
  Zap,
  UserCheck,
  CalendarCheck,
  ShieldOff,
  Users,
  Globe,
  BadgeCheck,
  ExternalLink,
  Code2,
} from "lucide-react";
import { Card } from "@/components/Card";
import { Badge } from "@/components/Badge";
import { Button } from "@/components/Button";

export default function Home() {
  return (
    <main className="min-h-screen">
      {/* ────────────── Hero ────────────── */}
      <section className="relative overflow-hidden hero-glow bg-grid">
        <div className="relative z-10 flex flex-col items-center justify-center text-center px-6 pt-32 pb-20 md:pb-28">
          <Badge variant="info" className="mb-4">
            Trusted Identity for AI Agents
          </Badge>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/self-icon.png"
            alt="Self"
            width={64}
            height={64}
            className="rounded-xl mb-4"
          />
          <h1 className="text-4xl sm:text-5xl font-bold tracking-tight text-foreground mb-6">
            Give Your AI Agent a{" "}
            <span className="text-gradient">Verified Identity</span>
          </h1>
          <p className="text-lg text-muted max-w-2xl mb-10">
            Your agents book travel, manage finances, and negotiate on your
            behalf. But how does anyone know there&apos;s a real person behind
            them? Self Agent ID lets agents prove they&apos;re human-backed,
            privately and instantly. No personal data shared. Ever.
          </p>
          <div className="flex flex-col sm:flex-row gap-3">
            <Link href="/register">
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
      </section>

      {/* ────────────── The Trust Gap ────────────── */}
      <section className="bg-surface-1 px-6 py-20">
        <div className="max-w-3xl mx-auto text-center">
          <h2 className="text-3xl font-bold mb-6">The Trust Gap</h2>
          <div className="text-lg text-muted leading-relaxed space-y-4">
            <p>
              AI agents are becoming autonomous participants: booking flights,
              managing money, accessing services on your behalf. But every
              platform they interact with faces the same question:{" "}
              <strong className="text-foreground">
                &ldquo;Is there a real person behind this agent?&rdquo;
              </strong>
            </p>
            <p>
              Without a universal answer, every service builds its own
              verification. Fragmented. Expensive. Easy to game. Self Agent ID
              gives agents a portable, verified identity that any service can
              check instantly, without knowing who the human is.
            </p>
          </div>
        </div>
      </section>

      {/* ────────────── How It Works ────────────── */}
      <section className="px-6 py-20">
        <div className="max-w-4xl mx-auto">
          <h2 className="text-3xl font-bold text-center mb-12">
            How It Works
          </h2>

          <div className="flex flex-col md:flex-row items-center justify-center gap-3 md:gap-6">
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
              <div key={i} className="flex flex-col md:flex-row items-center gap-3 md:gap-6">
                {i > 0 && (
                  <ArrowRight
                    size={20}
                    className="text-subtle hidden md:block flex-shrink-0"
                  />
                )}
                {i > 0 && (
                  <ArrowRight
                    size={20}
                    className="text-subtle md:hidden rotate-90 flex-shrink-0"
                  />
                )}
                <Card glow className="flex flex-col items-center text-center max-w-xs">
                  <div className="w-12 h-12 rounded-full bg-accent/10 flex items-center justify-center mb-4">
                    <step.icon size={24} className="text-accent" />
                  </div>
                  <h3 className="font-bold mb-2">{step.title}</h3>
                  <p className="text-sm text-muted leading-relaxed">
                    {step.desc}
                  </p>
                </Card>
              </div>
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
      <section className="bg-surface-1 px-6 py-20">
        <div className="max-w-4xl mx-auto">
          <div className="flex items-center justify-center gap-2 mb-4">
            <Code2 size={20} className="text-accent" />
            <h2 className="text-3xl font-bold">Integrate in Minutes</h2>
          </div>
          <p className="text-center text-muted mb-10 max-w-xl mx-auto">
            Add agent verification to your service with a few lines of code.
            SDKs available for TypeScript, Python, and Rust.
          </p>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <Card>
              <h3 className="font-bold text-sm mb-1">Verify Agents</h3>
              <p className="text-xs text-muted mb-4">
                Add middleware to verify incoming agent requests
              </p>
              <pre className="bg-surface-2 border border-border rounded-lg p-4 text-xs overflow-auto font-mono">
{`import { SelfAgentVerifier } from
  "@selfxyz/agent-sdk";

const verifier = new SelfAgentVerifier({
  rpcUrl: "https://forno.celo.org",
});

// One line of middleware
app.use(verifier.auth());`}
              </pre>
            </Card>
            <Card>
              <h3 className="font-bold text-sm mb-1">Sign Requests</h3>
              <p className="text-xs text-muted mb-4">
                Authenticate your agent with any service
              </p>
              <pre className="bg-surface-2 border border-border rounded-lg p-4 text-xs overflow-auto font-mono">
{`import { SelfAgentClient } from
  "@selfxyz/agent-sdk";

const agent = new SelfAgentClient({
  privateKey: process.env.AGENT_KEY,
});

// Requests are signed automatically
const res = await agent.fetch(url);`}
              </pre>
            </Card>
          </div>

          <div className="flex justify-center mt-8">
            <Link href="/explainer">
              <Button variant="secondary">
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
            <Link href="/register">
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
