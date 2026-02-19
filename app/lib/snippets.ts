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

  let body = `  console.log("Verified agent:", req.agent.address);`;

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

  return `import { SelfAgentVerifier } from "@selfxyz/agent-sdk";
import express from "express";

const app = express();
const verifier = new SelfAgentVerifier(${verifierOpts});

app.use("/api", verifier.expressMiddleware());

app.post("/api/data", ${asyncKw}(req, res) => {
${body}
});`;
}

function buildServicePython(f: Set<string>): string {
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

  let body = `    if not verified:
        return False`;

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

  return `import time
from web3 import Web3
from eth_account.messages import encode_defunct

w3 = Web3(Web3.HTTPProvider(
    "https://forno.celo-sepolia.celo-testnet.org"
))
REGISTRY = "0x42CEA1b318557aDE212bED74FC3C7f06Ec52bd5b"
REGISTRY_ABI = [
${abiEntries}
]
registry = w3.eth.contract(address=REGISTRY, abi=REGISTRY_ABI)

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

function buildServiceRust(f: Set<string>): string {
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

  let checks = `    if !registry.isVerifiedAgent(key).call().await.unwrap()._0 {
        return false;
    }`;

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
        .on_http("https://forno.celo-sepolia.celo-testnet.org".parse().unwrap());
    let registry = ISelfAgentRegistry::new(
        "0x42CEA1b318557aDE212bED74FC3C7f06Ec52bd5b".parse().unwrap(),
        &provider,
    );
    let key = FixedBytes::left_padding_from(&agent_address.0 .0);
${checks}

    true
}`;
}

// ── Agent → Agent builders ──

function buildAgentAgentTS(f: Set<string>): string {
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
    "https://forno.celo-sepolia.celo-testnet.org"
  );
  const registry = new ethers.Contract(
    "0x42CEA1b318557aDE212bED74FC3C7f06Ec52bd5b",
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

function buildAgentAgentSolidity(f: Set<string>): string {
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
        ISelfAgentRegistry(0x42CEA1b318557aDE212bED74FC3C7f06Ec52bd5b);

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

function buildAgentChainSolidity(f: Set<string>): string {
  const sybil = f.has("sybil");
  const creds = needsCreds(f);
  const regAge = f.has("regAge");

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

  let modifierBody = `        bytes32 agentKey = bytes32(uint256(uint160(msg.sender)));
        require(registry.isVerifiedAgent(agentKey), "Agent not human-verified");`;

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
        ISelfAgentRegistry(0x42CEA1b318557aDE212bED74FC3C7f06Ec52bd5b);

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

function buildSubmitTxTS(): string {
  return `import { ethers } from "ethers";

// Your agent wallet — fund this address with gas
const wallet = new ethers.Wallet(
  process.env.AGENT_PRIVATE_KEY,
  new ethers.JsonRpcProvider("https://forno.celo-sepolia.celo-testnet.org")
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

// ============================================================
// Public API
// ============================================================

export function getServiceSnippets(
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _contractAddress?: string,
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
        { label: "Python", language: "python", code: buildServicePython(f) },
        { label: "Rust", language: "rust", code: buildServiceRust(f) },
      ],
    },
    {
      title: "Agent \u2192 Agent",
      description:
        "Verify a peer agent is human-backed before collaborating. Prevents sybil attacks in multi-agent systems.",
      flow: "Receive signed message \u2192 Verify via SDK \u2192 Check identity \u2192 Collaborate",
      snippets: [
        { label: "TypeScript (SDK)", language: "typescript", code: buildAgentAgentTS(f) },
        { label: "Solidity", language: "solidity", code: buildAgentAgentSolidity(f) },
      ],
    },
    {
      title: "Agent \u2192 Chain",
      description:
        "Gate your smart contract so only human-backed agents can call it. The contract derives the agent key from msg.sender and checks the registry.",
      flow: "Agent calls your contract \u2192 Modifier derives key from msg.sender \u2192 Checks registry \u2192 Executes",
      snippets: [
        { label: "Solidity", language: "solidity", code: buildAgentChainSolidity(f) },
      ],
    },
  ];
}

export function getAgentSnippets(features?: Set<string>): UseCaseSnippets[] {
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
        { label: "TypeScript", language: "typescript", code: buildSubmitTxTS() },
      ],
    },
  ];
}
