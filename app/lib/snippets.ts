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

// ============================================================
// Agent-side snippets — shown to agent operators after registration
// ============================================================

export function getAgentSnippets(
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _contractAddress?: string,
): UseCaseSnippets[] {
  return [
    {
      title: "Sign Requests",
      description:
        "Your agent signs every outgoing request with its private key using EIP-191. Services that support Self Agent ID will recover the signer and verify your agent on-chain.",
      flow: "Set AGENT_PRIVATE_KEY \u2192 Agent signs each request \u2192 Service verifies automatically",
      snippets: [
        {
          label: "TypeScript",
          language: "typescript",
          code: `import { ethers } from "ethers";

const agent = new ethers.Wallet(process.env.AGENT_PRIVATE_KEY);

async function signedFetch(url: string, init: RequestInit = {}) {
  const ts = Date.now().toString();
  const sig = await agent.signMessage(ts + (init.method ?? "GET") + url);

  return fetch(url, {
    ...init,
    headers: {
      ...init.headers,
      "x-agent-address": agent.address,
      "x-agent-sig": sig,
      "x-agent-ts": ts,
    },
  });
}

// Usage — every request is signed automatically
const res = await signedFetch("https://api.example.com/data", {
  method: "POST",
  body: JSON.stringify({ query: "test" }),
});`,
        },
        {
          label: "Python",
          language: "python",
          code: `import time, requests
from eth_account import Account
from eth_account.messages import encode_defunct

agent = Account.from_key(AGENT_PRIVATE_KEY)

def signed_request(method: str, url: str, **kwargs):
    ts = str(int(time.time() * 1000))
    message = encode_defunct(text=ts + method.upper() + url)
    sig = agent.sign_message(message).signature.hex()

    headers = kwargs.pop("headers", {})
    headers.update({
        "x-agent-address": agent.address,
        "x-agent-sig": "0x" + sig,
        "x-agent-ts": ts,
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
        {
          label: "TypeScript",
          language: "typescript",
          code: `import { ethers } from "ethers";

const RPC_URL = "https://forno.celo-sepolia.celo-testnet.org";

// Your agent wallet — fund this address with gas
const wallet = new ethers.Wallet(
  process.env.AGENT_PRIVATE_KEY,
  new ethers.JsonRpcProvider(RPC_URL)
);

console.log("Agent address:", wallet.address);
console.log("Fund this address with CELO for gas");

// Call any contract that uses onlyVerifiedAgent modifier
const contract = new ethers.Contract(
  CONTRACT_ADDRESS, CONTRACT_ABI, wallet
);
const tx = await contract.agentAction("0x...");
await tx.wait();
// Contract checks msg.sender against the registry automatically`,
        },
      ],
    },
  ];
}

// ============================================================
// Service-side snippets — shown to developers who want to verify agents
// ============================================================

export function getServiceSnippets(
  contractAddress: string = "0x24D46f30d41e91B3E0d1A8EB250FEa4B90270251",
): UseCaseSnippets[] {
  return [
    {
      title: "Agent \u2192 Service",
      description:
        "Verify that an AI agent calling your API is human-backed. Recover the signer from the EIP-191 signature, then check the on-chain registry. Sybil resistant: 1 agent per human by default.",
      flow: "Extract headers \u2192 Check timestamp (replay protection) \u2192 Recover signer (EIP-191) \u2192 Verify on-chain",
      snippets: [
        {
          label: "TypeScript",
          language: "typescript",
          code: `import { ethers } from "ethers";

const REGISTRY = "${contractAddress}";
const RPC = "https://forno.celo-sepolia.celo-testnet.org";
const REGISTRY_ABI = [
  "function isVerifiedAgent(bytes32) view returns (bool)",
  "function getAgentId(bytes32) view returns (uint256)",
  "function getHumanNullifier(uint256) view returns (uint256)",
  "function getAgentCountForHuman(uint256) view returns (uint256)",
];

const provider = new ethers.JsonRpcProvider(RPC);
const registry = new ethers.Contract(REGISTRY, REGISTRY_ABI, provider);

async function verifyAgent(req: Request): Promise<boolean> {
  const addr = req.headers.get("x-agent-address");
  const sig = req.headers.get("x-agent-sig");
  const ts = req.headers.get("x-agent-ts");
  if (!addr || !sig || !ts) return false;

  // Reject requests older than 5 minutes (replay protection)
  if (Date.now() - Number(ts) > 5 * 60 * 1000) return false;

  // Recover signer from EIP-191 signature
  const recovered = ethers.verifyMessage(ts + req.method + req.url, sig);
  if (recovered.toLowerCase() !== addr.toLowerCase()) return false;

  // Check on-chain: verified + sybil resistant (1 per human)
  const key = ethers.zeroPadValue(addr, 32);
  if (!(await registry.isVerifiedAgent(key))) return false;
  const id = await registry.getAgentId(key);
  const nullifier = await registry.getHumanNullifier(id);
  const count = await registry.getAgentCountForHuman(nullifier);
  return count <= 1n;
}`,
        },
        {
          label: "Python",
          language: "python",
          code: `import time
from web3 import Web3
from eth_account.messages import encode_defunct

w3 = Web3(Web3.HTTPProvider(
    "https://forno.celo-sepolia.celo-testnet.org"
))
REGISTRY_ABI = [
    {"name": "isVerifiedAgent", "type": "function", "stateMutability": "view",
     "inputs": [{"type": "bytes32"}], "outputs": [{"type": "bool"}]},
    {"name": "getAgentId", "type": "function", "stateMutability": "view",
     "inputs": [{"type": "bytes32"}], "outputs": [{"type": "uint256"}]},
    {"name": "getHumanNullifier", "type": "function", "stateMutability": "view",
     "inputs": [{"type": "uint256"}], "outputs": [{"type": "uint256"}]},
    {"name": "getAgentCountForHuman", "type": "function", "stateMutability": "view",
     "inputs": [{"type": "uint256"}], "outputs": [{"type": "uint256"}]},
]
registry = w3.eth.contract(
    address="${contractAddress}", abi=REGISTRY_ABI
)

def verify_agent(address: str, signature: str, ts: str,
                 method: str, url: str) -> bool:
    """Verify EIP-191 signature, on-chain status, and sybil resistance."""
    if time.time() * 1000 - int(ts) > 5 * 60 * 1000:
        return False
    message = encode_defunct(text=ts + method + url)
    recovered = w3.eth.account.recover_message(message, signature=signature)
    if recovered.lower() != address.lower():
        return False
    agent_key = w3.to_bytes(hexstr=address).rjust(32, b"\\x00")
    if not registry.functions.isVerifiedAgent(agent_key).call():
        return False
    agent_id = registry.functions.getAgentId(agent_key).call()
    nullifier = registry.functions.getHumanNullifier(agent_id).call()
    count = registry.functions.getAgentCountForHuman(nullifier).call()
    return count <= 1`,
        },
      ],
    },
    {
      title: "Agent \u2192 Agent",
      description:
        "Verify a peer agent is human-backed and operated by a different human before collaborating. Prevents a single human from sybil-attacking your multi-agent system.",
      flow: "Receive signed message \u2192 Verify EIP-191 signature \u2192 Check both agents on-chain \u2192 Ensure different humans",
      snippets: [
        {
          label: "TypeScript",
          language: "typescript",
          code: `import { ethers } from "ethers";

const REGISTRY = "${contractAddress}";
const RPC = "https://forno.celo-sepolia.celo-testnet.org";
const REGISTRY_ABI = [
  "function isVerifiedAgent(bytes32) view returns (bool)",
  "function getAgentId(bytes32) view returns (uint256)",
  "function sameHuman(uint256,uint256) view returns (bool)",
];

const provider = new ethers.JsonRpcProvider(RPC);
const registry = new ethers.Contract(REGISTRY, REGISTRY_ABI, provider);

async function verifyPeer(
  peerAddr: string, sig: string, ts: string,
  method: string, url: string, myAddr: string
): Promise<boolean> {
  if (Date.now() - Number(ts) > 5 * 60 * 1000) return false;

  const recovered = ethers.verifyMessage(ts + method + url, sig);
  if (recovered.toLowerCase() !== peerAddr.toLowerCase()) return false;

  const peerKey = ethers.zeroPadValue(peerAddr, 32);
  const myKey = ethers.zeroPadValue(myAddr, 32);
  if (!(await registry.isVerifiedAgent(peerKey))) return false;

  // Ensure different humans (sybil resistance)
  const peerId = await registry.getAgentId(peerKey);
  const myId = await registry.getAgentId(myKey);
  return !(await registry.sameHuman(peerId, myId));
}`,
        },
        {
          label: "Solidity",
          language: "solidity",
          code: `// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

interface ISelfAgentRegistry {
    function isVerifiedAgent(bytes32 key) external view returns (bool);
    function getAgentId(bytes32 key) external view returns (uint256);
    function sameHuman(uint256 a, uint256 b) external view returns (bool);
}

contract AgentCollaboration {
    ISelfAgentRegistry immutable registry =
        ISelfAgentRegistry(${contractAddress});

    modifier onlyMutuallyVerified(bytes32 agentA, bytes32 agentB) {
        require(registry.isVerifiedAgent(agentA), "Agent A not verified");
        require(registry.isVerifiedAgent(agentB), "Agent B not verified");
        require(
            !registry.sameHuman(
                registry.getAgentId(agentA),
                registry.getAgentId(agentB)
            ),
            "Same human"
        );
        _;
    }

    function collaborate(
        bytes32 agentA,
        bytes32 agentB,
        bytes calldata data
    ) external onlyMutuallyVerified(agentA, agentB) {
        // Both agents are human-backed by different humans
    }
}`,
        },
      ],
    },
    {
      title: "Agent \u2192 Chain",
      description:
        "Gate your smart contract so only human-backed agents can call it. The contract derives the agent key from msg.sender and checks the registry. Sybil resistant: 1 agent per human by default.",
      flow: "Agent calls your contract \u2192 Modifier derives key from msg.sender \u2192 Checks registry + sybil \u2192 Executes",
      snippets: [
        {
          label: "Solidity",
          language: "solidity",
          code: `// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

interface ISelfAgentRegistry {
    function isVerifiedAgent(bytes32 key) external view returns (bool);
    function getAgentId(bytes32 key) external view returns (uint256);
    function getHumanNullifier(uint256 id) external view returns (uint256);
    function getAgentCountForHuman(uint256 n) external view returns (uint256);
}

contract MyProtocol {
    ISelfAgentRegistry immutable registry =
        ISelfAgentRegistry(${contractAddress});

    modifier onlyVerifiedAgent() {
        bytes32 agentKey = bytes32(uint256(uint160(msg.sender)));
        require(
            registry.isVerifiedAgent(agentKey),
            "Agent not human-verified"
        );
        uint256 agentId = registry.getAgentId(agentKey);
        uint256 nullifier = registry.getHumanNullifier(agentId);
        require(
            registry.getAgentCountForHuman(nullifier) <= 1,
            "Too many agents for this human"
        );
        _;
    }

    function agentAction(
        bytes calldata data
    ) external onlyVerifiedAgent {
        // Only human-backed agents reach here (1 per human)
    }
}`,
        },
      ],
    },
    {
      title: "Custom Limits",
      description:
        "By default, all snippets enforce 1 agent per human. Override this if your use case requires a human to operate multiple agents.",
      flow: "Change the count limit \u2192 Or remove the sybil check entirely",
      snippets: [
        {
          label: "Solidity",
          language: "solidity",
          code: `// Change the hardcoded "1" to your limit:

modifier onlyVerifiedAgent() {
    bytes32 agentKey = bytes32(uint256(uint160(msg.sender)));
    require(registry.isVerifiedAgent(agentKey), "Not verified");
    uint256 agentId = registry.getAgentId(agentKey);
    uint256 nullifier = registry.getHumanNullifier(agentId);
    require(
        registry.getAgentCountForHuman(nullifier) <= 5, // allow 5 per human
        "Too many agents"
    );
    _;
}

// Or skip the count check to allow unlimited agents per human:

modifier onlyVerifiedAgentNoLimit() {
    bytes32 agentKey = bytes32(uint256(uint160(msg.sender)));
    require(registry.isVerifiedAgent(agentKey), "Not verified");
    _;
}`,
        },
        {
          label: "TypeScript",
          language: "typescript",
          code: `// Change the count comparison in your verify function:

const MAX_AGENTS_PER_HUMAN = 5; // your custom limit

async function verifyAgent(address: string): Promise<boolean> {
  const key = ethers.zeroPadValue(address, 32);
  if (!(await registry.isVerifiedAgent(key))) return false;
  const id = await registry.getAgentId(key);
  const nullifier = await registry.getHumanNullifier(id);
  const count = await registry.getAgentCountForHuman(nullifier);
  return count <= BigInt(MAX_AGENTS_PER_HUMAN);
}

// Or skip the count check entirely:

async function verifyAgentNoLimit(address: string): Promise<boolean> {
  const key = ethers.zeroPadValue(address, 32);
  return registry.isVerifiedAgent(key);
}`,
        },
      ],
    },
  ];
}
