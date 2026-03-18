"use client";

import { useState } from "react";
import { Copy, Check, ChevronDown, ChevronUp } from "lucide-react";

import type { AgentFramework } from "../hooks/useRegistrationState";

interface FrameworkSectionProps {
  framework: AgentFramework;
  ed25519Pubkey: string;
  ed25519Signature: string;
  challengeHash: string | null;
  hasEd25519: boolean;
  onFrameworkChange: (fw: string) => void;
  onPubkeyChange: (key: string) => void;
  onSignatureChange: (sig: string) => void;
}

interface FrameworkEntry {
  key: string;
  label: string;
}

interface FrameworkCategory {
  label: string;
  frameworks: FrameworkEntry[];
}

const FRAMEWORK_CATEGORIES: FrameworkCategory[] = [
  {
    label: "Popular Frameworks",
    frameworks: [
      { key: "openclaw", label: "OpenClaw" },
      { key: "langchain", label: "LangChain / LangGraph" },
      { key: "crewai", label: "CrewAI" },
      { key: "autogen", label: "AutoGen / Microsoft Agent Framework" },
      { key: "google-adk", label: "Google ADK" },
      { key: "claude-agent-sdk", label: "Claude Agent SDK" },
      { key: "openai-agents-sdk", label: "OpenAI Agents SDK" },
      { key: "vercel-ai-sdk", label: "Vercel AI SDK" },
      { key: "llamaindex", label: "LlamaIndex" },
      { key: "semantic-kernel", label: "Semantic Kernel" },
    ],
  },
  {
    label: "OpenClaw Ecosystem",
    frameworks: [
      { key: "ironclaw", label: "IronClaw" },
      { key: "nanoclaw", label: "NanoClaw" },
      { key: "picoclaw", label: "PicoClaw" },
      { key: "zeroclaw", label: "ZeroClaw" },
      { key: "openfang", label: "OpenFang" },
      { key: "hermes", label: "Hermes Agent" },
      { key: "maxclaw", label: "MaxClaw" },
      { key: "kimi-claw", label: "Kimi Claw" },
      { key: "denchclaw", label: "DenchClaw" },
    ],
  },
  {
    label: "Web3 / Crypto",
    frameworks: [
      { key: "eliza", label: "Eliza (ElizaOS)" },
      { key: "coinbase-agentkit", label: "Coinbase AgentKit" },
    ],
  },
  {
    label: "More Frameworks",
    frameworks: [
      { key: "agno", label: "Agno (Phidata)" },
      { key: "mastra", label: "Mastra" },
      { key: "pydantic-ai", label: "Pydantic AI" },
      { key: "smolagents", label: "SmolAgents (Hugging Face)" },
      { key: "haystack", label: "Haystack" },
      { key: "dspy", label: "DSPy" },
      { key: "metagpt", label: "MetaGPT" },
      { key: "camel-ai", label: "CAMEL-AI" },
      { key: "superagi", label: "SuperAGI" },
      { key: "swarms", label: "Swarms" },
      { key: "autogpt", label: "AutoGPT" },
      { key: "atomic-agents", label: "Atomic Agents" },
      { key: "agentscope", label: "AgentScope" },
    ],
  },
  {
    label: "Platforms / Low-Code",
    frameworks: [
      { key: "n8n", label: "n8n" },
      { key: "dify", label: "Dify" },
      { key: "coze", label: "Coze" },
    ],
  },
];

const AGENT_PROMPT =
  "Check if you have an Ed25519 keypair available. If you do, give me the public key (64 hex chars, no 0x prefix). If not, tell me what key types you support.";

export function FrameworkSection({
  framework,
  ed25519Pubkey,
  ed25519Signature,
  challengeHash,
  hasEd25519,
  onFrameworkChange,
  onPubkeyChange,
  onSignatureChange,
}: FrameworkSectionProps) {
  const [showPrompt, setShowPrompt] = useState(false);
  const [copiedPrompt, setCopiedPrompt] = useState(false);
  const [copiedHash, setCopiedHash] = useState(false);
  const [expandedCategories, setExpandedCategories] = useState<
    Record<string, boolean>
  >({ "Popular Frameworks": true, "OpenClaw Ecosystem": true, "Web3 / Crypto": true });

  const copyText = (text: string, setter: (v: boolean) => void) => {
    void navigator.clipboard.writeText(text);
    setter(true);
    setTimeout(() => setter(false), 2000);
  };

  const toggleCategory = (label: string) => {
    setExpandedCategories((prev) => ({ ...prev, [label]: !prev[label] }));
  };

  return (
    <section className="space-y-6">
      <h2 className="text-lg font-semibold text-foreground">
        Select your agent
      </h2>

      <div className="space-y-4">
        {FRAMEWORK_CATEGORIES.map((cat) => {
          const isExpanded = expandedCategories[cat.label] ?? false;
          return (
            <div key={cat.label}>
              <button
                type="button"
                onClick={() => toggleCategory(cat.label)}
                className="flex w-full items-center justify-between text-sm font-medium text-muted hover:text-foreground transition-colors mb-2"
              >
                {cat.label}
                {isExpanded ? (
                  <ChevronUp className="h-4 w-4" />
                ) : (
                  <ChevronDown className="h-4 w-4" />
                )}
              </button>
              {isExpanded && (
                <div className="grid grid-cols-2 gap-2">
                  {cat.frameworks.map((fw) => {
                    const selected = framework === fw.key;
                    return (
                      <button
                        key={fw.key}
                        type="button"
                        onClick={() => onFrameworkChange(fw.key)}
                        className={`text-left rounded-lg border px-3 py-2 transition-all text-sm ${
                          selected
                            ? "border-accent bg-accent/10 text-accent font-medium"
                            : "border-border hover:border-border-strong bg-surface-1 text-foreground"
                        }`}
                      >
                        {fw.label}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>

      <details className="text-sm text-muted">
        <summary className="cursor-pointer hover:text-foreground transition-colors">
          Not listed here or I already understand
        </summary>
        <div className="mt-3 space-y-3 pl-4">
          <div>
            <label className="block text-sm text-muted mb-1">
              Ed25519 public key (64 hex chars)
            </label>
            <input
              type="text"
              maxLength={64}
              placeholder="e.g. a1b2c3d4..."
              value={ed25519Pubkey}
              onChange={(e) => {
                onPubkeyChange(e.target.value);
                if (framework !== "manual") onFrameworkChange("manual");
              }}
              className="w-full px-3 py-2 text-sm rounded-lg"
            />
          </div>
          <button
            type="button"
            onClick={() => {
              onFrameworkChange("manual");
              onPubkeyChange("");
            }}
            className="text-xs text-accent hover:underline"
          >
            or proceed without Ed25519
          </button>
        </div>
      </details>

      <div className="space-y-3">
        <button
          type="button"
          onClick={() => setShowPrompt((p) => !p)}
          className="text-sm font-medium text-accent hover:underline"
        >
          {showPrompt ? "Hide prompt" : "Ask your agent this question"}
        </button>

        {showPrompt && (
          <div className="relative rounded-lg border border-border bg-surface-2 p-4">
            <p className="text-sm text-foreground pr-8 leading-relaxed">
              {AGENT_PROMPT}
            </p>
            <button
              type="button"
              onClick={() => copyText(AGENT_PROMPT, setCopiedPrompt)}
              className="absolute top-3 right-3 text-muted hover:text-foreground transition-colors"
              title="Copy prompt"
            >
              {copiedPrompt ? (
                <Check className="h-4 w-4 text-accent-success" />
              ) : (
                <Copy className="h-4 w-4" />
              )}
            </button>
          </div>
        )}
      </div>

      {hasEd25519 && framework !== null && (
        <div className="space-y-3 rounded-xl border border-border bg-surface-1 p-4">
          <div>
            <label className="block text-sm text-muted mb-1">
              Ed25519 public key
            </label>
            <input
              type="text"
              maxLength={64}
              placeholder="64 hex characters"
              value={ed25519Pubkey}
              onChange={(e) => onPubkeyChange(e.target.value)}
              className="w-full px-3 py-2 text-sm font-mono rounded-lg"
            />
          </div>

          {challengeHash && (
            <div>
              <label className="block text-sm text-muted mb-1">
                Challenge hash
              </label>
              <div className="relative">
                <input
                  type="text"
                  readOnly
                  value={challengeHash}
                  className="w-full px-3 py-2 pr-10 text-sm font-mono rounded-lg bg-surface-2 cursor-default"
                />
                <button
                  type="button"
                  onClick={() => copyText(challengeHash, setCopiedHash)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-muted hover:text-foreground transition-colors"
                  title="Copy hash"
                >
                  {copiedHash ? (
                    <Check className="h-4 w-4 text-accent-success" />
                  ) : (
                    <Copy className="h-4 w-4" />
                  )}
                </button>
              </div>
            </div>
          )}

          <div>
            <label className="block text-sm text-muted mb-1">
              Ed25519 signature (128 hex chars)
            </label>
            <input
              type="text"
              maxLength={128}
              placeholder="128 hex characters"
              value={ed25519Signature}
              onChange={(e) => onSignatureChange(e.target.value)}
              className="w-full px-3 py-2 text-sm font-mono rounded-lg"
            />
          </div>
        </div>
      )}
    </section>
  );
}
