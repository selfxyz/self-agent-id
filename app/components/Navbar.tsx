"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Menu, X } from "lucide-react";
import { useNetwork } from "@/lib/NetworkContext";
import { getNetwork, isNetworkReady } from "@/lib/network";

const links = [
  { href: "/register", label: "Register" },
  { href: "/my-agents", label: "My Agents" },
  { href: "/verify", label: "Verify" },
  { href: "/demo", label: "Demo" },
  { href: "/explainer", label: "How It Works" },
  { href: "/erc8004", label: "ERC-8004" },
];

export function Navbar() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const { networkId, setNetworkId } = useNetwork();

  const mainnetReady = isNetworkReady(getNetwork("celo-mainnet"));
  const sepoliaReady = isNetworkReady(getNetwork("celo-sepolia"));

  return (
    <nav className="fixed top-0 left-0 right-0 z-50 h-[60px] backdrop-blur-md bg-background/80 border-b border-border">
      <div className="max-w-6xl mx-auto h-full px-6 flex items-center justify-between">
        {/* Logo */}
        <Link href="/" className="flex items-center gap-2.5">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/self-icon.png"
            alt="Self"
            width={28}
            height={28}
            className="rounded-md"
          />
          <span className="text-foreground font-medium text-sm hidden sm:inline">
            Self Agent ID
          </span>
        </Link>

        {/* Desktop nav */}
        <div className="hidden md:flex items-center gap-1">
          {links.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className={`px-3 py-1.5 rounded-lg text-sm transition-colors ${
                pathname === link.href
                  ? "text-foreground bg-surface-2"
                  : "text-muted hover:text-foreground hover:bg-surface-1"
              }`}
            >
              {link.label}
            </Link>
          ))}
        </div>

        {/* Network toggle + Mobile hamburger */}
        <div className="flex items-center gap-2">
          {/* Segmented network toggle */}
          <div className="flex rounded-full border border-border bg-surface-1 overflow-hidden text-xs font-medium">
            <button
              onClick={() => mainnetReady && setNetworkId("celo-mainnet")}
              disabled={!mainnetReady}
              className={`flex items-center gap-1 px-2.5 py-1 transition-colors ${
                networkId === "celo-mainnet"
                  ? "bg-surface-2 text-foreground"
                  : mainnetReady
                    ? "text-muted hover:text-foreground hover:bg-surface-2/50"
                    : "text-muted/40 cursor-not-allowed"
              }`}
              title={mainnetReady ? "Switch to Celo mainnet" : "Celo mainnet coming soon"}
            >
              <span className={`w-1.5 h-1.5 rounded-full ${
                networkId === "celo-mainnet" ? "bg-emerald-400" : "bg-emerald-400/30"
              }`} />
              Celo
            </button>
            <button
              onClick={() => sepoliaReady && setNetworkId("celo-sepolia")}
              disabled={!sepoliaReady}
              className={`flex items-center gap-1 px-2.5 py-1 transition-colors ${
                networkId === "celo-sepolia"
                  ? "bg-surface-2 text-foreground"
                  : sepoliaReady
                    ? "text-muted hover:text-foreground hover:bg-surface-2/50"
                    : "text-muted/40 cursor-not-allowed"
              }`}
              title="Switch to Celo Sepolia testnet"
            >
              <span className={`w-1.5 h-1.5 rounded-full ${
                networkId === "celo-sepolia" ? "bg-amber-400" : "bg-amber-400/30"
              }`} />
              Sepolia
            </button>
          </div>

          <button
            onClick={() => setOpen(!open)}
            className="md:hidden text-muted hover:text-foreground p-1"
            aria-label="Toggle menu"
          >
            {open ? <X size={20} /> : <Menu size={20} />}
          </button>
        </div>
      </div>

      {/* Mobile dropdown */}
      {open && (
        <div className="md:hidden border-b border-border bg-surface-1/95 backdrop-blur-md">
          {links.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              onClick={() => setOpen(false)}
              className={`block px-6 py-3 text-sm transition-colors ${
                pathname === link.href
                  ? "text-foreground bg-surface-2"
                  : "text-muted hover:text-foreground"
              }`}
            >
              {link.label}
            </Link>
          ))}
        </div>
      )}
    </nav>
  );
}
