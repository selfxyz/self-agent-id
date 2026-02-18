import { ExternalLink } from "lucide-react";

const REGISTRY_ADDRESS = "0x24D46f30d41e91B3E0d1A8EB250FEa4B90270251";
const BLOCKSCOUT_URL = `https://celo-alfajores.blockscout.com/address/${REGISTRY_ADDRESS}`;

export function Footer() {
  return (
    <footer className="border-t border-border bg-surface-1 py-8 px-6">
      <div className="max-w-6xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-4 text-sm text-muted">
        <span>Built on Self Protocol + Celo</span>
        <a
          href={BLOCKSCOUT_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-1.5 hover:text-foreground transition-colors"
        >
          <span className="font-mono text-xs">
            {REGISTRY_ADDRESS.slice(0, 6)}...{REGISTRY_ADDRESS.slice(-4)}
          </span>
          <ExternalLink size={12} />
        </a>
      </div>
    </footer>
  );
}
