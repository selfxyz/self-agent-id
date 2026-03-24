"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const tabs = [
  { href: "/agents/register", label: "Register" },
  { href: "/agents", label: "My Agents", exact: true },
  { href: "/agents/verify", label: "Verify" },
  { href: "/agents/visa", label: "Celo Agent Visa" },
];

export function AgentsTabs() {
  const pathname = usePathname();

  return (
    <div className="flex justify-center gap-1 border-b border-border mb-8">
      {tabs.map((tab) => {
        const active =
          "exact" in tab && tab.exact
            ? pathname === tab.href
            : pathname === tab.href || pathname.startsWith(`${tab.href}/`);
        return (
          <Link
            key={tab.href}
            href={tab.href}
            className={`px-4 py-2.5 text-sm font-medium transition-colors border-b-2 -mb-px ${
              active
                ? "border-foreground text-foreground"
                : "border-transparent text-muted hover:text-foreground hover:border-border"
            }`}
          >
            {tab.label}
          </Link>
        );
      })}
    </div>
  );
}
