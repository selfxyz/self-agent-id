"use client";

import React, { useState } from "react";

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
    navigator.clipboard.writeText(tabs[activeTab].code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="w-full rounded-lg border border-gray-200 overflow-hidden">
      <div className="flex border-b border-gray-200 bg-gray-50">
        {tabs.map((tab, i) => (
          <button
            key={tab.label}
            onClick={() => setActiveTab(i)}
            className={`px-4 py-2 text-sm font-medium transition-colors ${
              i === activeTab
                ? "bg-white text-black border-b-2 border-black"
                : "text-gray-500 hover:text-gray-700"
            }`}
          >
            {tab.label}
          </button>
        ))}
        <div className="ml-auto pr-2 flex items-center">
          <button
            onClick={handleCopy}
            className="text-xs text-gray-400 hover:text-gray-600 px-2 py-1"
          >
            {copied ? "Copied!" : "Copy"}
          </button>
        </div>
      </div>
      <pre className="p-4 overflow-x-auto text-sm leading-relaxed bg-gray-900 text-gray-100">
        <code>{tabs[activeTab].code}</code>
      </pre>
    </div>
  );
}
