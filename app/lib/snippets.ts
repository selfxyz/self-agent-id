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

function buildServiceTS(f: Set<string>): string {
  const creds = needsCreds(f);
  const sybil = f.has("sybil");

  let verifierOpts = "";
  if (sybil) {
    verifierOpts = `{\n  maxAgentsPerHuman: 5,\n}`;
  }

  const rateLimit = f.has("rateLimit");

  let body = `  console.log("Verified agent:", req.agent.address);`;

  if (rateLimit) {
    body += `\n\n  // Rate limit: 10 requests per agent per minute
  const key = \`rate:\${req.agent.address}\`;
  const count = (rateLimiter.get(key) ?? 0) + 1;
  rateLimiter.set(key, count);
  setTimeout(() => rateLimiter.set(key, (rateLimiter.get(key) ?? 1) - 1), 60_000);
  if (count > 10) return res.status(429).json({ error: "Rate limit exceeded" });`;
  }

  if (creds) {
    body += `\n\n  // Read ZK-attested credentials
  const creds = await req.agent.getCredentials();`;
  }
  if (f.has("age18")) {
    body += `\n  if (creds.olderThan < 18) return res.status(403).json({ error: "Must be 18+" });`;
  }
  if (f.has("age21")) {
    body += `\n  if (creds.olderThan < 21) return res.status(403).json({ error: "Must be 21+" });`;
  }
  if (f.has("ofac")) {
    body += `\n  if (!creds.ofac) return res.status(403).json({ error: "OFAC check failed" });`;
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
  if (f.has("regAge")) {
    body += `\n\n  // Reject agents registered less than 7 days ago
  if (req.agent.registeredAt > Date.now() - 7 * 24 * 3600 * 1000) {
    return res.status(403).json({ error: "Agent too new" });
  }`;
  }

  body += `\n\n  res.json({ ok: true });`;

  const asyncKw = creds ? "async " : "";

  let rateLimiterDecl = "";
  if (rateLimit) {
    rateLimiterDecl = `\nconst rateLimiter = new Map<string, number>();\n`;
  }

  return `import { SelfAgentVerifier } from "@selfxyz/agent-sdk";
import express from "express";

const app = express();
const verifier = new SelfAgentVerifier(${verifierOpts});${rateLimiterDecl}

app.use("/api", verifier.auth());

app.post("/api/data", ${asyncKw}(req, res) => {
${body}
});`;
}

function buildServicePython(f: Set<string>, registryAddress: string = "0x42CEA1b318557aDE212bED74FC3C7f06Ec52bd5b", rpcUrl: string = "https://forno.celo-sepolia.celo-testnet.org"): string {
  const creds = needsCreds(f);
  const sybil = f.has("sybil");
  const regAge = f.has("regAge");

  let abiEntries = `    {"name": "isVerifiedAgent", "type": "function", "stateMutability": "view",
     "inputs": [{"type": "bytes32"}], "outputs": [{"type": "bool"}]},`;

  if (sybil || creds || regAge) {
    abiEntries += `
    {"name": "getAgentId", "type": "function", "stateMutability": "view",
     "inputs": [{"type": "bytes32"}], "outputs": [{"type": "uint256"}]},`;
  }
  if (sybil) {
    abiEntries += `
    {"name": "getHumanNullifier", "type": "function", "stateMutability": "view",
     "inputs": [{"type": "uint256"}], "outputs": [{"type": "uint256"}]},
    {"name": "getAgentCountForHuman", "type": "function", "stateMutability": "view",
     "inputs": [{"type": "uint256"}], "outputs": [{"type": "uint256"}]},`;
  }
  if (creds) {
    abiEntries += `
    {"name": "getAgentCredentials", "type": "function", "stateMutability": "view",
     "inputs": [{"type": "uint256"}],
     "outputs": [{"type": "tuple", "components": [
       {"name": "issuingState", "type": "string"},
       {"name": "name", "type": "string[]"},
       {"name": "idNumber", "type": "string"},
       {"name": "nationality", "type": "string"},
       {"name": "dateOfBirth", "type": "string"},
       {"name": "gender", "type": "string"},
       {"name": "expiryDate", "type": "string"},
       {"name": "olderThan", "type": "uint256"},
       {"name": "ofac", "type": "bool[]"}
     ]}]},`;
  }
  if (regAge) {
    abiEntries += `
    {"name": "agentRegisteredAt", "type": "function", "stateMutability": "view",
     "inputs": [{"type": "uint256"}], "outputs": [{"type": "uint256"}]},`;
  }

  const rateLimit = f.has("rateLimit");

  let body = `    if not verified:
        return False`;

  if (rateLimit) {
    body += `

    # Rate limit: 10 requests per agent per minute
    now = time.time()
    key = address.lower()
    timestamps = rate_limiter.get(key, [])
    timestamps = [t for t in timestamps if now - t < 60]
    if len(timestamps) >= 10:
        return False
    timestamps.append(now)
    rate_limiter[key] = timestamps`;
  }

  if (sybil || creds || regAge) {
    body += `

    agent_id = registry.functions.getAgentId(agent_key).call()`;
  }
  if (sybil) {
    body += `
    nullifier = registry.functions.getHumanNullifier(agent_id).call()
    count = registry.functions.getAgentCountForHuman(nullifier).call()
    if count > 5:
        return False`;
  }
  if (creds) {
    body += `

    creds = registry.functions.getAgentCredentials(agent_id).call()`;
  }
  if (f.has("age18")) {
    body += `
    if creds[7] < 18:  # olderThan
        return False`;
  }
  if (f.has("age21")) {
    body += `
    if creds[7] < 21:  # olderThan
        return False`;
  }
  if (f.has("ofac")) {
    body += `
    if not creds[8][0]:  # ofac
        return False`;
  }
  if (f.has("nationality")) {
    body += `
    print("Nationality:", creds[3])`;
  }
  if (f.has("issuingState")) {
    body += `
    print("Issuing state:", creds[0])`;
  }
  if (f.has("credentials")) {
    body += `
    print("All credentials:", creds)`;
  }
  if (regAge) {
    body += `

    reg_block = registry.functions.agentRegisteredAt(agent_id).call()
    current_block = w3.eth.block_number
    if current_block - reg_block < 50400:  # ~7 days on Celo
        return False`;
  }

  body += `

    return True`;

  let rateLimiterDecl = "";
  if (rateLimit) {
    rateLimiterDecl = `\nrate_limiter: dict[str, list[float]] = {}\n`;
  }

  return `import time
from web3 import Web3
from eth_account.messages import encode_defunct

w3 = Web3(Web3.HTTPProvider(
    "${rpcUrl}"
))
REGISTRY = "${registryAddress}"
REGISTRY_ABI = [
${abiEntries}
]
registry = w3.eth.contract(address=REGISTRY, abi=REGISTRY_ABI)${rateLimiterDecl}

def verify_agent(address: str, signature: str, ts: str,
                 method: str, url: str) -> bool:
    if time.time() * 1000 - int(ts) > 5 * 60 * 1000:
        return False
    message = encode_defunct(text=ts + method + url)
    recovered = w3.eth.account.recover_message(message, signature=signature)
    if recovered.lower() != address.lower():
        return False
    agent_key = w3.to_bytes(hexstr=address).rjust(32, b"\\x00")
    verified = registry.functions.isVerifiedAgent(agent_key).call()

${body}`;
}

function buildServiceRust(f: Set<string>, registryAddress: string = "0x42CEA1b318557aDE212bED74FC3C7f06Ec52bd5b", rpcUrl: string = "https://forno.celo-sepolia.celo-testnet.org"): string {
  const creds = needsCreds(f);
  const sybil = f.has("sybil");
  const regAge = f.has("regAge");

  let iface = `        function isVerifiedAgent(bytes32) external view returns (bool);`;
  if (sybil || creds || regAge) {
    iface += `\n        function getAgentId(bytes32) external view returns (uint256);`;
  }
  if (sybil) {
    iface += `\n        function getHumanNullifier(uint256) external view returns (uint256);`;
    iface += `\n        function getAgentCountForHuman(uint256) external view returns (uint256);`;
  }
  if (regAge) {
    iface += `\n        function agentRegisteredAt(uint256) external view returns (uint256);`;
  }

  const rateLimit = f.has("rateLimit");

  let checks = `    if !registry.isVerifiedAgent(key).call().await.unwrap()._0 {
        return false;
    }`;

  if (rateLimit) {
    checks += `

    // Rate limit: 10 requests per agent per minute
    // (use a concurrent HashMap or Redis in production)`;
  }

  if (sybil || creds || regAge) {
    checks += `
    let id = registry.getAgentId(key).call().await.unwrap()._0;`;
  }
  if (sybil) {
    checks += `
    let nullifier = registry.getHumanNullifier(id).call().await.unwrap()._0;
    let count = registry.getAgentCountForHuman(nullifier).call().await.unwrap()._0;
    if count > alloy::primitives::U256::from(5) {
        return false;
    }`;
  }
  if (regAge) {
    checks += `
    let reg_block = registry.agentRegisteredAt(id).call().await.unwrap()._0;
    // Check agent has been registered for at least ~7 days
    // (compare with current block in production)`;
  }
  if (creds) {
    checks += `
    // Fetch credentials via getAgentCredentials(id) for further checks`;
  }

  return `use alloy::primitives::{Address, FixedBytes};
use alloy::providers::ProviderBuilder;
use alloy::sol;

sol! {
    #[sol(rpc)]
    interface ISelfAgentRegistry {
${iface}
    }
}

async fn verify_agent(
    agent_address: Address,
    signature: &[u8],
    timestamp: &str,
    method: &str,
    url: &str,
) -> bool {
    // 1. Check timestamp freshness
    let ts: u64 = timestamp.parse().unwrap_or(0);
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH).unwrap().as_millis() as u64;
    if now - ts > 5 * 60 * 1000 { return false; }

    // 2. Recover signer from EIP-191 signature
    let message = format!("{}{}{}", timestamp, method.to_uppercase(), url);
    // ... recover signer and verify it matches agent_address ...

    // 3. Check on-chain
    let provider = ProviderBuilder::new()
        .on_http("${rpcUrl}".parse().unwrap());
    let registry = ISelfAgentRegistry::new(
        "${registryAddress}".parse().unwrap(),
        &provider,
    );
    let key = FixedBytes::left_padding_from(&agent_address.0 .0);
${checks}

    true
}`;
}

// ── Agent → Agent builders ──

function buildAgentAgentTS(f: Set<string>, registryAddress: string = "0x42CEA1b318557aDE212bED74FC3C7f06Ec52bd5b", rpcUrl: string = "https://forno.celo-sepolia.celo-testnet.org"): string {
  const mutual = f.has("mutual");
  const sameHuman = f.has("sameHuman");
  const diffHuman = f.has("diffHuman");
  const needsRegistry = sameHuman || diffHuman;

  let imports = `import { SelfAgentVerifier } from "@selfxyz/agent-sdk";`;
  if (needsRegistry) {
    imports += `\nimport { ethers } from "ethers";`;
  }

  const setup = `const verifier = new SelfAgentVerifier();`;

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

function buildAgentAgentSolidity(f: Set<string>, registryAddress: string = "0x42CEA1b318557aDE212bED74FC3C7f06Ec52bd5b"): string {
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

function buildAgentChainSolidity(f: Set<string>, registryAddress: string = "0x42CEA1b318557aDE212bED74FC3C7f06Ec52bd5b"): string {
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
const verifier = new SelfAgentVerifier();`;
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

// ── Test Setup (run all demo tests from CLI) ──

function buildTestSetupTS(): string {
  return `import { SelfAgent } from "@selfxyz/agent-sdk";
import { ethers } from "ethers";

const REGISTRY = "0x42CEA1b318557aDE212bED74FC3C7f06Ec52bd5b";
const RPC = "https://forno.celo-sepolia.celo-testnet.org";
const DEMO_SERVICE = "https://agent-id-demo-service-4aawyjohja-uc.a.run.app";
const DEMO_AGENT = "https://agent-id-demo-agent-4aawyjohja-uc.a.run.app";
const DEMO_APP = "https://agent-id.self.xyz"; // chain-verify relayer
const VERIFIER = "0xD8ec054FD869A762bC977AC328385142303c7def";

const agent = new SelfAgent({
  privateKey: process.env.AGENT_PRIVATE_KEY!,
  registryAddress: REGISTRY,
  rpcUrl: RPC,
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

function buildTestSetupPython(): string {
  return `import time, json, os, requests, struct
from web3 import Web3
from eth_account import Account
from eth_account.messages import encode_defunct, encode_structured_data

REGISTRY = "0x42CEA1b318557aDE212bED74FC3C7f06Ec52bd5b"
RPC = "https://forno.celo-sepolia.celo-testnet.org"
DEMO_SERVICE = "https://agent-id-demo-service-4aawyjohja-uc.a.run.app"
DEMO_AGENT = "https://agent-id-demo-agent-4aawyjohja-uc.a.run.app"
DEMO_APP = "https://agent-id.self.xyz"
VERIFIER = "0xD8ec054FD869A762bC977AC328385142303c7def"

agent = Account.from_key(os.environ["AGENT_PRIVATE_KEY"])
w3 = Web3(Web3.HTTPProvider(RPC))

def sign_request(method: str, url: str, body: str = ""):
    ts = str(int(time.time() * 1000))
    body_hash = Web3.keccak(text=body).hex() if body else Web3.keccak(text="").hex()
    msg = Web3.keccak(text=ts + method.upper() + url + body_hash)
    sig = agent.sign_message(encode_defunct(msg)).signature.hex()
    return {
        "x-self-agent-address": agent.address,
        "x-self-agent-signature": "0x" + sig,
        "x-self-agent-timestamp": ts,
    }

print(f"Agent: {agent.address}")

# Test 1: Agent → Service
print("\\n--- Test 1: Agent → Service ---")
body = json.dumps({"action": "test"})
headers = {**sign_request("POST", DEMO_SERVICE + "/verify", body),
           "Content-Type": "application/json"}
r = requests.post(DEMO_SERVICE + "/verify", headers=headers, data=body)
data = r.json()
print(f"Verified: {data.get('valid')} Agent ID: {data.get('agentId')}")

body2 = json.dumps({"action": "contribute"})
headers2 = {**sign_request("POST", DEMO_SERVICE + "/census", body2),
            "Content-Type": "application/json"}
r2 = requests.post(DEMO_SERVICE + "/census", headers=headers2, data=body2)
print(f"Census: {r2.json().get('totalAgents')} agents")

headers3 = sign_request("GET", DEMO_SERVICE + "/census")
r3 = requests.get(DEMO_SERVICE + "/census", headers=headers3)
stats = r3.json()
print(f"Stats: {stats.get('totalAgents')} agents, "
      f"{stats.get('verifiedOver18')} over 18")

# Test 2: Agent → Agent
print("\\n--- Test 2: Agent → Agent ---")
body4 = json.dumps({"action": "peer-verify"})
headers4 = {**sign_request("POST", DEMO_AGENT, body4),
            "Content-Type": "application/json"}
r4 = requests.post(DEMO_AGENT, headers=headers4, data=body4)
peer = r4.json()
print(f"Verified: {peer.get('verified')} Same human: {peer.get('sameHuman')}")
print(f"Response signed: {'x-self-agent-signature' in r4.headers}")

# Test 3: Agent → Chain (EIP-712 meta-transaction)
print("\\n--- Test 3: Agent → Chain ---")
verifier_abi = [{"name": "nonces", "type": "function",
    "stateMutability": "view",
    "inputs": [{"type": "bytes32"}], "outputs": [{"type": "uint256"}]}]
verifier = w3.eth.contract(address=VERIFIER, abi=verifier_abi)
agent_key = b"\\x00" * 12 + bytes.fromhex(agent.address[2:])
nonce = verifier.functions.nonces(agent_key).call()
deadline = int(time.time()) + 300

typed_data = {
    "types": {
        "EIP712Domain": [
            {"name": "name", "type": "string"},
            {"name": "version", "type": "string"},
            {"name": "chainId", "type": "uint256"},
            {"name": "verifyingContract", "type": "address"},
        ],
        "MetaVerify": [
            {"name": "agentKey", "type": "bytes32"},
            {"name": "nonce", "type": "uint256"},
            {"name": "deadline", "type": "uint256"},
        ],
    },
    "primaryType": "MetaVerify",
    "domain": {
        "name": "AgentDemoVerifier", "version": "1",
        "chainId": 11142220,
        "verifyingContract": VERIFIER,
    },
    "message": {
        "agentKey": agent_key,
        "nonce": nonce,
        "deadline": deadline,
    },
}
sig712 = agent.sign_message(
    encode_structured_data(typed_data)
).signature.hex()

body5 = json.dumps({
    "agentKey": "0x" + agent_key.hex(),
    "nonce": str(nonce), "deadline": deadline,
    "eip712Signature": "0x" + sig712,
})
headers5 = {**sign_request("POST", DEMO_APP + "/api/demo/chain-verify", body5),
            "Content-Type": "application/json"}
r5 = requests.post(DEMO_APP + "/api/demo/chain-verify",
                    headers=headers5, data=body5)
chain = r5.json()
print(f"Tx: {chain.get('txHash')}")
print(f"Block: {chain.get('blockNumber')}")
print(f"Explorer: {chain.get('explorerUrl')}")

print("\\nAll 3 tests passed!")`;
}

function buildTestSetupBash(): string {
  return `#!/bin/bash
# Run Self Agent ID demo tests
# Requires: AGENT_PRIVATE_KEY env var, node + npm
# Install SDK: npm install @selfxyz/agent-sdk ethers

DEMO_SERVICE="https://agent-id-demo-service-4aawyjohja-uc.a.run.app"
DEMO_AGENT="https://agent-id-demo-agent-4aawyjohja-uc.a.run.app"
DEMO_APP="https://agent-id.self.xyz"

# Quick test: health endpoints (no auth needed)
echo "--- Health Checks ---"
curl -s "$DEMO_SERVICE/health" | jq .
curl -s "$DEMO_AGENT/health" | jq .

# Full test suite (all 3 tests including on-chain)
echo ""
echo "--- Full Test Suite (3 tests) ---"
npx tsx -e "
const { SelfAgent } = require('@selfxyz/agent-sdk');
const { ethers } = require('ethers');

const REGISTRY = '0x42CEA1b318557aDE212bED74FC3C7f06Ec52bd5b';
const VERIFIER = '0xD8ec054FD869A762bC977AC328385142303c7def';
const RPC = 'https://forno.celo-sepolia.celo-testnet.org';

const agent = new SelfAgent({
  privateKey: process.env.AGENT_PRIVATE_KEY,
  registryAddress: REGISTRY, rpcUrl: RPC,
});

(async () => {
  console.log('Agent:', agent.address);

  // Test 1: Agent → Service
  const r = await agent.fetch('$DEMO_SERVICE/verify', {
    method: 'POST', headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({ action: 'test' }),
  });
  console.log('Test 1 (Service):', await r.json());

  // Test 2: Agent → Agent
  const p = await agent.fetch('$DEMO_AGENT', {
    method: 'POST', headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({ action: 'peer-verify' }),
  });
  console.log('Test 2 (Agent):', await p.json());

  // Test 3: Agent → Chain
  const provider = new ethers.JsonRpcProvider(RPC);
  const v = new ethers.Contract(VERIFIER,
    ['function nonces(bytes32) view returns (uint256)'], provider);
  const key = ethers.zeroPadValue(agent.address, 32);
  const nonce = await v.nonces(key);
  const deadline = Math.floor(Date.now()/1000) + 300;
  const wallet = new ethers.Wallet(process.env.AGENT_PRIVATE_KEY);
  const sig = await wallet.signTypedData(
    {name:'AgentDemoVerifier',version:'1',
     chainId:11142220n,verifyingContract:VERIFIER},
    {MetaVerify:[{name:'agentKey',type:'bytes32'},
     {name:'nonce',type:'uint256'},{name:'deadline',type:'uint256'}]},
    {agentKey:key,nonce,deadline});
  const c = await agent.fetch('$DEMO_APP/api/demo/chain-verify', {
    method:'POST', headers:{'Content-Type':'application/json'},
    body: JSON.stringify({agentKey:key,nonce:nonce.toString(),
      deadline,eip712Signature:sig}),
  });
  console.log('Test 3 (Chain):', await c.json());
  console.log('All 3 tests passed!');
})();
"`;
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
        .on_http("${rpcUrl}".parse()?);

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
  registryAddress: string = "0x42CEA1b318557aDE212bED74FC3C7f06Ec52bd5b",
  rpcUrl: string = "https://forno.celo-sepolia.celo-testnet.org",
  features?: Set<string>,
): UseCaseSnippets[] {
  const f = features || new Set<string>();

  return [
    {
      title: "Agent \u2192 Service",
      description:
        "Verify that an AI agent calling your API is human-backed. The SDK handles signature verification, on-chain checks, and caching.",
      flow: "npm install @selfxyz/agent-sdk \u2192 Create verifier \u2192 Add middleware \u2192 Done",
      snippets: [
        { label: "TypeScript (SDK)", language: "typescript", code: buildServiceTS(f) },
        { label: "Python", language: "python", code: buildServicePython(f, registryAddress, rpcUrl) },
        { label: "Rust", language: "rust", code: buildServiceRust(f, registryAddress, rpcUrl) },
      ],
    },
    {
      title: "Agent \u2192 Agent",
      description:
        "Verify a peer agent is human-backed before collaborating. Prevents sybil attacks in multi-agent systems.",
      flow: "Receive signed message \u2192 Verify via SDK \u2192 Check identity \u2192 Collaborate",
      snippets: [
        { label: "TypeScript (SDK)", language: "typescript", code: buildAgentAgentTS(f, registryAddress, rpcUrl) },
        { label: "Solidity", language: "solidity", code: buildAgentAgentSolidity(f, registryAddress) },
      ],
    },
    {
      title: "Agent \u2192 Chain",
      description:
        "Gate your smart contract so only human-backed agents can call it. The contract derives the agent key from msg.sender and checks the registry.",
      flow: "Agent calls your contract \u2192 Modifier derives key from msg.sender \u2192 Checks registry \u2192 Executes",
      snippets: [
        { label: "Solidity", language: "solidity", code: buildAgentChainSolidity(f, registryAddress) },
      ],
    },
  ];
}

export function getAgentSnippets(
  registryAddress: string = "0x42CEA1b318557aDE212bED74FC3C7f06Ec52bd5b",
  rpcUrl: string = "https://forno.celo-sepolia.celo-testnet.org",
  features?: Set<string>,
): UseCaseSnippets[] {
  const f = features || new Set<string>();

  return [
    {
      title: "Sign Requests",
      description:
        "Your agent signs every outgoing request with its private key. Services that support Self Agent ID verify your agent automatically.",
      flow: "npm install @selfxyz/agent-sdk \u2192 Create SelfAgent \u2192 Use agent.fetch() \u2192 Service verifies automatically",
      snippets: [
        { label: "TypeScript", language: "typescript", code: buildSignRequestsTS(f) },
        {
          label: "Rust",
          language: "rust",
          code: `use alloy::signers::local::PrivateKeySigner;
use alloy::primitives::keccak256;
use reqwest::header::HeaderMap;
use std::time::{SystemTime, UNIX_EPOCH};

fn sign_request(
    signer: &PrivateKeySigner,
    method: &str, url: &str, body: &str,
) -> HeaderMap {
    let ts = SystemTime::now()
        .duration_since(UNIX_EPOCH).unwrap()
        .as_millis().to_string();
    let body_hash = keccak256(body.as_bytes());
    let message = keccak256(
        format!("{}{}{}{}", ts, method.to_uppercase(), url, body_hash)
    );
    let sig = signer.sign_message_sync(&message.0).unwrap();

    let mut headers = HeaderMap::new();
    headers.insert("x-self-agent-address",
        format!("{}", signer.address()).parse().unwrap());
    headers.insert("x-self-agent-signature",
        format!("0x{}", hex::encode(sig.as_bytes())).parse().unwrap());
    headers.insert("x-self-agent-timestamp",
        ts.parse().unwrap());
    headers
}`,
        },
        {
          label: "Python",
          language: "python",
          code: `import time, requests, os, json
from eth_account import Account
from eth_account.messages import encode_defunct
from web3 import Web3

agent = Account.from_key(os.environ["AGENT_PRIVATE_KEY"])

def signed_request(method: str, url: str, **kwargs):
    ts = str(int(time.time() * 1000))
    body = json.dumps(kwargs.get("json", "")) if "json" in kwargs else ""
    body_hash = Web3.keccak(text=body).hex()
    msg_hash = Web3.keccak(text=ts + method.upper() + url + body_hash)
    sig = agent.sign_message(
        encode_defunct(msg_hash)
    ).signature.hex()

    headers = kwargs.pop("headers", {})
    headers.update({
        "x-self-agent-address": agent.address,
        "x-self-agent-signature": "0x" + sig,
        "x-self-agent-timestamp": ts,
    })
    return requests.request(method, url, headers=headers, **kwargs)

# Usage
res = signed_request("POST", "https://api.example.com/data",
                      json={"query": "test"})`,
        },
      ],
    },
    {
      title: "Submit Transactions",
      description:
        "Your agent address is a real Ethereum wallet. Fund it with gas and it can call smart contracts directly. Contracts verify your agent on-chain via msg.sender.",
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
        "Run the same demo tests from your terminal that the browser demo runs. Hits the live Google Cloud Functions for service verification, agent-to-agent peer check, and on-chain meta-transaction verification.",
      flow: "Set AGENT_PRIVATE_KEY → Run script → Hits live endpoints → Confirms agent works end-to-end",
      snippets: [
        { label: "TypeScript", language: "typescript", code: buildTestSetupTS() },
        { label: "Python", language: "python", code: buildTestSetupPython() },
        { label: "Bash", language: "bash", code: buildTestSetupBash() },
      ],
    },
  ];
}
