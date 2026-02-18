"use client";

import { useState } from "react";
import Link from "next/link";
import { ethers } from "ethers";
import CodeBlock from "@/components/CodeBlock";
import { getServiceSnippets } from "@/lib/snippets";
import { REGISTRY_ADDRESS, REGISTRY_ABI, RPC_URL } from "@/lib/constants";

const useCases = getServiceSnippets();

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

      let keyHash: string;
      if (key.length === 66) {
        keyHash = key;
      } else if (key.length === 42) {
        keyHash = ethers.zeroPadValue(key, 32);
      } else {
        setVerifyStatus("error");
        setVerifyError("Enter an address (0x + 40 hex) or bytes32 key (0x + 64 hex).");
        return;
      }

      const isVerified: boolean = await registry.isVerifiedAgent(keyHash);
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
        <p className="text-sm font-semibold tracking-widest uppercase text-black mb-3">
          Proposed Extension to ERC-8004
        </p>
        <h1 className="text-5xl md:text-6xl font-bold max-w-3xl leading-tight mb-6">
          Proof-of-Human for AI&nbsp;Agents
        </h1>
        <p className="text-lg text-black max-w-2xl mb-10">
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
          <a
            href="https://github.com/selfxyz/self-agent-id"
            target="_blank"
            rel="noopener noreferrer"
            className="px-8 py-4 border-2 border-black rounded-lg text-lg font-medium text-black hover:bg-gray-100 transition-colors text-center"
          >
            GitHub
          </a>
        </div>
      </section>

      {/* ───────────────────────── 2. Problem ───────────────────────── */}
      <section className="bg-gray-100 px-6 py-20">
        <div className="max-w-3xl mx-auto text-center">
          <h2 className="text-3xl font-bold mb-6">The Problem</h2>
          <p className="text-lg text-gray-800 leading-relaxed">
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
                  <span className="font-semibold text-sm text-black">{step.label}</span>
                  <span className="text-xs text-gray-800">{step.sub}</span>
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
                <p className="text-sm text-gray-900 leading-relaxed">
                  {prop.desc}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ───────────────────────── 4. Security Model ───────────────────────── */}
      <section className="bg-gray-100 px-6 py-20">
        <div className="max-w-4xl mx-auto">
          <h2 className="text-3xl font-bold text-center mb-4">Security Model</h2>
          <p className="text-center text-black max-w-2xl mx-auto mb-12">
            The registry supports two registration modes. Both produce the same
            on-chain result &mdash; a verified, sybil-resistant agent NFT &mdash;
            but they differ in who holds the agent&apos;s private key.
          </p>

          {/* Two modes side-by-side */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-12">
            {/* Simple Mode */}
            <div className="bg-white rounded-xl border border-gray-200 p-6">
              <div className="flex items-center gap-2 mb-4">
                <span className="text-xl">👤</span>
                <h3 className="font-bold text-lg text-black">Simple Mode</h3>
                <span className="text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded-full font-medium">
                  live
                </span>
              </div>
              <p className="text-sm text-black font-medium mb-2">
                Wallet = Agent Identity
              </p>
              <p className="text-sm text-black mb-4">
                The human&apos;s Self wallet address becomes the agent key. No extra
                keypair to manage &mdash; ideal for single-agent setups and quick
                integrations.
              </p>
              <div className="bg-gray-50 rounded-lg p-3 mb-4">
                <p className="text-xs font-mono text-black">
                  agentKey = bytes32(uint256(uint160(<span className="text-green-700">walletAddress</span>)))
                </p>
              </div>
              <div className="space-y-2 text-sm text-black">
                <p className="font-bold text-black">How it&apos;s secured:</p>
                <ul className="list-disc list-inside space-y-1 text-black">
                  <li>Key is derived <em>inside</em> the contract callback &mdash; can&apos;t be spoofed</li>
                  <li>ZK proof binds wallet address to human nullifier</li>
                  <li>Off-chain: SDK signs requests with wallet key; services recover signer from ECDSA signature</li>
                </ul>
              </div>
              <div className="mt-4 pt-4 border-t border-gray-100">
                <p className="text-xs text-black">
                  <strong>Best for:</strong> Single agent per user, quick setup, on-chain
                  gating where <code className="bg-gray-100 px-1 rounded">msg.sender</code> is
                  the agent.
                </p>
              </div>
            </div>

            {/* Advanced Mode */}
            <div className="bg-white rounded-xl border border-gray-200 p-6">
              <div className="flex items-center gap-2 mb-4">
                <span className="text-xl">🔑</span>
                <h3 className="font-bold text-lg text-black">Advanced Mode</h3>
                <span className="text-xs bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full font-medium">
                  v2
                </span>
              </div>
              <p className="text-sm text-black font-medium mb-2">
                Independent Agent Key
              </p>
              <p className="text-sm text-black mb-4">
                The agent generates its own keypair. During registration, the agent
                signs a challenge proving it controls the key. The human proves humanity
                via Self, and the agent proves key ownership via ECDSA &mdash; both in
                a single QR scan.
              </p>
              <div className="bg-gray-50 rounded-lg p-3 mb-4">
                <p className="text-xs font-mono text-black">
                  agentKey = bytes32(uint256(uint160(<span className="text-blue-700">agentAddress</span>)))
                </p>
              </div>
              <div className="space-y-2 text-sm text-black">
                <p className="font-bold text-black">How it&apos;s secured:</p>
                <ul className="list-disc list-inside space-y-1 text-black">
                  <li>ECDSA signature in registration proves agent key ownership</li>
                  <li>ZK proof binds human identity to nullifier</li>
                  <li>Off-chain: agent signs requests with its <em>own</em> key &mdash; human wallet never exposed</li>
                </ul>
              </div>
              <div className="mt-4 pt-4 border-t border-gray-100">
                <p className="text-xs text-black">
                  <strong>Best for:</strong> Multiple agents per user, key rotation,
                  delegation, autonomous agents that operate independently.
                </p>
              </div>
            </div>
          </div>

          {/* Shared security layers */}
          <div className="space-y-10">
            <div>
              <h3 className="font-bold text-lg text-black mb-3">Off-Chain: Request Signing</h3>
              <p className="text-black mb-4">
                The on-chain registry proves <em>&ldquo;this address is human-backed.&rdquo;</em>{" "}
                But when an agent makes an API call, the service needs to prove{" "}
                <em>&ldquo;this request actually came from that address.&rdquo;</em>{" "}
                Without this, anyone could claim to be a registered agent.
              </p>
              <p className="text-black mb-4">
                The SDK solves this with ECDSA request signing. In both modes, the
                flow is the same:
              </p>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
                <div className="bg-white rounded-lg border border-gray-200 p-4">
                  <p className="font-bold text-sm text-black mb-2">Agent Side</p>
                  <p className="text-sm text-black">
                    Signs each request with the agent&apos;s private key (wallet key in simple
                    mode, independent key in advanced mode). The signature covers the
                    timestamp, HTTP method, URL, and body hash &mdash; preventing replay
                    and tampering.
                  </p>
                </div>
                <div className="bg-white rounded-lg border border-gray-200 p-4">
                  <p className="font-bold text-sm text-black mb-2">Service Side</p>
                  <p className="text-sm text-black">
                    Recovers the signer address from the ECDSA signature (cryptographic,
                    can&apos;t be faked), converts it to a bytes32 key, and checks{" "}
                    <code className="bg-gray-100 px-1 rounded">isVerifiedAgent()</code>{" "}
                    on-chain.
                  </p>
                </div>
              </div>
              <p className="text-black">
                The signer&apos;s identity is <strong>recovered from the signature itself</strong>,
                never trusted from a header. This closes the off-chain verification gap
                completely.
              </p>
            </div>

            {/* Sybil resistance */}
            <div>
              <h3 className="font-bold text-lg text-black mb-3">Sybil Resistance</h3>
              <p className="text-black mb-4">
                Each human gets a unique, privacy-preserving nullifier derived from their
                passport. The registry tracks how many agents share each nullifier.
                Services can enforce their own limits:
              </p>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="bg-white rounded-lg border border-gray-200 p-4">
                  <p className="font-bold text-sm text-black mb-1">Strict (max 1)</p>
                  <p className="text-xs text-black">
                    One agent per human. Best for governance voting, airdrops, and
                    any context where uniqueness matters.
                  </p>
                </div>
                <div className="bg-white rounded-lg border border-gray-200 p-4">
                  <p className="font-bold text-sm text-black mb-1">Moderate (max N)</p>
                  <p className="text-xs text-black">
                    Allow a few agents per human. Good for agent marketplaces where
                    one person might run multiple bots.
                  </p>
                </div>
                <div className="bg-white rounded-lg border border-gray-200 p-4">
                  <p className="font-bold text-sm text-black mb-1">Detection only</p>
                  <p className="text-xs text-black">
                    Allow unlimited but flag duplicates with{" "}
                    <code className="bg-gray-100 px-1 rounded text-xs">sameHuman()</code>.
                    Good for analytics and reputation.
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ───────────────────────── 5. Use Cases ───────────────────────── */}
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
                    : "bg-white text-black border border-gray-300 hover:bg-gray-50"
                }`}
              >
                {uc.title}
              </button>
            ))}
          </div>

          {/* Active card */}
          <div className="bg-white rounded-xl border border-gray-200 p-6 md:p-8">
            <h3 className="text-xl font-bold text-black mb-2">
              {useCases[activeUseCase].title}
            </h3>
            <p className="text-black mb-3">
              {useCases[activeUseCase].description}
            </p>
            <p className="text-sm text-black italic mb-6">
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
          <p className="text-center text-black mb-10">
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
            <p className="text-sm text-black mb-4">
              Paste an agent address or bytes32 key to check its on-chain status.
            </p>
            <div className="flex flex-col sm:flex-row gap-3 mb-4">
              <input
                type="text"
                placeholder="0x... (address or bytes32)"
                value={pubKeyInput}
                onChange={(e) => {
                  setPubKeyInput(e.target.value);
                  setVerifyStatus("idle");
                }}
                className="flex-1 px-4 py-3 border border-gray-300 rounded-lg text-sm font-mono text-black focus:outline-none focus:border-black"
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
          <p className="text-center text-black mb-10">
            This extension adds proof-of-human capabilities to the ERC-8004 Agent
            Registry standard. The additions are shown below.
          </p>

          <div className="space-y-8">
            <div>
              <h3 className="font-bold text-lg mb-2 text-black">ERC-8004 Base Standard</h3>
              <p className="text-sm text-gray-900 mb-3">
                The base agent registry that every ERC-8004 implementation provides.
              </p>
              <CodeBlock
                tabs={[
                  {
                    label: "Solidity",
                    language: "solidity",
                    code: `/// @title IERC8004 — Agent Registry (Base Standard)
interface IERC8004 {
    function registerAgent(bytes32 agentPubKey) external returns (uint256);
    function getAgentId(bytes32 agentPubKey) external view returns (uint256);
    function ownerOf(uint256 agentId) external view returns (address);
}`,
                  },
                ]}
              />
            </div>

            <div>
              <h3 className="font-bold text-lg mb-2 text-black">
                Proof-of-Human Extension
                <span className="ml-2 text-xs font-normal bg-green-100 text-green-700 px-2 py-0.5 rounded-full">
                  new
                </span>
              </h3>
              <p className="text-sm text-gray-900 mb-3">
                These functions are added on top of ERC-8004 to provide
                human-verification guarantees. Any protocol can query these to
                check if an agent is backed by a verified human.
              </p>
              <CodeBlock
                tabs={[
                  {
                    label: "Solidity",
                    language: "solidity",
                    code: `/// @title IERC8004ProofOfHuman — Extension Interface
/// @notice Adds proof-of-human verification to ERC-8004 agents.
interface IERC8004ProofOfHuman is IERC8004 {
    // ── Registration ──────────────────────────────
    function registerWithHumanProof(
        string calldata agentMetadata,
        address proofProvider,
        bytes calldata proof,
        bytes calldata providerData
    ) external returns (uint256 agentId);

    function revokeHumanProof(
        uint256 agentId,
        address proofProvider,
        bytes calldata proof,
        bytes calldata providerData
    ) external;

    // ── Verification (read by any service/contract) ─
    function isVerifiedAgent(bytes32 agentPubKey) external view returns (bool);
    function hasHumanProof(uint256 agentId) external view returns (bool);
    function getHumanNullifier(uint256 agentId) external view returns (uint256);
    function getProofProvider(uint256 agentId) external view returns (address);

    // ── Sybil detection ───────────────────────────
    function getAgentCountForHuman(uint256 nullifier) external view returns (uint256);
    function sameHuman(uint256 a, uint256 b) external view returns (bool);
}`,
                  },
                ]}
              />
            </div>

            <div>
              <h3 className="font-bold text-lg mb-2 text-black">
                IHumanProofProvider
                <span className="ml-2 text-xs font-normal bg-green-100 text-green-700 px-2 py-0.5 rounded-full">
                  new
                </span>
              </h3>
              <p className="text-sm text-gray-900 mb-3">
                Pluggable interface for identity verification backends. Self
                Protocol is the reference provider; any ZK identity system can
                implement this.
              </p>
              <CodeBlock
                tabs={[
                  {
                    label: "Solidity",
                    language: "solidity",
                    code: `/// @title IHumanProofProvider
/// @notice Pluggable identity backend for proof-of-human.
interface IHumanProofProvider {
    /// @notice Verify a ZK proof and return (success, nullifier).
    function verifyHumanProof(
        bytes calldata proof,
        bytes calldata providerData
    ) external returns (bool verified, uint256 nullifier);

    /// @notice Human-readable provider name (e.g. "Self Protocol").
    function providerName() external view returns (string memory);

    /// @notice Verification strength score (0-100).
    function verificationStrength() external view returns (uint256);
}`,
                  },
                ]}
              />
            </div>
          </div>

          <div className="flex flex-col items-center gap-2 mt-8">
            <p className="text-center text-sm text-black">
              View the reference implementation on{" "}
              <a
                href="https://github.com/selfxyz/self-agent-id"
                target="_blank"
                rel="noopener noreferrer"
                className="underline hover:text-black"
              >
                GitHub
              </a>{" "}
              or the deployed contract on{" "}
              <a
                href="https://celo-sepolia.blockscout.com/address/0x404A2Bce7Dc4A9c19Cc41c4247E2bA107bce394C"
                target="_blank"
                rel="noopener noreferrer"
                className="underline hover:text-black"
              >
                Blockscout
              </a>
              .
            </p>
          </div>
        </div>
      </section>

      {/* ───────────────────────── 7. Footer ───────────────────────── */}
      <footer className="border-t border-gray-200 px-6 py-10">
        <div className="max-w-4xl mx-auto flex flex-col md:flex-row items-center justify-between gap-6 text-sm text-black">
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
              href="https://github.com/selfxyz/self-agent-id"
              target="_blank"
              rel="noopener noreferrer"
              className="hover:text-black"
            >
              GitHub
            </a>
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
