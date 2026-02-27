// SPDX-FileCopyrightText: 2025-2026 Social Connect Labs, Inc.
// SPDX-License-Identifier: BUSL-1.1
// NOTE: Converts to Apache-2.0 on 2029-06-11 per LICENSE.

"use client";

import React, { useState } from "react";
import { Highlight, themes } from "prism-react-renderer";

// Map language labels to Prism-supported language names
function toPrismLanguage(lang: string): string {
  const map: Record<string, string> = {
    solidity: "typescript", // closest syntax match with Prism built-ins
    typescript: "typescript",
    javascript: "javascript",
    python: "python",
    json: "json",
    yaml: "yaml",
    bash: "javascript",
  };
  return map[lang.toLowerCase()] || "typescript";
}

interface CodeTab {
  label: string;
  language: string;
  code: string;
}

interface CodeBlockProps {
  tabs: CodeTab[];
}

export default function CodeBlock({ tabs }: CodeBlockProps) {
  const [activeTab, setActiveTab] = useState(0);
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    void navigator.clipboard.writeText(tabs[activeTab].code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const currentTab = tabs[activeTab];
  const prismLang = toPrismLanguage(currentTab.language);

  return (
    <div className="w-full rounded-lg border border-border overflow-hidden">
      <div
        className="flex border-b border-border"
        style={{ backgroundColor: "#1e1e2e" }}
      >
        {tabs.map((tab, i) => (
          <button
            key={tab.label}
            onClick={() => setActiveTab(i)}
            className={`px-4 py-2 text-sm font-medium transition-colors ${
              i === activeTab
                ? "bg-[#282840] text-white border-b-2 border-accent"
                : "text-gray-400 hover:text-gray-200"
            }`}
          >
            {tab.label}
          </button>
        ))}
        <div className="ml-auto pr-2 flex items-center">
          <button
            onClick={handleCopy}
            className="text-xs text-gray-400 hover:text-gray-200 px-2 py-1 transition-colors"
          >
            {copied ? "Copied!" : "Copy"}
          </button>
        </div>
      </div>
      <Highlight
        theme={themes.oneDark}
        code={currentTab.code}
        language={prismLang}
      >
        {({ style, tokens, getLineProps, getTokenProps }) => (
          <pre
            className="p-4 overflow-x-auto text-sm leading-relaxed"
            style={{ ...style, margin: 0, backgroundColor: "#1e1e2e" }}
          >
            {tokens.map((line, i) => (
              <div key={i} {...getLineProps({ line })}>
                <span className="inline-block w-8 text-right mr-4 text-gray-500 select-none text-xs">
                  {i + 1}
                </span>
                {line.map((token, key) => (
                  <span key={key} {...getTokenProps({ token })} />
                ))}
              </div>
            ))}
          </pre>
        )}
      </Highlight>
    </div>
  );
}
