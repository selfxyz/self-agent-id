"use client";

import { useState, useMemo } from "react";
import Link from "next/link";
import MatrixText from "@/components/MatrixText";
import {
  Code2,
  Cpu,
  Terminal,
} from "lucide-react";
import CodeBlock from "@/components/CodeBlock";
import { getServiceSnippets, getAgentSnippets, SERVICE_FEATURES, AGENT_FEATURES } from "@/lib/snippets";
import { useNetwork } from "@/lib/NetworkContext";
import { Card } from "@/components/Card";
import { Button } from "@/components/Button";

export default function IntegrationPage() {
  const { network } = useNetwork();
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

  return (
    <main className="min-h-screen">
      {/* Hero */}
      <section className="px-6 pt-32 pb-16">
        <div className="max-w-4xl mx-auto text-center">
          <div className="flex justify-center mb-6">
            <MatrixText text="Integration Guide" fontSize={48} />
          </div>
          <p className="text-lg text-muted max-w-2xl mx-auto mb-6">
            Everything you need to verify agents in your service, authenticate your agent
            with other services, or register agents from the terminal.
          </p>
          <div className="flex gap-3 flex-wrap justify-center">
            <code className="bg-surface-2 font-mono text-accent-2 px-3 py-1.5 rounded text-xs">
              npm install @selfxyz/agent-sdk
            </code>
            <code className="bg-surface-2 font-mono text-accent-2 px-3 py-1.5 rounded text-xs">
              pip install selfxyz-agent-sdk
            </code>
            <code className="bg-surface-2 font-mono text-accent-2 px-3 py-1.5 rounded text-xs">
              cargo add self-agent-sdk
            </code>
          </div>
        </div>
      </section>

      {/* Service Developer Snippets */}
      <section className="px-6 py-20 bg-surface-1">
        <div className="max-w-4xl mx-auto space-y-4">
          <div className="flex items-center gap-2">
            <Code2 size={20} className="text-accent" />
            <h2 className="text-3xl font-bold">Verify Agents in Your Service</h2>
          </div>
          <p className="text-sm text-muted">
            These code snippets are for <strong className="text-foreground">service developers</strong> who want to verify
            agents in their applications. Pre-filled with the deployed contract address for{" "}
            <strong className="text-foreground">{network.label}</strong>.
          </p>

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
          <p className="text-xs text-muted">
            Security default: <code className="bg-surface-2 font-mono text-accent-2 px-1 rounded">requireSelfProvider: true</code>.
            Turning this off accepts any approved proof provider, not only Self.
          </p>
          <p className="text-xs text-subtle font-mono">
            {snippets[activeUseCase].flow}
          </p>
          <CodeBlock tabs={snippets[activeUseCase].snippets} />
        </div>
      </section>

      {/* Agent Operator Snippets */}
      <section className="px-6 py-20">
        <div className="max-w-4xl mx-auto space-y-4">
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
      </section>

      {/* CLI Registration */}
      <section className="px-6 py-20 bg-surface-1">
        <div className="max-w-4xl mx-auto">
          <div className="flex items-center gap-2 mb-4">
            <Terminal size={20} className="text-accent" />
            <h2 className="text-3xl font-bold">CLI &amp; Agent-Guided Registration</h2>
          </div>
          <p className="text-sm text-muted mb-6">
            Register agents from your terminal or let your backend orchestrate the registration flow programmatically.
            The CLI creates a session, generates a browser handoff URL, and polls for completion.
          </p>

          <Card className="mb-6">
            <p className="font-bold text-sm mb-3">Quick Start</p>
            <CodeBlock
              tabs={[
                {
                  label: "TypeScript",
                  language: "bash",
                  code: `npx @selfxyz/agent-sdk register init \\
  --mode agent-identity \\
  --human-address 0xYourWalletAddress \\
  --network ${network.isTestnet ? "testnet" : "mainnet"} \\
  --out .self/session.json

# Open browser for Self proof
npx @selfxyz/agent-sdk register open --session .self/session.json

# Wait for completion
npx @selfxyz/agent-sdk register wait --session .self/session.json

# Export credentials
npx @selfxyz/agent-sdk register export --session .self/session.json`,
                },
                {
                  label: "Python",
                  language: "bash",
                  code: `self-agent register init \\
  --mode agent-identity \\
  --human-address 0xYourWalletAddress \\
  --network ${network.isTestnet ? "testnet" : "mainnet"} \\
  --out .self/session.json

self-agent register open --session .self/session.json
self-agent register wait --session .self/session.json
self-agent register export --session .self/session.json`,
                },
                {
                  label: "Rust",
                  language: "bash",
                  code: `self-agent register init \\
  --mode agent-identity \\
  --human-address 0xYourWalletAddress \\
  --network ${network.isTestnet ? "testnet" : "mainnet"} \\
  --out .self/session.json

self-agent register open --session .self/session.json
self-agent register wait --session .self/session.json
self-agent register export --session .self/session.json`,
                },
              ]}
            />
          </Card>

          <Card className="border border-accent/30 bg-accent/5">
            <p className="text-sm text-muted">
              <strong className="text-foreground">Agent-guided flow (recommended):</strong> Your backend calls{" "}
              <code className="bg-surface-2 font-mono text-accent-2 px-1 rounded text-xs">register init</code>,
              forwards the handoff URL to the user, and polls{" "}
              <code className="bg-surface-2 font-mono text-accent-2 px-1 rounded text-xs">register wait</code> for completion.
              This is the recommended pattern for services that onboard users programmatically.
            </p>
            <div className="mt-3 flex gap-3">
              <Link href="/cli">
                <Button variant="secondary" size="sm">CLI Quickstart</Button>
              </Link>
              <Link href="/api-docs">
                <Button variant="ghost" size="sm">API Reference</Button>
              </Link>
            </div>
          </Card>
        </div>
      </section>

    </main>
  );
}
