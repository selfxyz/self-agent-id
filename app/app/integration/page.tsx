// SPDX-FileCopyrightText: 2025-2026 Social Connect Labs, Inc.
// SPDX-License-Identifier: BUSL-1.1
// NOTE: Converts to Apache-2.0 on 2029-06-11 per LICENSE.

"use client";

import { useState, useMemo } from "react";
import Link from "next/link";
import {
  Code2,
  Cpu,
  Terminal,
  Bot,
  ExternalLink,
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
          <h1 className="text-5xl font-bold mb-6">Integration Guide</h1>
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
            <a
              href="#mcp"
              className="bg-surface-2 font-mono text-purple-400 px-3 py-1.5 rounded text-xs hover:bg-surface-2/80 transition-colors"
            >
              mcp &middot; @selfxyz/mcp-server
            </a>
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
          <p className="text-xs text-muted">
            Smart contracts are currently deployed on <strong className="text-foreground">Celo</strong> (mainnet &amp; Sepolia testnet).
            Multichain support is coming soon.
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

      {/* MCP Server & Plugin */}
      <section id="mcp" className="px-6 py-20">
        <div className="max-w-4xl mx-auto space-y-6">
          <div className="flex items-center gap-2">
            <Bot size={20} className="text-purple-400" />
            <h2 className="text-3xl font-bold">MCP Server &amp; Claude Code Plugin</h2>
          </div>
          <p className="text-sm text-muted">
            Use Self Agent ID directly from your AI coding assistant. The{" "}
            <a
              href="https://www.npmjs.com/package/@selfxyz/mcp-server"
              target="_blank"
              rel="noopener noreferrer"
              className="text-accent hover:text-accent-2 underline underline-offset-2"
            >
              MCP server
            </a>{" "}
            exposes 10 tools for identity management &mdash; register, sign, verify, and query agents
            without leaving your editor.
          </p>

          {/* MCP Install */}
          <Card>
            <p className="font-bold text-sm mb-3">MCP Server (any MCP-compatible IDE)</p>
            <p className="text-xs text-muted mb-3">
              Add this to your project&apos;s <code className="bg-surface-2 font-mono text-accent-2 px-1 rounded">.mcp.json</code> or
              IDE MCP settings:
            </p>
            <CodeBlock
              tabs={[
                {
                  label: "MCP Config",
                  language: "json",
                  code: `{
  "self-agent-id": {
    "command": "npx",
    "args": ["-y", "@selfxyz/mcp-server"],
    "env": {
      "SELF_AGENT_PRIVATE_KEY": "0x...",
      "SELF_NETWORK": "${network.isTestnet ? "testnet" : "mainnet"}",
      "SELF_AGENT_API_BASE": "https://self-agent-id.vercel.app"
    }
  }
}`,
                },
              ]}
            />
          </Card>

          {/* Claude Code Plugin */}
          <Card>
            <p className="font-bold text-sm mb-3">Claude Code Plugin (guided workflows)</p>
            <p className="text-xs text-muted mb-3">
              The plugin adds 6 skills that guide Claude through registration, signing, verification,
              and integration &mdash; with full protocol context loaded automatically.
            </p>
            <CodeBlock
              tabs={[
                {
                  label: "Install",
                  language: "bash",
                  code: `# Clone the repo and install the plugin
git clone https://github.com/selfxyz/self-agent-id.git
claude plugin add ./self-agent-id/plugin

# Or point to a local checkout
claude plugin add /path/to/self-agent-id/plugin`,
                },
              ]}
            />
          </Card>

          {/* MCP Tools */}
          <Card>
            <p className="font-bold text-sm mb-3">10 MCP Tools</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1 text-xs">
              {[
                ["self_register_agent", "Start agent registration (QR URL)"],
                ["self_check_registration", "Poll registration status"],
                ["self_get_identity", "Get current agent identity"],
                ["self_deregister_agent", "Initiate deregistration"],
                ["self_sign_request", "Generate auth headers"],
                ["self_authenticated_fetch", "Make a signed HTTP request"],
                ["self_lookup_agent", "Look up agent by ID or address"],
                ["self_list_agents_for_human", "List agents for a human"],
                ["self_verify_agent", "Verify on-chain proof status"],
                ["self_verify_request", "Verify signed request headers"],
              ].map(([tool, desc]) => (
                <div key={tool} className="flex items-start gap-2 py-1">
                  <code className="bg-surface-2 font-mono text-accent-2 px-1 rounded whitespace-nowrap">{tool}</code>
                  <span className="text-muted">{desc}</span>
                </div>
              ))}
            </div>
          </Card>

          {/* 6 Plugin Skills */}
          <Card>
            <p className="font-bold text-sm mb-2">6 Plugin Skills</p>
            <p className="text-xs text-muted mb-3">
              Each skill is a self-contained knowledge module with decision trees, code examples,
              and reference docs. They load automatically in Claude Code when triggered by your request.
            </p>
            <div className="space-y-2 text-xs">
              {[
                ["self-agent-id-overview", "Architecture, contracts, trust model, ERC-8004 standard, provider system"],
                ["register-agent", "Step-by-step registration in all 4 modes (wallet, agent-identity, wallet-free, smart-wallet)"],
                ["sign-requests", "ECDSA request signing, 3-header auth system, signed fetch patterns"],
                ["verify-agents", "On-chain verification, SelfAgentVerifier middleware, reputation, freshness, sybil detection"],
                ["query-credentials", "ZK-attested credentials, agent cards (A2A format), reputation scores"],
                ["integrate-self-id", "End-to-end integration: agent-side, service-side, on-chain gating, MCP setup"],
              ].map(([skill, desc]) => (
                <div key={skill} className="flex items-start gap-2 py-1">
                  <code className="bg-surface-2 font-mono text-accent-2 px-1 rounded whitespace-nowrap">{skill}</code>
                  <span className="text-muted">{desc}</span>
                </div>
              ))}
            </div>
          </Card>

          {/* System Prompts for non-MCP agents */}
          <Card className="border border-accent/30 bg-accent/5">
            <p className="font-bold text-sm mb-2">Building a custom agent? Use our system prompts</p>
            <p className="text-xs text-muted mb-3">
              For agents that don&apos;t support MCP (LangChain, AutoGPT, custom frameworks), paste one of these
              self-contained system prompts. No tools required &mdash; the agent gets full protocol knowledge
              and uses the REST API directly.
            </p>
            <div className="flex gap-3 flex-wrap">
              <a
                href="https://github.com/selfxyz/self-agent-id/blob/main/docs/system-prompts/self-agent-id-full.md"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-xs text-accent hover:text-accent-2 underline underline-offset-2"
              >
                Full protocol <ExternalLink size={10} />
              </a>
              <a
                href="https://github.com/selfxyz/self-agent-id/blob/main/docs/system-prompts/self-agent-id-register.md"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-xs text-accent hover:text-accent-2 underline underline-offset-2"
              >
                Registration only <ExternalLink size={10} />
              </a>
              <a
                href="https://github.com/selfxyz/self-agent-id/blob/main/docs/system-prompts/self-agent-id-verify.md"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-xs text-accent hover:text-accent-2 underline underline-offset-2"
              >
                Verification only <ExternalLink size={10} />
              </a>
            </div>
          </Card>
        </div>
      </section>

    </main>
  );
}
