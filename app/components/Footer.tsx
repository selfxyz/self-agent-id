import { ExternalLink } from "lucide-react";

const REGISTRY_ADDRESS = "0x42CEA1b318557aDE212bED74FC3C7f06Ec52bd5b";
const BLOCKSCOUT_URL = `https://celo-sepolia.blockscout.com/address/${REGISTRY_ADDRESS}`;

export function Footer() {
  return (
    <footer className="border-t border-border bg-surface-1 py-8 px-6">
      <div className="max-w-6xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-4 text-sm text-muted">
        <div className="flex items-center gap-2">
          <span>Built on</span>
          <a
            href="https://self.xyz"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1.5 hover:text-foreground transition-colors"
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/self-icon.png" alt="Self" width={20} height={20} className="rounded" />
            <span>Self Protocol</span>
            <ExternalLink size={10} />
          </a>
          <span>+</span>
          <a
            href="https://celo.org"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1 hover:text-foreground transition-colors"
          >
            <span>Celo</span>
            <ExternalLink size={10} />
          </a>
        </div>
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
