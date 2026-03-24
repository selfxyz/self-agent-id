"use client";

import { useState } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";

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

export function FrameworkSection({
  framework,
  ed25519Pubkey: _ed25519Pubkey,
  ed25519Signature: _ed25519Signature,
  challengeHash: _challengeHash,
  hasEd25519: _hasEd25519,
  onFrameworkChange,
  onPubkeyChange: _onPubkeyChange,
  onSignatureChange: _onSignatureChange,
}: FrameworkSectionProps) {
  const [expandedCategories, setExpandedCategories] = useState<
    Record<string, boolean>
  >({
    "Popular Frameworks": true,
    "OpenClaw Ecosystem": true,
    "Web3 / Crypto": true,
  });

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
    </section>
  );
}
