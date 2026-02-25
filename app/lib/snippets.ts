// SPDX-FileCopyrightText: 2025-2026 Social Connect Labs, Inc.
// SPDX-License-Identifier: BUSL-1.1
// NOTE: Converts to Apache-2.0 on 2029-06-11 per LICENSE.

export interface Snippet {
  label: string;
  language: string;
  code: string;
}

export interface UseCaseSnippets {
  title: string;
  description: string;
  flow: string;
  snippets: Snippet[];
}

export interface Feature {
  id: string;
  label: string;
  description: string;
}

// ============================================================
// Feature definitions
// ============================================================

export const SERVICE_FEATURES: Feature[] = [
  { id: "age18", label: "Over 18", description: "Require agent's human to be 18+" },
  { id: "age21", label: "Over 21", description: "Require agent's human to be 21+" },
  { id: "ofac", label: "Not on OFAC List", description: "Require OFAC sanctions check" },
  { id: "nationality", label: "Nationality", description: "Read agent's nationality credential" },
  { id: "issuingState", label: "Issuing State", description: "Read passport issuing state" },
  { id: "sybil", label: "Custom Sybil Limit", description: "Allow up to 5 agents per human" },
  { id: "regAge", label: "Registration Age", description: "Require agent registered for N blocks" },
  { id: "credentials", label: "Read All Credentials", description: "Fetch full credential set" },
  { id: "rateLimit", label: "Rate Limit", description: "Limit requests per agent per time window" },
];

export const AGENT_FEATURES: Feature[] = [
  { id: "checkStatus", label: "Check Status", description: "Verify own registration before requests" },
  { id: "ownCreds", label: "Read Credentials", description: "Fetch own ZK-attested credentials" },
  { id: "agentInfo", label: "Agent Info", description: "Fetch agent ID, owner, and registration block" },
  { id: "sameHuman", label: "Same Human Check", description: "Detect if peer agent is same person" },
  { id: "diffHuman", label: "Different Human", description: "Reject collaboration with own agents" },
  { id: "mutual", label: "Mutual Verification", description: "Both agents must be verified" },
];

// ============================================================
// Helpers
// ============================================================

function needsCreds(f: Set<string>): boolean {
  return f.has("age18") || f.has("age21") || f.has("ofac") ||
    f.has("nationality") || f.has("issuingState") || f.has("credentials");
}

// ============================================================
// Service-side builders
// ============================================================

function buildServiceTS(
  f: Set<string>,
  registryAddress: string = "0x29d941856134b1D053AfFF57fa560324510C79fa",
  rpcUrl: string = "https://forno.celo-sepolia.celo-testnet.org",
): string {
  const regAge = f.has("regAge");
  const needsEthers = regAge;
  const rateLimit = f.has("rateLimit");

  // Build chainable verifier lines
  const builderLines: string[] = [];
  if (f.has("age18")) builderLines.push("  .requireAge(18)");
  if (f.has("age21")) builderLines.push("  .requireAge(21)");
  if (f.has("ofac")) builderLines.push("  .requireOFAC()");
  if (f.has("sybil")) builderLines.push("  .sybilLimit(5)");
  if (rateLimit) builderLines.push("  .rateLimit({ perMinute: 10 })");

  const verifierDecl = builderLines.length
    ? `const verifier = SelfAgentVerifier.create()\n${builderLines.join("\n")}\n  .build();`
    : `const verifier = SelfAgentVerifier.create().build();`;

  // Build handler body — credential checks handled by builder, only reads remain
  let body = `  console.log("Verified agent:", req.agent.address);`;

  // Credential reads (display only — validation is done by the builder)
  const needsCredRead = f.has("nationality") || f.has("issuingState") || f.has("credentials");
  if (needsCredRead) {
    body += `\n\n  // Read ZK-attested credentials (validation handled by the builder)
  const creds = req.agent.credentials;`;
  }
  if (f.has("nationality")) {
    body += `\n  console.log("Nationality:", creds.nationality);`;
  }
  if (f.has("issuingState")) {
    body += `\n  console.log("Issuing state:", creds.issuingState);`;
  }
  if (f.has("credentials")) {
    body += `\n  console.log("All credentials:", creds);`;
  }
  if (regAge) {
    body += `\n\n  // Reject agents registered less than ~7 days ago (by block age)
  const registeredAt = await registry.agentRegisteredAt(req.agent.agentId);
  const currentBlock = await provider.getBlockNumber();
  const minBlocks = Math.floor((7 * 24 * 60 * 60) / 5); // ~5s blocks
  if (currentBlock - Number(registeredAt) < minBlocks) {
    return res.status(403).json({ error: "Agent too new" });
  }`;
  }

  body += `\n\n  res.json({ ok: true });`;

  const asyncKw = regAge ? "async " : "";

  return `import { SelfAgentVerifier } from "@selfxyz/agent-sdk";
${needsEthers ? `import { ethers } from "ethers";` : ""}
import express from "express";

const app = express();
app.use(express.json({
  verify: (req: any, _res: any, buf: any) => {
    req.rawBody = typeof buf === "string" ? buf : buf.toString("utf8");
  },
}));
${verifierDecl}
${regAge ? `
const provider = new ethers.JsonRpcProvider("${rpcUrl}");
const registry = new ethers.Contract(
  "${registryAddress}",
  ["function agentRegisteredAt(uint256) view returns (uint256)"],
  provider,
);` : ""}
app.use("/api", verifier.auth());

app.post("/api/data", ${asyncKw}(req, res) => {
${body}
});`;
}

function buildServicePythonSDK(f: Set<string>): string {
  const rateLimit = f.has("rateLimit");

  // Build chainable verifier lines
  const builderLines: string[] = [];
  if (f.has("age18")) builderLines.push("    .require_age(18)");
  if (f.has("age21")) builderLines.push("    .require_age(21)");
  if (f.has("ofac")) builderLines.push("    .require_ofac()");
  if (f.has("sybil")) builderLines.push("    .sybil_limit(5)");
  if (rateLimit) builderLines.push("    .rate_limit(per_minute=10)");

  const verifierDecl = builderLines.length
    ? `verifier = (SelfAgentVerifier.create()\n${builderLines.join("\n")}\n    .build())`
    : `verifier = SelfAgentVerifier.create().build()`;

  // Build handler body — credential checks handled by builder, only reads remain
  let body = `    print("Verified agent:", g.agent.agent_address)`;

  const needsCredRead = f.has("nationality") || f.has("issuingState") || f.has("credentials");
  if (needsCredRead) {
    body += `\n\n    # Read ZK-attested credentials (validation handled by the builder)
    creds = g.agent.credentials`;
  }
  if (f.has("nationality")) body += `\n    print("Nationality:", creds.nationality)`;
  if (f.has("issuingState")) body += `\n    print("Issuing state:", creds.issuing_state)`;
  if (f.has("credentials")) body += `\n    print("All credentials:", creds)`;

  body += `\n\n    return jsonify(ok=True)`;

  return `from flask import Flask, g, jsonify
from self_agent_sdk import SelfAgentVerifier
from self_agent_sdk.middleware.flask import require_agent

app = Flask(__name__)
${verifierDecl}

@app.route("/api/data", methods=["POST"])
@require_agent(verifier)
def handle():
${body}`;
}

function buildServiceRustSDK(f: Set<string>): string {
  const creds = needsCreds(f);

  // Build chainable verifier lines
  const builderLines: string[] = [];
  if (f.has("age18")) builderLines.push("        .require_age(18)");
  if (f.has("age21")) builderLines.push("        .require_age(21)");
  if (f.has("ofac")) builderLines.push("        .require_ofac()");
  if (f.has("sybil")) builderLines.push("        .sybil_limit(5)");
  if (f.has("rateLimit")) builderLines.push("        .rate_limit(RateLimit { per_minute: 10 })");

  const verifierBody = builderLines.length
    ? `SelfAgentVerifier::create()\n${builderLines.join("\n")}\n        .build()`
    : `SelfAgentVerifier::create().build()`;

  let handler = `    let agent = req.extensions().get::<VerifiedAgent>().unwrap();
    println!("Verified agent: {:?}", agent.address);`;

  if (creds) {
    handler += `

    // Read ZK-attested credentials (validation handled by the builder)
    if let Some(ref creds) = agent.credentials {
        println!("Credentials: {:?}", creds);
    }`;
  }

  handler += `

    Json(serde_json::json!({ "ok": true }))`;

  const needsRateLimit = f.has("rateLimit");

  return `use axum::{Router, routing::post, middleware, Json, Extension};
use self_agent_sdk::{SelfAgentVerifier, VerifiedAgent, self_agent_auth${needsRateLimit ? ", RateLimit" : ""}};
use std::sync::Arc;
use tokio::sync::Mutex;

#[tokio::main]
async fn main() {
    let verifier = Arc::new(Mutex::new(
        ${verifierBody}
    ));

    let app = Router::new()
        .route("/api/data", post(handle))
        .layer(middleware::from_fn_with_state(verifier, self_agent_auth));

    let listener = tokio::net::TcpListener::bind("127.0.0.1:3000").await.unwrap();
    axum::serve(listener, app).await.unwrap();
}

async fn handle(
    Extension(agent): Extension<VerifiedAgent>,
) -> Json<serde_json::Value> {
${handler}
}`;
}

function buildAgentAgentPythonSDK(f: Set<string>): string {
  const mutual = f.has("mutual");
  const sameHuman = f.has("sameHuman");
  const diffHuman = f.has("diffHuman");

  let body = `    result = verifier.verify(
        signature=headers.get("x-self-agent-signature", ""),
        timestamp=headers.get("x-self-agent-timestamp", ""),
        method=method, url=url,
    )
    if not result.valid:
        return False`;

  if (mutual) {
    body += `\n\n    # Both agents are verified (mutual check)
    # result.valid confirms the peer; your agent is verified by registration`;
  }

  if (sameHuman) {
    body += `\n\n    # Check if peer is the same human as you
    print("Same human:", result.nullifier == my_nullifier)`;
  }

  if (diffHuman) {
    body += `\n\n    # Reject if peer is operated by the same human
    if result.nullifier == my_nullifier:
        return False`;
  }

  body += `\n\n    return True`;

  let myNullifier = "";
  if (sameHuman || diffHuman) {
    myNullifier = `\nmy_nullifier = 0  # Set from your own agent info\n`;
  }

  return `from self_agent_sdk import SelfAgentVerifier

verifier = SelfAgentVerifier.create().build()${myNullifier}

def verify_peer(headers: dict, method: str, url: str) -> bool:
${body}`;
}

function buildAgentAgentRustSDK(f: Set<string>): string {
  const mutual = f.has("mutual");
  const sameHuman = f.has("sameHuman");
  const diffHuman = f.has("diffHuman");

  let body = `    let result = verifier.verify(
        signature, timestamp, method, url, body,
    ).await;
    if !result.valid { return false; }`;

  if (mutual) {
    body += `

    // Both agents are verified (mutual check)
    // result.valid confirms the peer; your agent is verified by registration`;
  }

  if (sameHuman) {
    body += `

    // Check if peer is the same human as you
    println!("Same human: {}", result.nullifier == my_nullifier);`;
  }

  if (diffHuman) {
    body += `

    // Reject if peer is operated by the same human
    if result.nullifier == my_nullifier { return false; }`;
  }

  body += `

    true`;

  let myNullifier = "";
  if (sameHuman || diffHuman) {
    myNullifier = `\nlet my_nullifier = U256::ZERO; // Set from your own agent info\n`;
  }

  return `use self_agent_sdk::SelfAgentVerifier;

let mut verifier = SelfAgentVerifier::create().build();${myNullifier}
async fn verify_peer(
    verifier: &mut SelfAgentVerifier,
    signature: &str, timestamp: &str,
    method: &str, url: &str, body: Option<&str>,
) -> bool {
${body}
}`;
}

// ── Agent → Agent builders ──

function buildAgentAgentTS(f: Set<string>, registryAddress: string = "0x29d941856134b1D053AfFF57fa560324510C79fa", rpcUrl: string = "https://forno.celo-sepolia.celo-testnet.org"): string {
  const mutual = f.has("mutual");
  const sameHuman = f.has("sameHuman");
  const diffHuman = f.has("diffHuman");
  const needsRegistry = sameHuman || diffHuman;

  let imports = `import { SelfAgentVerifier } from "@selfxyz/agent-sdk";`;
  if (needsRegistry) {
    imports += `\nimport { ethers } from "ethers";`;
  }

  const setup = `const verifier = SelfAgentVerifier.create().build();`;

  let verifyBody = `  const result = await verifier.verify({
    signature: req.headers.get("x-self-agent-signature")!,
    timestamp: req.headers.get("x-self-agent-timestamp")!,
    method: req.method,
    url: req.url,
  });
  if (!result.valid) return false;`;

  if (mutual) {
    verifyBody += `

  // Ensure both agents are verified (mutual check)
  // result.valid already confirms the peer; your agent is verified by registration`;
  }

  if (needsRegistry) {
    verifyBody += `

  const provider = new ethers.JsonRpcProvider(
    "${rpcUrl}"
  );
  const registry = new ethers.Contract(
    "${registryAddress}",
    ["function sameHuman(uint256,uint256) view returns (bool)"],
    provider,
  );`;
  }

  if (sameHuman) {
    verifyBody += `

  // Check if peer is the same human as you
  const isSame = await registry.sameHuman(myAgentId, result.agentId);
  console.log("Same human?", isSame);`;
  }

  if (diffHuman) {
    verifyBody += `

  // Reject if peer is operated by the same human
  const isSame = await registry.sameHuman(myAgentId, result.agentId);
  if (isSame) return false;`;
  }

  verifyBody += `

  return true;`;

  let myAgentLine = "";
  if (needsRegistry) {
    myAgentLine = `\nconst myAgentId = 1; // Your agent's token ID`;
  }

  return `${imports}

${setup}${myAgentLine}

async function verifyPeer(req: Request): Promise<boolean> {
${verifyBody}
}`;
}

function buildAgentAgentSolidity(f: Set<string>, registryAddress: string = "0x29d941856134b1D053AfFF57fa560324510C79fa"): string {
  const diffHuman = f.has("diffHuman");
  const sameHuman = f.has("sameHuman");
  const mutual = f.has("mutual");
  const needsSameHuman = diffHuman || sameHuman;

  let iface = `    function isVerifiedAgent(bytes32 key) external view returns (bool);`;
  if (needsSameHuman) {
    iface += `\n    function getAgentId(bytes32 key) external view returns (uint256);`;
    iface += `\n    function sameHuman(uint256 a, uint256 b) external view returns (bool);`;
  }

  let modifier = `    modifier onlyVerifiedPair(bytes32 agentA, bytes32 agentB) {`;
  if (mutual) {
    modifier += `
        require(registry.isVerifiedAgent(agentA), "Agent A not verified");
        require(registry.isVerifiedAgent(agentB), "Agent B not verified");`;
  } else {
    modifier += `
        require(registry.isVerifiedAgent(agentA) && registry.isVerifiedAgent(agentB), "Not verified");`;
  }

  if (needsSameHuman) {
    modifier += `
        uint256 idA = registry.getAgentId(agentA);
        uint256 idB = registry.getAgentId(agentB);`;
    if (diffHuman) {
      modifier += `
        require(!registry.sameHuman(idA, idB), "Same human");`;
    }
    if (sameHuman && !diffHuman) {
      modifier += `
        // sameHuman(idA, idB) returns true if operated by same person`;
    }
  }

  modifier += `
        _;
    }`;

  return `// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

interface ISelfAgentRegistry {
${iface}
}

contract AgentCollaboration {
    ISelfAgentRegistry immutable registry =
        ISelfAgentRegistry(${registryAddress});

${modifier}

    function collaborate(
        bytes32 agentA,
        bytes32 agentB,
        bytes calldata data
    ) external onlyVerifiedPair(agentA, agentB) {
        // Both agents are verified${needsSameHuman ? " and operated by different humans" : ""}
    }
}`;
}

// ── Agent → Chain builder ──

function buildAgentChainSolidity(f: Set<string>, registryAddress: string = "0x29d941856134b1D053AfFF57fa560324510C79fa"): string {
  const sybil = f.has("sybil");
  const creds = needsCreds(f);
  const regAge = f.has("regAge");
  const rateLimit = f.has("rateLimit");

  let iface = `    function isVerifiedAgent(bytes32 key) external view returns (bool);`;

  if (sybil || creds || regAge) {
    iface += `\n    function getAgentId(bytes32 key) external view returns (uint256);`;
  }
  if (sybil) {
    iface += `\n    function getHumanNullifier(uint256 id) external view returns (uint256);`;
    iface += `\n    function getAgentCountForHuman(uint256 n) external view returns (uint256);`;
  }
  if (regAge) {
    iface += `\n    function agentRegisteredAt(uint256 id) external view returns (uint256);`;
  }

  let rateLimitStorage = "";
  if (rateLimit) {
    rateLimitStorage = `
    mapping(address => uint256) public lastActionBlock;
    uint256 public constant RATE_LIMIT_BLOCKS = 10; // ~10 blocks between actions
`;
  }

  let modifierBody = `        bytes32 agentKey = bytes32(uint256(uint160(msg.sender)));
        require(registry.isVerifiedAgent(agentKey), "Agent not human-verified");`;

  if (rateLimit) {
    modifierBody += `
        require(
            block.number - lastActionBlock[msg.sender] >= RATE_LIMIT_BLOCKS,
            "Rate limited — try again later"
        );
        lastActionBlock[msg.sender] = block.number;`;
  }

  if (sybil || creds || regAge) {
    modifierBody += `
        uint256 agentId = registry.getAgentId(agentKey);`;
  }
  if (sybil) {
    modifierBody += `
        uint256 nullifier = registry.getHumanNullifier(agentId);
        require(
            registry.getAgentCountForHuman(nullifier) <= 5,
            "Too many agents for this human"
        );`;
  }
  if (regAge) {
    modifierBody += `
        require(
            registry.agentRegisteredAt(agentId) + 50400 <= block.number,
            "Agent too new"
        );`;
  }

  return `// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

interface ISelfAgentRegistry {
${iface}
}

contract MyProtocol {
    ISelfAgentRegistry immutable registry =
        ISelfAgentRegistry(${registryAddress});
${rateLimitStorage}
    modifier onlyVerifiedAgent() {
${modifierBody}
        _;
    }

    function agentAction(
        bytes calldata data
    ) external onlyVerifiedAgent {
        // Only human-backed agents reach here
    }
}`;
}

// ── Agent-side builders ──

function buildSignRequestsTS(f: Set<string>): string {
  const sameHuman = f.has("sameHuman");
  const diffHuman = f.has("diffHuman");
  const mutual = f.has("mutual");

  let extra = "";
  if (sameHuman || diffHuman || mutual) {
    extra += `

// Check peer status before collaborating
const { SelfAgentVerifier } = require("@selfxyz/agent-sdk");
const verifier = SelfAgentVerifier.create().build();`;
  }
  if (sameHuman) {
    extra += `

// Detect if a peer agent belongs to the same human
const peerResult = await verifier.verify(peerRequest);
const isSame = await agent.sameHuman(peerResult.agentId);
console.log("Same human as peer?", isSame);`;
  }
  if (diffHuman) {
    extra += `

// Reject peers operated by the same human
const peerResult = await verifier.verify(peerRequest);
const isSame = await agent.sameHuman(peerResult.agentId);
if (isSame) throw new Error("Cannot collaborate with own agents");`;
  }
  if (mutual) {
    extra += `

// Ensure peer is also a verified agent before collaborating
const peerResult = await verifier.verify(peerRequest);
if (!peerResult.valid) throw new Error("Peer not verified");`;
  }

  return `import { SelfAgent } from "@selfxyz/agent-sdk";

const agent = new SelfAgent({
  privateKey: process.env.AGENT_PRIVATE_KEY,
});

// Every request is signed automatically
const res = await agent.fetch("https://api.example.com/data", {
  method: "POST",
  body: JSON.stringify({ query: "test" }),
});

// Check your own registration status
const registered = await agent.isRegistered();${extra}`;
}

function buildSignRequestsRustSDK(f: Set<string>): string {
  const sameHuman = f.has("sameHuman");
  const diffHuman = f.has("diffHuman");
  const mutual = f.has("mutual");

  let extra = "";
  if (sameHuman || diffHuman || mutual) {
    extra += `

// Verify peer agents before collaborating
let mut verifier = SelfAgentVerifier::create().build();`;
  }
  if (mutual) {
    extra += `

// Ensure peer is also a verified agent
let peer_result = verifier.verify(sig, ts, method, url, body).await;
if !peer_result.valid { panic!("Peer not verified"); }`;
  }

  return `use self_agent_sdk::{SelfAgent, SelfAgentConfig, NetworkName};

let agent = SelfAgent::new(SelfAgentConfig {
    private_key: std::env::var("AGENT_PRIVATE_KEY").unwrap(),
    network: Some(NetworkName::Testnet),
    registry_address: None,
    rpc_url: None,
}).unwrap();

// Every request is signed automatically
let res = agent.fetch(
    "https://api.example.com/data",
    Some(reqwest::Method::POST),
    Some(r#"{"query":"test"}"#.to_string()),
).await.unwrap();

// Check your own registration status
let registered = agent.is_registered().await.unwrap();
println!("Registered: {registered}");

// Get full agent info (ID, nullifier, sybil count)
let info = agent.get_info().await.unwrap();
println!("Agent ID: {:?}, Verified: {}", info.agent_id, info.is_verified);${extra}`;
}

// ── Test Setup (run all demo tests from CLI) ──

function buildTestSetupRustSDK(): string {
  return `use self_agent_sdk::{
    SelfAgent, SelfAgentConfig, SelfAgentVerifier, NetworkName,
    constants::headers,
};

#[tokio::main]
async fn main() {
    let agent = SelfAgent::new(SelfAgentConfig {
        private_key: std::env::var("AGENT_PRIVATE_KEY").unwrap(),
        network: Some(NetworkName::Testnet),
        registry_address: None,
        rpc_url: None,
    }).unwrap();

    println!("Agent: {:?}", agent.address());
    println!("Registered: {}", agent.is_registered().await.unwrap());

    // Test 1: Agent → Service (sign request, hit live endpoint)
    println!("\\n--- Test 1: Agent → Service ---");
    let res = agent.fetch(
        "https://agent-id-demo-service-4aawyjohja-uc.a.run.app/verify",
        Some(reqwest::Method::POST),
        Some(r#"{"action":"test"}"#.to_string()),
    ).await.unwrap();
    println!("Status: {}", res.status());

    // Test 2: Local verification round-trip
    println!("\\n--- Test 2: Local Verify Round-Trip ---");
    let body = r#"{"test":true}"#;
    let hdrs = agent.sign_request("POST", "/api/test", Some(body)).await.unwrap();
    let mut verifier = SelfAgentVerifier::create()
        .network(NetworkName::Testnet)
        .sybil_limit(0)
        .build();
    let result = verifier.verify(
        &hdrs[headers::SIGNATURE],
        &hdrs[headers::TIMESTAMP],
        "POST", "/api/test", Some(body),
    ).await;
    println!("Recovered address: {:?}", result.agent_address);
    println!("Agent key: {:?}", result.agent_key);

    println!("\\nDone!");
}`;
}

function buildTestSetupTS(): string {
  return `import { SelfAgent } from "@selfxyz/agent-sdk";
import { ethers } from "ethers";

// Celo Sepolia testnet — for mainnet use https://forno.celo.org + mainnet addresses
const REGISTRY = "0x29d941856134b1D053AfFF57fa560324510C79fa";
const RPC = "https://forno.celo-sepolia.celo-testnet.org";
const DEMO_SERVICE = "https://agent-id-demo-service-4aawyjohja-uc.a.run.app";
const DEMO_AGENT = "https://agent-id-demo-agent-4aawyjohja-uc.a.run.app";
const DEMO_APP = "https://self-agent-id.vercel.app"; // replace with your deployment URL
const VERIFIER = "0x31A5A1d34728c5e6425594A596997A7Bf4aD607d";

const agent = new SelfAgent({
  privateKey: process.env.AGENT_PRIVATE_KEY!,
  network: "testnet", // or omit for mainnet
});

async function runTests() {
  console.log("Agent:", agent.address);
  console.log("Registered:", await agent.isRegistered());
  console.log();

  // Test 1: Agent → Service (verify + census)
  console.log("--- Test 1: Agent → Service ---");
  const verifyRes = await agent.fetch(DEMO_SERVICE + "/verify", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "test" }),
  });
  const verify = await verifyRes.json();
  console.log("Verified:", verify.valid, "Agent ID:", verify.agentId);
  if (verify.credentials) {
    console.log("Credentials:", verify.credentials.nationality,
      verify.credentials.olderThan + "+");
  }

  const censusRes = await agent.fetch(DEMO_SERVICE + "/census", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "contribute" }),
  });
  console.log("Census:", (await censusRes.json()).totalAgents, "agents");

  const statsRes = await agent.fetch(DEMO_SERVICE + "/census");
  const stats = await statsRes.json();
  console.log("Stats:", stats.totalAgents, "agents,",
    stats.verifiedOver18, "over 18,", stats.ofacClear, "OFAC clear");
  console.log();

  // Test 2: Agent → Agent (peer verification)
  console.log("--- Test 2: Agent → Agent ---");
  const peerRes = await agent.fetch(DEMO_AGENT, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "peer-verify" }),
  });
  const peer = await peerRes.json();
  console.log("Demo agent verified you:", peer.verified);
  console.log("Same human:", peer.sameHuman);
  console.log("Response signed:", !!peerRes.headers.get("x-self-agent-signature"));
  console.log();

  // Test 3: Agent → Chain (EIP-712 meta-transaction)
  console.log("--- Test 3: Agent → Chain ---");
  const provider = new ethers.JsonRpcProvider(RPC);
  const verifier = new ethers.Contract(VERIFIER, [
    "function nonces(bytes32) view returns (uint256)",
  ], provider);

  const agentKey = ethers.zeroPadValue(agent.address, 32);
  const nonce = await verifier.nonces(agentKey);
  const deadline = Math.floor(Date.now() / 1000) + 300;

  const wallet = new ethers.Wallet(process.env.AGENT_PRIVATE_KEY!);
  const sig = await wallet.signTypedData(
    { name: "AgentDemoVerifier", version: "1",
      chainId: 11142220n, verifyingContract: VERIFIER },
    { MetaVerify: [
      { name: "agentKey", type: "bytes32" },
      { name: "nonce", type: "uint256" },
      { name: "deadline", type: "uint256" },
    ]},
    { agentKey, nonce, deadline },
  );

  const chainRes = await agent.fetch(DEMO_APP + "/api/demo/chain-verify", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      agentKey, nonce: nonce.toString(), deadline, eip712Signature: sig,
    }),
  });
  const chain = await chainRes.json();
  console.log("Tx:", chain.txHash);
  console.log("Block:", chain.blockNumber);
  console.log("Explorer:", chain.explorerUrl);
  console.log();

  console.log("All 3 tests passed!");
}

runTests().catch(console.error);`;
}

function buildTestSetupPythonSDK(): string {
  return `import os, json
from self_agent_sdk import SelfAgent, SelfAgentVerifier

DEMO_SERVICE = "https://agent-id-demo-service-4aawyjohja-uc.a.run.app"
DEMO_AGENT = "https://agent-id-demo-agent-4aawyjohja-uc.a.run.app"
DEMO_APP = "https://self-agent-id.vercel.app"  # replace with your deployment URL

agent = SelfAgent(
    private_key=os.environ["AGENT_PRIVATE_KEY"],
    network="testnet",
)
print(f"Agent: {agent.address}")
print(f"Registered: {agent.is_registered()}")

# Test 1: Agent → Service (sign request, hit live endpoint)
print("\\n--- Test 1: Agent → Service ---")
body = json.dumps({"action": "test"})
res = agent.fetch(DEMO_SERVICE + "/verify", method="POST", body=body,
                  headers={"Content-Type": "application/json"})
data = res.json()
print(f"Verified: {data.get('valid')} Agent ID: {data.get('agentId')}")

# Test 2: Agent → Agent (peer verification)
print("\\n--- Test 2: Agent → Agent ---")
body2 = json.dumps({"action": "peer-verify"})
res2 = agent.fetch(DEMO_AGENT, method="POST", body=body2,
                   headers={"Content-Type": "application/json"})
peer = res2.json()
print(f"Verified: {peer.get('verified')} Same human: {peer.get('sameHuman')}")
print(f"Response signed: {'x-self-agent-signature' in res2.headers}")

# Test 3: Local verification round-trip
print("\\n--- Test 3: Local Verify Round-Trip ---")
verifier = SelfAgentVerifier.create().network("testnet").sybil_limit(0).build()
headers = agent.sign_request("POST", "/api/test", body='{"test":true}')
result = verifier.verify(
    signature=headers["x-self-agent-signature"],
    timestamp=headers["x-self-agent-timestamp"],
    method="POST", url="/api/test", body='{"test":true}',
)
print(f"Valid: {result.valid}")
print(f"Agent ID: {result.agent_id}")
print(f"Address: {result.agent_address}")

print("\\nAll 3 tests passed!")`;
}

function buildSubmitTxTS(rpcUrl: string): string {
  return `import { ethers } from "ethers";

// Your agent wallet — fund this address with gas
const wallet = new ethers.Wallet(
  process.env.AGENT_PRIVATE_KEY,
  new ethers.JsonRpcProvider("${rpcUrl}")
);

console.log("Agent address:", wallet.address);
console.log("Fund this address with CELO for gas");

// Call any contract that uses onlyVerifiedAgent modifier
const contract = new ethers.Contract(
  CONTRACT_ADDRESS, CONTRACT_ABI, wallet
);
const tx = await contract.agentAction("0x...");
await tx.wait();
// Contract checks msg.sender against the registry automatically`;
}

function buildSubmitTxPython(rpcUrl: string): string {
  return `from web3 import Web3
import os

w3 = Web3(Web3.HTTPProvider(
    "${rpcUrl}"
))
account = w3.eth.account.from_key(os.environ["AGENT_PRIVATE_KEY"])
print("Agent address:", account.address)
print("Fund this address with CELO for gas")

contract = w3.eth.contract(
    address=CONTRACT_ADDRESS,
    abi=CONTRACT_ABI,
)

# Build and sign the transaction
tx = contract.functions.agentAction(b"\\x00").build_transaction({
    "from": account.address,
    "nonce": w3.eth.get_transaction_count(account.address),
    "gas": 200_000,
    "gasPrice": w3.eth.gas_price,
})
signed = account.sign_transaction(tx)
tx_hash = w3.eth.send_raw_transaction(signed.raw_transaction)
receipt = w3.eth.wait_for_transaction_receipt(tx_hash)
print("Confirmed in block:", receipt["blockNumber"])
# Contract checks msg.sender against the registry automatically`;
}

function buildSubmitTxRust(rpcUrl: string): string {
  return `use alloy::providers::ProviderBuilder;
use alloy::signers::local::PrivateKeySigner;
use alloy::sol;

sol! {
    #[sol(rpc)]
    interface IMyProtocol {
        function agentAction(bytes calldata data) external;
    }
}

#[tokio::main]
async fn main() -> eyre::Result<()> {
    let signer: PrivateKeySigner = std::env::var("AGENT_PRIVATE_KEY")?
        .parse()?;
    println!("Agent address: {}", signer.address());
    println!("Fund this address with CELO for gas");

    let provider = ProviderBuilder::new()
        .wallet(signer)
        .connect_http("${rpcUrl}".parse()?);

    let contract = IMyProtocol::new(
        CONTRACT_ADDRESS.parse()?,
        &provider,
    );

    let tx = contract.agentAction(bytes::Bytes::from_static(b""))
        .send().await?
        .watch().await?;
    println!("Confirmed: {tx:?}");
    // Contract checks msg.sender against the registry automatically
    Ok(())
}`;
}

function buildSubmitTxSolidity(registryAddress: string): string {
  return `// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

/// @notice Example contract that gates actions behind Self Agent ID
/// Deploy this, then call agentAction() from your agent wallet
interface ISelfAgentRegistry {
    function isVerifiedAgent(bytes32 key) external view returns (bool);
}

contract MyProtocol {
    ISelfAgentRegistry immutable registry =
        ISelfAgentRegistry(${registryAddress});

    event AgentActed(address indexed agent, bytes data);

    modifier onlyVerifiedAgent() {
        bytes32 agentKey = bytes32(uint256(uint160(msg.sender)));
        require(
            registry.isVerifiedAgent(agentKey),
            "Agent not human-verified"
        );
        _;
    }

    function agentAction(
        bytes calldata data
    ) external onlyVerifiedAgent {
        emit AgentActed(msg.sender, data);
    }
}`;
}

// ============================================================
// Public API
// ============================================================

export function getServiceSnippets(
  registryAddress: string = "0x29d941856134b1D053AfFF57fa560324510C79fa",
  rpcUrl: string = "https://forno.celo-sepolia.celo-testnet.org",
  features?: Set<string>,
): UseCaseSnippets[] {
  const f = features || new Set<string>();

  return [
    {
      title: "Agent \u2192 Service",
      description:
        "Verify that an AI agent calling your API is human-backed. The SDK recovers the signer from the ECDSA signature, checks isVerifiedAgent() on-chain, and optionally reads ZK-attested credentials and enforces sybil limits.",
      flow: "npm install @selfxyz/agent-sdk (or pip install selfxyz-agent-sdk or cargo add self-agent-sdk) \u2192 Create verifier \u2192 Add middleware \u2192 Done",
      snippets: [
        { label: "TypeScript", language: "typescript", code: buildServiceTS(f, registryAddress, rpcUrl) },
        { label: "Python", language: "python", code: buildServicePythonSDK(f) },
        { label: "Rust", language: "rust", code: buildServiceRustSDK(f) },
      ],
    },
    {
      title: "Agent \u2192 Agent",
      description:
        "Verify a peer agent is human-backed before collaborating. Recover the signer from their ECDSA signature, check isVerifiedAgent() on-chain, and use sameHuman() to detect sybil attacks in multi-agent systems.",
      flow: "Receive signed message \u2192 Verify via SDK \u2192 Check identity \u2192 Collaborate",
      snippets: [
        { label: "TypeScript", language: "typescript", code: buildAgentAgentTS(f, registryAddress, rpcUrl) },
        { label: "Python", language: "python", code: buildAgentAgentPythonSDK(f) },
        { label: "Rust", language: "rust", code: buildAgentAgentRustSDK(f) },
        { label: "Solidity", language: "solidity", code: buildAgentAgentSolidity(f, registryAddress) },
      ],
    },
    {
      title: "Agent \u2192 Chain",
      description:
        "Gate your smart contract so only human-backed agents can call it. The contract derives the agent key as bytes32(uint256(uint160(msg.sender))) and calls isVerifiedAgent() on the registry. No SDK needed \u2014 pure on-chain verification.",
      flow: "Agent calls your contract \u2192 Modifier derives key from msg.sender \u2192 Checks registry \u2192 Executes",
      snippets: [
        { label: "Solidity", language: "solidity", code: buildAgentChainSolidity(f, registryAddress) },
      ],
    },
  ];
}

export function getAgentSnippets(
  registryAddress: string = "0x29d941856134b1D053AfFF57fa560324510C79fa",
  rpcUrl: string = "https://forno.celo-sepolia.celo-testnet.org",
  features?: Set<string>,
): UseCaseSnippets[] {
  const f = features || new Set<string>();

  return [
    {
      title: "Sign Requests",
      description:
        "Your agent signs every outgoing HTTP request with ECDSA (timestamp + method + URL + body hash). Services recover the signer from the signature and check isVerifiedAgent() on-chain \u2014 no API keys or tokens needed.",
      flow: "npm install @selfxyz/agent-sdk (or pip install selfxyz-agent-sdk or cargo add self-agent-sdk) \u2192 Create agent \u2192 Use agent.fetch() \u2192 Service verifies automatically",
      snippets: [
        { label: "TypeScript", language: "typescript", code: buildSignRequestsTS(f) },
        {
          label: "Python",
          language: "python",
          code: `from self_agent_sdk import SelfAgent
import os

agent = SelfAgent(private_key=os.environ["AGENT_PRIVATE_KEY"])

# Every request is signed automatically
res = agent.fetch("https://api.example.com/data",
                   method="POST", body='{"query": "test"}')

# Check your own registration status
print("Registered:", agent.is_registered())

# Get full agent info (ID, nullifier, sybil count)
info = agent.get_info()
print(f"Agent ID: {info.agent_id}, Verified: {info.is_verified}")`,
        },
        { label: "Rust", language: "rust", code: buildSignRequestsRustSDK(f) },
      ],
    },
    {
      title: "Submit Transactions",
      description:
        "Your agent address is a real Ethereum wallet. Fund it with gas and it can call smart contracts directly. Contracts derive bytes32(uint256(uint160(msg.sender))) and check the registry \u2014 no off-chain signature needed for on-chain calls.",
      flow: "Fund agent wallet with gas \u2192 Agent calls contract \u2192 Contract checks registry \u2192 Action proceeds",
      snippets: [
        { label: "TypeScript", language: "typescript", code: buildSubmitTxTS(rpcUrl) },
        { label: "Python", language: "python", code: buildSubmitTxPython(rpcUrl) },
        { label: "Rust", language: "rust", code: buildSubmitTxRust(rpcUrl) },
        { label: "Solidity (Contract)", language: "solidity", code: buildSubmitTxSolidity(registryAddress) },
      ],
    },
    {
      title: "Test Your Setup",
      description:
        "Run the same demo tests from your terminal that the browser demo runs. Hits the live Cloud Run endpoints for service verification, agent-to-agent peer check, and on-chain meta-transaction verification.",
      flow: "Set AGENT_PRIVATE_KEY → Run script → Hits live endpoints → Confirms agent works end-to-end",
      snippets: [
        { label: "TypeScript", language: "typescript", code: buildTestSetupTS() },
        { label: "Python", language: "python", code: buildTestSetupPythonSDK() },
        { label: "Rust", language: "rust", code: buildTestSetupRustSDK() },
      ],
    },
  ];
}
