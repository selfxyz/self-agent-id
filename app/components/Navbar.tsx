// SPDX-FileCopyrightText: 2025-2026 Social Connect Labs, Inc.
// SPDX-License-Identifier: BUSL-1.1
// NOTE: Converts to Apache-2.0 on 2029-06-11 per LICENSE.

"use client";

import { useState, useRef, useEffect } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Menu, X, ChevronDown } from "lucide-react";
import { useNetwork } from "@/lib/NetworkContext";
import { getNetwork, isNetworkReady } from "@/lib/network";

const directLinks = [
  { href: "/agents", label: "Manage Agents", match: "/agents" },
  { href: "/demo", label: "Demo" },
];

const developerLinks = [
  { href: "/cli", label: "CLI" },
  { href: "/api-docs", label: "API Docs" },
  { href: "/integration", label: "Integrate" },
];

const learnLinks = [
  { href: "/explainer", label: "How It Works" },
  { href: "/erc8004", label: "ERC-8004" },
];

export function Navbar() {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [devOpen, setDevOpen] = useState(false);
  const devRef = useRef<HTMLDivElement>(null);
  const devTimeout = useRef<ReturnType<typeof setTimeout>>();
  const { networkId, setNetworkId } = useNetwork();

  const mainnetReady = isNetworkReady(getNetwork("celo-mainnet"));
  const sepoliaReady = isNetworkReady(getNetwork("celo-sepolia"));

  // Close dropdown when clicking outside
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (devRef.current && !devRef.current.contains(e.target as Node)) {
        setDevOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  const isActive = (href: string, match?: string) => {
    if (match) return pathname.startsWith(match);
    return pathname === href;
  };

  const linkClass = (href: string, match?: string) =>
    `px-3 py-1.5 rounded-lg text-sm transition-colors ${
      isActive(href, match)
        ? "text-foreground bg-surface-2"
        : "text-muted hover:text-foreground hover:bg-surface-1"
    }`;

  const isDevActive = developerLinks.some((l) => pathname === l.href);

  return (
    <nav className="fixed top-0 left-0 right-0 z-50 h-[60px] backdrop-blur-md bg-white/80 border-b border-border">
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
          {directLinks.map((link) => (
            <Link key={link.href} href={link.href} className={linkClass(link.href, link.match)}>
              {link.label}
            </Link>
          ))}

          {learnLinks.map((link) => (
            <Link key={link.href} href={link.href} className={linkClass(link.href)}>
              {link.label}
            </Link>
          ))}

          {/* Developers dropdown — last in the block */}
          <div
            ref={devRef}
            className="relative"
            onMouseEnter={() => {
              clearTimeout(devTimeout.current);
              setDevOpen(true);
            }}
            onMouseLeave={() => {
              devTimeout.current = setTimeout(() => setDevOpen(false), 150);
            }}
          >
            <button
              onClick={() => setDevOpen(!devOpen)}
              className={`flex items-center gap-1 px-3 py-1.5 rounded-lg text-sm transition-colors ${
                isDevActive
                  ? "text-foreground bg-surface-2"
                  : "text-muted hover:text-foreground hover:bg-surface-1"
              }`}
            >
              Developers
              <ChevronDown size={14} className={`transition-transform ${devOpen ? "rotate-180" : ""}`} />
            </button>

            {devOpen && (
              <div className="absolute top-full left-0 mt-1 py-1 min-w-[160px] bg-white border border-border rounded-lg shadow-lg">
                {developerLinks.map((link) => (
                  <Link
                    key={link.href}
                    href={link.href}
                    onClick={() => setDevOpen(false)}
                    className={`block px-4 py-2 text-sm transition-colors ${
                      pathname === link.href
                        ? "text-foreground bg-surface-2"
                        : "text-muted hover:text-foreground hover:bg-surface-1"
                    }`}
                  >
                    {link.label}
                  </Link>
                ))}
              </div>
            )}
          </div>
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
            onClick={() => setMobileOpen(!mobileOpen)}
            className="md:hidden text-muted hover:text-foreground p-1"
            aria-label="Toggle menu"
          >
            {mobileOpen ? <X size={20} /> : <Menu size={20} />}
          </button>
        </div>
      </div>

      {/* Mobile dropdown */}
      {mobileOpen && (
        <div className="md:hidden border-b border-border bg-surface-1/95 backdrop-blur-md">
          {directLinks.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              onClick={() => setMobileOpen(false)}
              className={`block px-6 py-3 text-sm transition-colors ${
                isActive(link.href, link.match)
                  ? "text-foreground bg-surface-2"
                  : "text-muted hover:text-foreground"
              }`}
            >
              {link.label}
            </Link>
          ))}

          <div className="px-6 py-2">
            <span className="text-xs font-medium text-subtle uppercase tracking-wider">Developers</span>
          </div>
          {developerLinks.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              onClick={() => setMobileOpen(false)}
              className={`block px-6 py-3 pl-8 text-sm transition-colors ${
                pathname === link.href
                  ? "text-foreground bg-surface-2"
                  : "text-muted hover:text-foreground"
              }`}
            >
              {link.label}
            </Link>
          ))}

          {learnLinks.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              onClick={() => setMobileOpen(false)}
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
