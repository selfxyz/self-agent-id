// SPDX-FileCopyrightText: 2025-2026 Social Connect Labs, Inc.
// SPDX-License-Identifier: BUSL-1.1
// NOTE: Converts to Apache-2.0 on 2029-06-11 per LICENSE.

"use client";

import { ExternalLink, GitPullRequest } from "lucide-react";
import { Card } from "@/components/Card";
import { Badge } from "@/components/Badge";
import { Button } from "@/components/Button";
import CodeBlock from "@/components/CodeBlock";
import { useNetwork } from "@/lib/NetworkContext";

export default function ERC8004Page() {
  const { network } = useNetwork();
  return (
    <main className="min-h-screen max-w-3xl mx-auto px-6 pt-24 pb-12 space-y-12">
      {/* Header */}
      <div className="text-center">
        <Badge variant="info" className="mb-4">
          Proposed Optional Extension
        </Badge>
        <h1 className="text-3xl sm:text-4xl font-bold tracking-tight text-foreground mb-4">
          ERC-8004 Proof-of-Human
        </h1>
        <p className="text-lg text-muted max-w-2xl mx-auto">
          An optional extension to ERC-8004 that adds on-chain, privacy-preserving
          proof-of-human verification for AI agents, proposed as a new section in the
          EIP, similar to how ERC-721 defines optional Metadata and Enumerable extensions.
        </p>
      </div>

      {/* What is ERC-8004 */}
      <section className="space-y-4">
        <h2 className="text-2xl font-bold">What is ERC-8004?</h2>
        <p className="text-muted leading-relaxed">
          ERC-8004 is a proposed standard for on-chain AI agent registries. It defines
          a minimal interface for registering agents, assigning them unique IDs (as NFTs),
          and looking up agent ownership. Think of it as ENS for AI agents: a
          universal, composable identity layer.
        </p>
        <CodeBlock
          tabs={[
            {
              label: "IERC8004 (Base)",
              language: "solidity",
              code: `/// @title IERC8004 - Agent Registry (Base Standard)
/// @notice Minimal interface for on-chain agent registration
interface IERC8004 {
    /// @notice Register a new agent with a public key
    function registerAgent(bytes32 agentPubKey) external returns (uint256 agentId);

    /// @notice Look up an agent's ID by public key
    function getAgentId(bytes32 agentPubKey) external view returns (uint256);

    /// @notice Get the owner of an agent (ERC-721)
    function ownerOf(uint256 agentId) external view returns (address);
}`,
            },
          ]}
        />
        <p className="text-sm text-muted">
          The base standard is intentionally minimal. It doesn&apos;t specify <em>how</em> agents
          are verified or <em>who</em> operates them. That&apos;s where optional extensions come in.
        </p>
      </section>

      {/* The Problem */}
      <section className="space-y-4">
        <h2 className="text-2xl font-bold">The Problem</h2>
        <Card>
          <p className="text-muted leading-relaxed">
            ERC-8004 registers agents, but it doesn&apos;t answer the critical question:
            <strong className="text-foreground"> &ldquo;Is this agent operated by a real human?&rdquo;</strong>
          </p>
          <p className="text-muted leading-relaxed mt-3">
            Without proof-of-human, anyone can register unlimited agents, enabling sybil attacks,
            bot farms, and impersonation. Protocols that gate access to &ldquo;verified agents&rdquo;
            have no standard way to check humanity. Each project builds its own solution,
            fragmenting the ecosystem and creating integration overhead.
          </p>
        </Card>
      </section>

      {/* Our Proposal */}
      <section className="space-y-4">
        <h2 className="text-2xl font-bold">Our Proposal</h2>
        <p className="text-muted leading-relaxed">
          We propose <strong className="text-foreground">IERC8004ProofOfHuman</strong>, an
          optional extension interface that adds proof-of-human verification as a first-class,
          composable property of agent identity. Registries that need human verification
          implement this alongside the base standard. Three design principles:
        </p>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Card glow>
            <h3 className="font-bold mb-2">Provider-Agnostic</h3>
            <p className="text-sm text-muted">
              Any ZK identity system (Self Protocol, World ID, Humanity Protocol)
              can implement <code className="bg-surface-2 font-mono text-accent-2 px-1 rounded text-xs">IHumanProofProvider</code>.
              The registry doesn&apos;t care <em>how</em> humanity is proven.
            </p>
          </Card>
          <Card glow>
            <h3 className="font-bold mb-2">Sybil-Resistant</h3>
            <p className="text-sm text-muted">
              Each human produces a unique, scoped nullifier. The registry tracks
              agent counts per nullifier. Services choose their own limits (1, N, or unlimited).
            </p>
          </Card>
          <Card glow>
            <h3 className="font-bold mb-2">Privacy-Preserving</h3>
            <p className="text-sm text-muted">
              Only a nullifier is stored on-chain. No name, no passport number,
              no biometrics. ZK proofs verify humanity without revealing identity.
            </p>
          </Card>
        </div>
      </section>

      {/* The Interface */}
      <section className="space-y-4">
        <h2 className="text-2xl font-bold">The Interface</h2>

        <div className="space-y-6">
          <div>
            <div className="flex items-center gap-2 mb-2">
              <h3 className="font-bold text-lg">IERC8004ProofOfHuman</h3>
              <Badge variant="success">proposed extension</Badge>
            </div>
            <p className="text-sm text-muted mb-3">
              Extends ERC-8004 with human verification, sybil detection, and provider management.
              Registries opt in by implementing this interface alongside the base standard.
            </p>
            <CodeBlock
              tabs={[
                {
                  label: "Solidity",
                  language: "solidity",
                  code: `/// @title IERC8004ProofOfHuman
/// @notice Optional extension to ERC-8004 adding proof-of-human verification
interface IERC8004ProofOfHuman is IERC8004 {
    // ── Registration ──────────────────────────────────────
    /// @notice Register an agent with verifiable proof-of-human
    function registerWithHumanProof(
        string calldata agentURI,
        address proofProvider,
        bytes calldata proof,
        bytes calldata providerData
    ) external returns (uint256 agentId);

    /// @notice Revoke an agent's human proof (same nullifier required)
    function revokeHumanProof(
        uint256 agentId,
        address proofProvider,
        bytes calldata proof,
        bytes calldata providerData
    ) external;

    // ── Verification (read by any service/contract) ──────
    /// @notice Check if an agent has verified proof-of-human
    function hasHumanProof(uint256 agentId) external view returns (bool);

    /// @notice Get the nullifier for an agent
    function getHumanNullifier(uint256 agentId) external view returns (uint256);

    /// @notice Get which provider verified this agent
    function getProofProvider(uint256 agentId) external view returns (address);

    // ── Sybil detection ──────────────────────────────────
    /// @notice Count active agents for a human (by nullifier)
    function getAgentCountForHuman(uint256 nullifier) external view returns (uint256);

    /// @notice Check if two agents are backed by the same human
    function sameHuman(uint256 a, uint256 b) external view returns (bool);

    // ── Provider management ──────────────────────────────
    /// @notice Check if a proof provider is whitelisted
    function isApprovedProvider(address provider) external view returns (bool);
}`,
                },
              ]}
            />
          </div>

          <div>
            <div className="flex items-center gap-2 mb-2">
              <h3 className="font-bold text-lg">IHumanProofProvider</h3>
              <Badge variant="success">proposed extension</Badge>
            </div>
            <p className="text-sm text-muted mb-3">
              Pluggable interface for identity verification backends. Any ZK identity
              system can implement this to serve as a proof provider.
            </p>
            <CodeBlock
              tabs={[
                {
                  label: "Solidity",
                  language: "solidity",
                  code: `/// @title IHumanProofProvider
/// @notice Pluggable identity backend for proof-of-human
interface IHumanProofProvider {
    /// @notice Verify a ZK proof and return (success, nullifier)
    /// @dev The nullifier must be deterministic: same human + same scope
    ///      always produces the same nullifier.
    function verifyHumanProof(
        bytes calldata proof,
        bytes calldata data
    ) external returns (bool verified, uint256 nullifier);

    /// @notice Human-readable provider name (e.g. "Self Protocol")
    function providerName() external view returns (string memory);

    /// @notice Verification strength score (0-100)
    /// @dev 100 = passport/NFC chip, 60 = government ID, 40 = liveness check
    function verificationStrength() external view returns (uint8);
}`,
                },
              ]}
            />
          </div>
        </div>
      </section>

      {/* Why This Matters */}
      <section className="space-y-4">
        <h2 className="text-2xl font-bold">Why Standardize This?</h2>
        <div className="space-y-3">
          {[
            {
              title: "Composability",
              desc: "Any protocol can check hasHumanProof() or sameHuman() with a single contract call. No custom integrations needed.",
            },
            {
              title: "Provider competition",
              desc: "Multiple identity providers can compete on verification quality. Services choose which providers they trust via the whitelist.",
            },
            {
              title: "Future-proof",
              desc: "New ZK identity systems can plug in by implementing IHumanProofProvider. The extension interface stays stable.",
            },
            {
              title: "Interoperability",
              desc: "Agent identities are portable across chains and applications. The sameHuman() check enables cross-protocol reputation.",
            },
          ].map((item) => (
            <Card key={item.title}>
              <h3 className="font-bold mb-1">{item.title}</h3>
              <p className="text-sm text-muted">{item.desc}</p>
            </Card>
          ))}
        </div>
      </section>

      {/* Full ERC-8004 Provider Coverage */}
      <section className="space-y-4">
        <h2 className="text-2xl font-bold">Full ERC-8004 Provider Coverage</h2>
        <p className="text-muted">
          ERC-8004 defines three registry types. Self Agent ID implements all three as on-chain contracts:
        </p>
        <div className="grid gap-4 md:grid-cols-3">
          <Card>
            <Badge variant="success" className="mb-2">Identity</Badge>
            <p className="font-bold text-sm">SelfAgentRegistry</p>
            <p className="text-xs text-muted mt-1">
              Agent NFT minting, human proof storage, ZK-attested credentials, and metadata (A2A Agent Cards).
            </p>
          </Card>
          <Card>
            <Badge variant="info" className="mb-2">Reputation</Badge>
            <p className="font-bold text-sm">SelfReputationProvider</p>
            <p className="text-xs text-muted mt-1">
              Reads <code className="text-accent-2">verificationStrength()</code> from the proof provider.
              Supports batch queries across multiple agents.
            </p>
          </Card>
          <Card>
            <Badge variant="muted" className="mb-2">Validation</Badge>
            <p className="font-bold text-sm">SelfValidationProvider</p>
            <p className="text-xs text-muted mt-1">
              Real-time proof validation with configurable freshness threshold (default: ~1 year).
            </p>
          </Card>
        </div>

        <Card>
          <p className="font-bold text-sm mb-2">Agent Cards as agentURI</p>
          <p className="text-xs text-muted mb-3">
            A2A Agent Cards are stored on-chain in <code className="text-accent-2">agentMetadata</code>.
            A stateless API reads the blockchain and serves the data as HTTP JSON. That URL becomes the
            agent&apos;s <code className="text-accent-2">agentURI</code> in ERC-8004.
          </p>
          <pre className="bg-surface-2 border border-border rounded p-3 text-xs overflow-auto">
{`GET /api/cards/{chainId}/{agentId}  → Agent Card JSON
GET /api/reputation/{chainId}/{agentId}  → { score, proofType }
GET /.well-known/a2a/{agentId}?chain={chainId}  → Redirect to card resolver`}</pre>
          <p className="text-xs text-muted mt-3">
            For fully on-chain contexts, the SDK generates <code className="text-accent-2">data:application/json;base64,...</code> URIs.
          </p>
        </Card>
      </section>

      {/* Reference Implementation */}
      <section className="space-y-4">
        <h2 className="text-2xl font-bold">Reference Implementation</h2>
        <div className="flex items-start gap-3">
          <a href="https://self.xyz" target="_blank" rel="noopener noreferrer" className="flex-shrink-0 mt-1">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/self-icon.png" alt="Self Protocol" width={40} height={40} className="rounded-lg" />
          </a>
          <p className="text-muted leading-relaxed">
            We&apos;ve built a complete reference implementation using{" "}
            <a href="https://self.xyz" target="_blank" rel="noopener noreferrer" className="text-foreground hover:text-accent transition-colors font-bold">Self Protocol</a> as the proof provider,
            deployed on {network.isTestnet ? "Celo Sepolia" : "Celo"}. It supports four registration modes (verified wallet,
            agent identity, wallet-free, and passkey smart wallet) with full sybil resistance and ZK privacy.
          </p>
        </div>
        <div className="flex flex-wrap gap-3">
          <a
            href={`${network.blockExplorer}/address/${network.registryAddress}`}
            target="_blank"
            rel="noopener noreferrer"
          >
            <Button variant="secondary" size="sm">
              <ExternalLink size={14} />
              Registry on {network.isTestnet ? "Blockscout" : "Celoscan"}
            </Button>
          </a>
          <a
            href="https://github.com/selfxyz/self-agent-id"
            target="_blank"
            rel="noopener noreferrer"
          >
            <Button variant="secondary" size="sm">
              <ExternalLink size={14} />
              Source Code
            </Button>
          </a>
        </div>
      </section>

      {/* PR Link */}
      <section className="space-y-4">
        <h2 className="text-2xl font-bold">EIP Proposal</h2>
        <Card variant="warn">
          <div className="flex items-start gap-3">
            <GitPullRequest size={24} className="text-accent-warn flex-shrink-0 mt-0.5" />
            <div>
              <p className="font-bold mb-1">Pull Request: Coming Soon</p>
              <p className="text-sm text-muted">
                We&apos;re preparing a PR to the ERC-8004 EIP document proposing
                proof-of-human as an optional extension section, similar to
                how ERC-721 defines optional Metadata and Enumerable extensions
                within the same EIP. The PR will include the full interface
                specification, rationale, security considerations, and a link to
                our reference implementation.
              </p>
              <a
                href="#"
                className="inline-flex items-center gap-1 mt-3 text-sm text-accent hover:text-accent-2 transition-colors"
              >
                <GitPullRequest size={14} />
                PR link will be added here
              </a>
            </div>
          </div>
        </Card>
      </section>
    </main>
  );
}
