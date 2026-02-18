"use client";

import { useState } from "react";
import Link from "next/link";
import { ethers } from "ethers";
import CodeBlock from "@/components/CodeBlock";
import { getSnippets } from "@/lib/snippets";
import { REGISTRY_ADDRESS, REGISTRY_ABI, RPC_URL } from "@/lib/constants";

const useCases = getSnippets();

type VerifyStatus = "idle" | "loading" | "verified" | "not-registered" | "error";

export default function ExplainerPage() {
  const [activeUseCase, setActiveUseCase] = useState(0);
  const [pubKeyInput, setPubKeyInput] = useState("");
  const [verifyStatus, setVerifyStatus] = useState<VerifyStatus>("idle");
  const [verifyError, setVerifyError] = useState("");

  const handleVerify = async () => {
    const trimmed = pubKeyInput.trim();
    if (!trimmed) return;

    setVerifyStatus("loading");
    setVerifyError("");

    try {
      const provider = new ethers.JsonRpcProvider(RPC_URL);
      const registry = new ethers.Contract(REGISTRY_ADDRESS, REGISTRY_ABI, provider);

      let key = trimmed;
      if (!key.startsWith("0x")) {
        key = "0x" + key;
      }
      if (key.length !== 66) {
        setVerifyStatus("error");
        setVerifyError("Invalid bytes32 key. Must be 66 characters (0x + 64 hex chars).");
        return;
      }

      const isVerified: boolean = await registry.isVerifiedAgent(key);
      setVerifyStatus(isVerified ? "verified" : "not-registered");
    } catch (err: unknown) {
      setVerifyStatus("error");
      setVerifyError(err instanceof Error ? err.message : "Failed to query contract");
    }
  };

  return (
    <main className="min-h-screen font-[family-name:var(--font-inter)]">
      {/* ───────────────────────── 1. Hero ───────────────────────── */}
      <section className="flex flex-col items-center justify-center text-center px-6 py-24 md:py-32">
        <p className="text-sm font-semibold tracking-widest uppercase text-gray-500 mb-3">
          Proposed Extension to ERC-8004
        </p>
        <h1 className="text-5xl md:text-6xl font-bold max-w-3xl leading-tight mb-6">
          Proof-of-Human for AI&nbsp;Agents
        </h1>
        <p className="text-lg text-gray-600 max-w-2xl mb-10">
          A composable, privacy-preserving standard that lets any smart contract
          or service verify an AI agent is operated by a real, unique human
          &mdash; without revealing who that human is.
        </p>
        <div className="flex flex-col sm:flex-row gap-4">
          <a
            href="#demo"
            className="px-8 py-4 bg-black text-white rounded-lg text-lg font-medium hover:bg-gray-800 transition-colors text-center"
          >
            Try the Demo
          </a>
          <a
            href="#spec"
            className="px-8 py-4 border-2 border-black rounded-lg text-lg font-medium hover:bg-gray-100 transition-colors text-center"
          >
            Read the Spec
          </a>
        </div>
      </section>

      {/* ───────────────────────── 2. Problem ───────────────────────── */}
      <section className="bg-gray-100 px-6 py-20">
        <div className="max-w-3xl mx-auto text-center">
          <h2 className="text-3xl font-bold mb-6">The Problem</h2>
          <p className="text-lg text-gray-700 leading-relaxed">
            AI agents are proliferating across DeFi, governance, and social
            platforms, yet there is no standard way to verify that an agent is
            backed by a real human. Without proof-of-human, autonomous agents
            can impersonate users, execute sybil attacks, and erode trust in
            on-chain interactions. The ecosystem needs a trustless,
            privacy-preserving primitive that protocols can adopt without
            building bespoke identity solutions.
          </p>
        </div>
      </section>

      {/* ───────────────────────── 3. Solution ───────────────────────── */}
      <section className="px-6 py-20">
        <div className="max-w-4xl mx-auto">
          <h2 className="text-3xl font-bold text-center mb-12">How It Works</h2>

          {/* Flow diagram */}
          <div className="flex flex-col md:flex-row items-center justify-center gap-4 mb-16 text-center">
            {[
              { icon: "👤", label: "Human", sub: "Scans passport" },
              { icon: "→", label: "", sub: "" },
              { icon: "🔐", label: "ZK Proof", sub: "Generated locally" },
              { icon: "→", label: "", sub: "" },
              { icon: "📜", label: "SelfAgentRegistry", sub: "On-chain record" },
              { icon: "→", label: "", sub: "" },
              { icon: "✓", label: "Services Verify", sub: "Read contract state" },
            ].map((step, i) =>
              step.icon === "→" ? (
                <span
                  key={i}
                  className="hidden md:block text-2xl text-gray-400 select-none"
                >
                  &rarr;
                </span>
              ) : (
                <div
                  key={i}
                  className="flex flex-col items-center gap-1 px-4 py-3 rounded-lg border border-gray-200 bg-white min-w-[140px]"
                >
                  <span className="text-2xl">{step.icon}</span>
                  <span className="font-semibold text-sm">{step.label}</span>
                  <span className="text-xs text-gray-500">{step.sub}</span>
                </div>
              )
            )}
          </div>

          {/* Properties grid */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
            {[
              {
                title: "Trustless",
                desc: "On-chain verification with no central authority. Any contract can read the registry directly.",
              },
              {
                title: "Private",
                desc: "ZK proofs reveal nothing about the human's identity. Only a nullifier is stored.",
              },
              {
                title: "Composable",
                desc: "A single registry call integrates into any EVM contract, backend service, or agent framework.",
              },
              {
                title: "Sybil-resistant",
                desc: "Each human maps to a unique nullifier, preventing one person from registering unlimited agents.",
              },
            ].map((prop) => (
              <div
                key={prop.title}
                className="border border-gray-200 rounded-lg p-5"
              >
                <h3 className="font-bold mb-2">{prop.title}</h3>
                <p className="text-sm text-gray-600 leading-relaxed">
                  {prop.desc}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ───────────────────────── 4. Use Cases ───────────────────────── */}
      <section className="bg-gray-100 px-6 py-20">
        <div className="max-w-4xl mx-auto">
          <h2 className="text-3xl font-bold text-center mb-10">Use Cases</h2>

          {/* Tabs */}
          <div className="flex justify-center gap-2 mb-8">
            {useCases.map((uc, i) => (
              <button
                key={uc.title}
                onClick={() => setActiveUseCase(i)}
                className={`px-5 py-2 rounded-full text-sm font-medium transition-colors ${
                  i === activeUseCase
                    ? "bg-black text-white"
                    : "bg-white text-gray-700 border border-gray-300 hover:bg-gray-50"
                }`}
              >
                {uc.title}
              </button>
            ))}
          </div>

          {/* Active card */}
          <div className="bg-white rounded-xl border border-gray-200 p-6 md:p-8">
            <h3 className="text-xl font-bold mb-2">
              {useCases[activeUseCase].title}
            </h3>
            <p className="text-gray-600 mb-3">
              {useCases[activeUseCase].description}
            </p>
            <p className="text-sm text-gray-500 italic mb-6">
              {useCases[activeUseCase].flow}
            </p>
            <CodeBlock tabs={useCases[activeUseCase].snippets} />
          </div>
        </div>
      </section>

      {/* ───────────────────────── 5. Live Demo ───────────────────────── */}
      <section id="demo" className="px-6 py-20">
        <div className="max-w-2xl mx-auto">
          <h2 className="text-3xl font-bold text-center mb-4">Live Demo</h2>
          <p className="text-center text-gray-600 mb-10">
            Register a new agent or verify an existing one on Celo Sepolia.
          </p>

          <div className="flex justify-center mb-10">
            <Link
              href="/register"
              className="px-8 py-4 bg-black text-white rounded-lg text-lg font-medium hover:bg-gray-800 transition-colors"
            >
              Register an Agent
            </Link>
          </div>

          {/* Inline verify widget */}
          <div className="border border-gray-200 rounded-xl p-6">
            <h3 className="font-bold text-lg mb-4">Verify an Agent</h3>
            <p className="text-sm text-gray-500 mb-4">
              Paste an agent public key (bytes32) to check its on-chain status.
            </p>
            <div className="flex flex-col sm:flex-row gap-3 mb-4">
              <input
                type="text"
                placeholder="0x00...00 (bytes32)"
                value={pubKeyInput}
                onChange={(e) => {
                  setPubKeyInput(e.target.value);
                  setVerifyStatus("idle");
                }}
                className="flex-1 px-4 py-3 border border-gray-300 rounded-lg text-sm font-mono focus:outline-none focus:border-black"
              />
              <button
                onClick={handleVerify}
                disabled={verifyStatus === "loading"}
                className="px-6 py-3 bg-black text-white rounded-lg font-medium hover:bg-gray-800 transition-colors disabled:opacity-50 whitespace-nowrap"
              >
                {verifyStatus === "loading" ? "Checking..." : "Verify"}
              </button>
            </div>

            {verifyStatus === "verified" && (
              <div className="bg-green-50 border border-green-200 text-green-800 rounded-lg px-4 py-3 text-sm">
                Verified &mdash; this agent is registered and human-backed.
              </div>
            )}
            {verifyStatus === "not-registered" && (
              <div className="bg-yellow-50 border border-yellow-200 text-yellow-800 rounded-lg px-4 py-3 text-sm">
                Not registered &mdash; this public key has no verified agent entry.
              </div>
            )}
            {verifyStatus === "error" && (
              <div className="bg-red-50 border border-red-200 text-red-800 rounded-lg px-4 py-3 text-sm">
                Error: {verifyError}
              </div>
            )}
          </div>
        </div>
      </section>

      {/* ───────────────────────── 6. Interface Spec ───────────────────────── */}
      <section id="spec" className="bg-gray-100 px-6 py-20">
        <div className="max-w-4xl mx-auto">
          <h2 className="text-3xl font-bold text-center mb-4">
            Interface Specification
          </h2>
          <p className="text-center text-gray-600 mb-10">
            Two interfaces define the standard. Any implementation must conform
            to these function signatures.
          </p>

          <div className="space-y-8">
            <div>
              <h3 className="font-bold text-lg mb-3">IERC8004ProofOfHuman</h3>
              <CodeBlock
                tabs={[
                  {
                    label: "Solidity",
                    language: "solidity",
                    code: `// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

/// @title IERC8004ProofOfHuman
/// @notice Registry that maps AI agents to human-backed proofs.
interface IERC8004ProofOfHuman {
    /// @notice Returns true if the agent has a verified human proof.
    function isVerifiedAgent(bytes32 agentPubKey) external view returns (bool);

    /// @notice Returns the token-ID for a given agent public key.
    function getAgentId(bytes32 agentPubKey) external view returns (uint256);

    /// @notice Returns true if the given agent ID has a human proof.
    function hasHumanProof(uint256 agentId) external view returns (bool);

    /// @notice Returns the human nullifier for the given agent ID.
    function getHumanNullifier(uint256 agentId) external view returns (uint256);

    /// @notice Returns how many agents share the same human nullifier.
    function getAgentCountForHuman(uint256 nullifier) external view returns (uint256);

    /// @notice Returns true if two agent IDs share the same human.
    function sameHuman(uint256 agentIdA, uint256 agentIdB) external view returns (bool);

    /// @notice Returns the block timestamp when the agent was registered.
    function agentRegisteredAt(uint256 agentId) external view returns (uint256);
}`,
                  },
                ]}
              />
            </div>

            <div>
              <h3 className="font-bold text-lg mb-3">IHumanProofProvider</h3>
              <CodeBlock
                tabs={[
                  {
                    label: "Solidity",
                    language: "solidity",
                    code: `// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

/// @title IHumanProofProvider
/// @notice Verifies a ZK proof and returns a human nullifier.
interface IHumanProofProvider {
    /// @notice Verifies the proof and returns the human nullifier.
    /// @param proof The ZK proof bytes.
    /// @param publicInputs The public inputs for the proof circuit.
    /// @return nullifier A unique identifier for the human (not linkable to identity).
    function verifyHumanProof(
        bytes calldata proof,
        uint256[] calldata publicInputs
    ) external view returns (uint256 nullifier);
}`,
                  },
                ]}
              />
            </div>
          </div>

          <p className="text-center text-sm text-gray-500 mt-8">
            View the deployed contract on{" "}
            <a
              href="https://celo-sepolia.blockscout.com/address/0x60651482a3033A72128f874623Fc790061cc46D4"
              target="_blank"
              rel="noopener noreferrer"
              className="underline hover:text-black"
            >
              Blockscout
            </a>
            .
          </p>
        </div>
      </section>

      {/* ───────────────────────── 7. Footer ───────────────────────── */}
      <footer className="border-t border-gray-200 px-6 py-10">
        <div className="max-w-4xl mx-auto flex flex-col md:flex-row items-center justify-between gap-6 text-sm text-gray-500">
          <p>
            Built on{" "}
            <a
              href="https://self.xyz"
              target="_blank"
              rel="noopener noreferrer"
              className="underline hover:text-black"
            >
              Self Protocol
            </a>{" "}
            +{" "}
            <a
              href="https://celo.org"
              target="_blank"
              rel="noopener noreferrer"
              className="underline hover:text-black"
            >
              Celo
            </a>
          </p>
          <div className="flex gap-6">
            <Link href="/" className="hover:text-black">
              Home
            </Link>
            <a
              href="https://ethereum-magicians.org"
              target="_blank"
              rel="noopener noreferrer"
              className="hover:text-black"
            >
              Ethereum Magicians
            </a>
            <a
              href="https://docs.self.xyz"
              target="_blank"
              rel="noopener noreferrer"
              className="hover:text-black"
            >
              Self Docs
            </a>
          </div>
        </div>
      </footer>
    </main>
  );
}
