"use client";

import Link from "next/link";

export default function Home() {
  return (
    <main className="min-h-screen flex flex-col items-center justify-center p-8 gap-8 font-[family-name:var(--font-inter)]">
      <div className="text-center max-w-2xl">
        <h1 className="text-4xl font-bold mb-4">Self Agent ID</h1>
        <p className="text-lg text-gray-600 mb-8">
          Register AI agents with on-chain proof-of-human verification via Self
          Protocol. Prove your agent is backed by a real, unique human.
        </p>
      </div>

      <div className="flex flex-col sm:flex-row gap-4">
        <Link
          href="/register"
          className="px-8 py-4 bg-black text-white rounded-lg text-lg font-medium hover:bg-gray-800 transition-colors text-center"
        >
          Register Agent
        </Link>
        <Link
          href="/verify"
          className="px-8 py-4 border-2 border-black rounded-lg text-lg font-medium hover:bg-gray-100 transition-colors text-center"
        >
          Verify Agent
        </Link>
        <Link
          href="/explainer"
          className="px-8 py-4 border-2 border-gray-400 text-gray-600 rounded-lg text-lg font-medium hover:bg-gray-100 transition-colors text-center"
        >
          EIP-8004 Proposal
        </Link>
      </div>
    </main>
  );
}
