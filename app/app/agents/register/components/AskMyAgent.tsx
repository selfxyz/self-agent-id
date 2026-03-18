"use client";

import { useState } from "react";
import { Copy, Check, Terminal } from "lucide-react";

const CURL_COMMAND = "curl https://app.ai.self.xyz/api/agent/bootstrap";

export function AskMyAgent() {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    void navigator.clipboard.writeText(CURL_COMMAND);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <section className="space-y-4">
      <div className="flex items-center gap-2">
        <Terminal className="h-5 w-5 text-accent" />
        <h2 className="text-lg font-bold text-foreground">Ask my agent</h2>
      </div>

      <p className="text-sm text-muted">
        Run this command to let your agent bootstrap its own registration:
      </p>

      <div className="relative rounded-lg border border-border overflow-hidden">
        <div
          className="flex items-center justify-between px-4 py-2 border-b border-border"
          style={{ backgroundColor: "#1e1e2e" }}
        >
          <span className="text-xs text-gray-400 font-mono">bash</span>
          <button
            type="button"
            onClick={handleCopy}
            className="text-xs text-gray-400 hover:text-gray-200 transition-colors flex items-center gap-1"
          >
            {copied ? (
              <>
                <Check className="h-3 w-3" />
                Copied!
              </>
            ) : (
              <>
                <Copy className="h-3 w-3" />
                Copy
              </>
            )}
          </button>
        </div>
        <pre
          className="p-4 overflow-x-auto text-sm font-mono leading-relaxed text-gray-200"
          style={{ backgroundColor: "#1e1e2e", margin: 0 }}
        >
          {CURL_COMMAND}
        </pre>
      </div>
    </section>
  );
}
