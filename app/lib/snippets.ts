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

export function getSnippets(
  contractAddress: string = "0x24D46f30d41e91B3E0d1A8EB250FEa4B90270251",
): UseCaseSnippets[] {
  return [
    {
      title: "Agent \u2192 Service",
      description:
        "A service verifies that an AI agent is human-backed before granting access. Uses EIP-191 signatures with timestamp-based replay protection. Sybil resistant: 1 agent per human.",
      flow: "Agent signs request (EIP-191) \u2192 Service recovers signer \u2192 Checks on-chain \u2192 Access granted",
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

// --- Agent side ---

const agent = new ethers.Wallet(process.env.AGENT_PRIVATE_KEY);

async function signedFetch(url: string, init: RequestInit = {}) {
  const ts = Date.now().toString();
  // EIP-191 personal_sign over timestamp + method + url
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

// --- Service side ---

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
    # Replay protection: reject if older than 5 minutes
    if time.time() * 1000 - int(ts) > 5 * 60 * 1000:
        return False

    # Recover signer from EIP-191 personal_sign
    message = encode_defunct(text=ts + method + url)
    recovered = w3.eth.account.recover_message(message, signature=signature)
    if recovered.lower() != address.lower():
        return False

    # Check on-chain: verified + 1 agent per human
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
        "Two agents verify each other's human-backing before collaborating. Each checks the other's on-chain status, ensuring both parties are backed by different verified humans.",
      flow: "Agent A signs message (EIP-191) \u2192 Agent B verifies signature + on-chain status \u2192 Collaboration proceeds",
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
  // Replay protection
  if (Date.now() - Number(ts) > 5 * 60 * 1000) return false;

  // Recover signer from EIP-191 signature
  const recovered = ethers.verifyMessage(ts + method + url, sig);
  if (recovered.toLowerCase() !== peerAddr.toLowerCase()) return false;

  // Both agents must be verified
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
        "A smart contract verifies the caller is a human-backed agent before executing. Derives agent key from msg.sender. Sybil resistant: 1 agent per human.",
      flow: "Agent calls contract \u2192 Derives key from msg.sender \u2192 Checks registry + sybil \u2192 Action proceeds",
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
        {
          label: "TypeScript",
          language: "typescript",
          code: `import { ethers } from "ethers";

// Agent's wallet — registered via the dApp
const wallet = new ethers.Wallet(
  process.env.AGENT_PRIVATE_KEY,
  new ethers.JsonRpcProvider(RPC_URL)
);

const myProtocol = new ethers.Contract(
  MY_PROTOCOL_ADDRESS,
  MY_PROTOCOL_ABI,
  wallet
);

// Contract derives agent key from msg.sender and checks registry
const tx = await myProtocol.agentAction("0x...");
await tx.wait();`,
        },
      ],
    },
    {
      title: "Custom Limits",
      description:
        "By default, all snippets enforce 1 agent per human. Override this if your use case requires a human to operate multiple agents.",
      flow: "Check agent count per human \u2192 Compare against your limit \u2192 Allow or reject",
      snippets: [
        {
          label: "Solidity",
          language: "solidity",
          code: `// Change the hardcoded "1" in the modifier to your limit:

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
          code: `// Change the count comparison in verifyAgent():

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
