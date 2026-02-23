import Link from "next/link";
import MatrixText from "@/components/MatrixText";
import { Card } from "@/components/Card";
import { Bot } from "lucide-react";

export default function CliQuickstartPage() {
  return (
    <main className="min-h-screen max-w-4xl mx-auto px-6 pt-24 pb-12">
      <div className="flex justify-center mb-8">
        <MatrixText text="CLI Quickstart" fontSize={44} />
      </div>

      <div className="space-y-6">
        <Card>
          <h2 className="text-lg font-bold mb-2">What this page is</h2>
          <p className="text-sm text-muted">
            This is the entrypoint for CLI onboarding. The CLI prints a signed handoff URL that opens{" "}
            <code className="bg-surface-2 px-1 rounded text-accent-2">/cli/register</code> for browser proof completion.
          </p>
        </Card>

        <Card>
          <h2 className="text-lg font-bold mb-2">Human registration flow (today)</h2>
          <ol className="list-decimal list-inside text-sm text-muted space-y-2">
            <li>Create session: <code className="bg-surface-2 px-1 rounded text-accent-2">self-agent register init --mode agent-identity --human-address 0x... --network testnet --out .self/session.json</code></li>
            <li>Get handoff URL: <code className="bg-surface-2 px-1 rounded text-accent-2">self-agent register open --session .self/session.json</code></li>
            <li>Complete Self proof in browser (and passkey step for smart-wallet mode).</li>
            <li>Finalize in terminal: <code className="bg-surface-2 px-1 rounded text-accent-2">self-agent register wait --session .self/session.json</code></li>
          </ol>
        </Card>

        <Card>
          <h2 className="text-lg font-bold mb-2">Human deregistration flow (today)</h2>
          <ol className="list-decimal list-inside text-sm text-muted space-y-2">
            <li>Create session: <code className="bg-surface-2 px-1 rounded text-accent-2">self-agent deregister init --mode verified-wallet --human-address 0x... --network testnet --out .self/session-deregister.json</code></li>
            <li>Get handoff URL: <code className="bg-surface-2 px-1 rounded text-accent-2">self-agent deregister open --session .self/session-deregister.json</code></li>
            <li>Complete Self proof in browser.</li>
            <li>Finalize in terminal: <code className="bg-surface-2 px-1 rounded text-accent-2">self-agent deregister wait --session .self/session-deregister.json</code></li>
          </ol>
        </Card>

        <Card>
          <h2 className="text-lg font-bold mb-2">Agent-guided flow (recommended pattern)</h2>
          <p className="text-sm text-muted mb-2">
            Your backend or agent runtime can orchestrate the same commands, then send the handoff URL to the user.
          </p>
          <ol className="list-decimal list-inside text-sm text-muted space-y-1">
            <li>Backend calls <code className="bg-surface-2 px-1 rounded text-accent-2">{`{register|deregister} init`}</code> and stores session state.</li>
            <li>Backend calls <code className="bg-surface-2 px-1 rounded text-accent-2">{`{register|deregister} open`}</code> and forwards URL to user UI.</li>
            <li>User completes browser proof flow.</li>
            <li>Backend runs <code className="bg-surface-2 px-1 rounded text-accent-2">{`{register|deregister} wait`}</code> and records the returned lifecycle state.</li>
          </ol>
        </Card>

        <Card>
          <h2 className="text-lg font-bold mb-2">Language entrypoints</h2>
          <ul className="list-disc list-inside text-sm text-muted space-y-1">
            <li>TypeScript: <code className="bg-surface-2 px-1 rounded text-accent-2">self-agent ...</code> (or <code className="bg-surface-2 px-1 rounded text-accent-2">self-agent-cli ...</code>)</li>
            <li>Python: <code className="bg-surface-2 px-1 rounded text-accent-2">python -m self_agent_sdk.cli ...</code></li>
            <li>Rust: <code className="bg-surface-2 px-1 rounded text-accent-2">self-agent-cli ...</code></li>
          </ul>
        </Card>

        <Card className="border border-purple-500/30 bg-purple-500/5">
          <div className="flex items-start gap-3">
            <Bot size={18} className="text-purple-400 mt-0.5 shrink-0" />
            <div>
              <p className="text-sm text-muted">
                <strong className="text-foreground">Using an AI coding assistant?</strong>{" "}
                Install the{" "}
                <Link
                  href="/integration#mcp"
                  className="text-accent hover:text-accent-2 underline underline-offset-2"
                >
                  MCP server
                </Link>{" "}
                or{" "}
                <Link
                  href="/integration#mcp"
                  className="text-accent hover:text-accent-2 underline underline-offset-2"
                >
                  Claude Code plugin
                </Link>{" "}
                to register, sign, and verify agents directly from your editor — no CLI needed.
              </p>
            </div>
          </div>
        </Card>

        <Card>
          <p className="text-sm text-muted">
            Full protocol details are in repository docs:
            {" "}
            <code className="bg-surface-2 px-1 rounded text-accent-2">docs/CLI_REGISTRATION_SPEC.md</code>
            {" "}and{" "}
            <code className="bg-surface-2 px-1 rounded text-accent-2">docs/CLI_REGISTRATION_GUIDE.md</code>
            {" "}on{" "}
            <Link
              href="https://github.com/selfxyz/self-agent-id"
              target="_blank"
              rel="noopener noreferrer"
              className="text-accent hover:text-accent-2 underline underline-offset-2"
            >
              GitHub
            </Link>{" "}
            .
          </p>
        </Card>
      </div>
    </main>
  );
}
