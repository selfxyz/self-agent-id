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
  contractAddress: string = "0x60651482a3033A72128f874623Fc790061cc46D4",
  agentPubKey: string = "0x<YOUR_AGENT_PUBKEY>"
): UseCaseSnippets[] {
  return [
    {
      title: "Agent \u2192 Service",
      description:
        "A service verifies that an AI agent is human-backed before granting access.",
      flow: "Agent signs request \u2192 Service checks signature + on-chain status \u2192 Access granted",
      snippets: [
        {
          label: "TypeScript (Agent)",
          language: "typescript",
          code: `import { SelfAgent } from "@selfxyz/agent-sdk";

const agent = new SelfAgent({
  privateKey: process.env.AGENT_PRIVATE_KEY,
  registryAddress: "${contractAddress}",
});

// Every request is automatically signed
const res = await agent.fetch("https://api.example.com/data", {
  method: "POST",
  body: JSON.stringify({ query: "test" }),
});`,
        },
        {
          label: "TypeScript (Service)",
          language: "typescript",
          code: `import { SelfAgentVerifier } from "@selfxyz/agent-sdk";
import express from "express";

const verifier = new SelfAgentVerifier({
  registryAddress: "${contractAddress}",
});

const app = express();

// One-line middleware \u2014 rejects unverified agents
app.use(verifier.expressMiddleware());

app.post("/data", (req, res) => {
  // req.agent.id, req.agent.nullifier available
  res.json({ status: "ok" });
});`,
        },
        {
          label: "Python (Service)",
          language: "python",
          code: `from web3 import Web3

w3 = Web3(Web3.HTTPProvider(
    "https://forno.celo-sepolia.celo-testnet.org"
))
registry = w3.eth.contract(
    address="${contractAddress}",
    abi=REGISTRY_ABI
)

def verify_agent(agent_pubkey: str) -> bool:
    """Check if agent is human-backed on-chain."""
    return registry.functions.isVerifiedAgent(
        agent_pubkey
    ).call()`,
        },
      ],
    },
    {
      title: "Agent \u2192 Chain",
      description:
        "A smart contract checks that an agent is human-verified before executing an action.",
      flow: "Agent calls contract \u2192 Contract reads registry \u2192 Action proceeds if verified",
      snippets: [
        {
          label: "Solidity",
          language: "solidity",
          code: `// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

interface ISelfAgentRegistry {
    function isVerifiedAgent(
        bytes32 agentPubKey
    ) external view returns (bool);
}

contract MyProtocol {
    ISelfAgentRegistry immutable registry =
        ISelfAgentRegistry(${contractAddress});

    modifier onlyVerifiedAgent(bytes32 agentKey) {
        require(
            registry.isVerifiedAgent(agentKey),
            "Agent not human-verified"
        );
        _;
    }

    function agentAction(
        bytes32 agentKey,
        bytes calldata data
    ) external onlyVerifiedAgent(agentKey) {
        // Only human-backed agents reach here
    }
}`,
        },
        {
          label: "TypeScript (Submit tx)",
          language: "typescript",
          code: `import { SelfAgent } from "@selfxyz/agent-sdk";
import { ethers } from "ethers";

const agent = new SelfAgent({
  privateKey: process.env.AGENT_PRIVATE_KEY,
  registryAddress: "${contractAddress}",
});

// Agent submits its own pubkey hash as proof
const myProtocol = new ethers.Contract(
  MY_PROTOCOL_ADDRESS,
  MY_PROTOCOL_ABI,
  agent.wallet
);

const tx = await myProtocol.agentAction(
  "${agentPubKey}",
  "0x..."
);
await tx.wait();`,
        },
        {
          label: "Python (Submit tx)",
          language: "python",
          code: `from web3 import Web3

w3 = Web3(Web3.HTTPProvider(
    "https://forno.celo-sepolia.celo-testnet.org"
))

my_protocol = w3.eth.contract(
    address=MY_PROTOCOL_ADDRESS,
    abi=MY_PROTOCOL_ABI
)

tx = my_protocol.functions.agentAction(
    "${agentPubKey}",
    b"\\x00"
).build_transaction({
    "from": agent_address,
    "nonce": w3.eth.get_transaction_count(agent_address),
})

signed = w3.eth.account.sign_transaction(tx, AGENT_KEY)
tx_hash = w3.eth.send_raw_transaction(signed.raw_transaction)`,
        },
      ],
    },
    {
      title: "Agent \u2192 Agent",
      description:
        "One AI agent verifies another is human-backed before cooperating.",
      flow: "Agent A sends signed request \u2192 Agent B verifies signature + on-chain status \u2192 Collaboration proceeds",
      snippets: [
        {
          label: "TypeScript (Verify peer)",
          language: "typescript",
          code: `import { SelfAgentVerifier } from "@selfxyz/agent-sdk";

const verifier = new SelfAgentVerifier({
  registryAddress: "${contractAddress}",
});

// When receiving a request from another agent:
const result = await verifier.verify({
  agentId: headers["x-self-agent-id"],
  pubkey: headers["x-self-agent-pubkey"],
  signature: headers["x-self-agent-signature"],
  timestamp: headers["x-self-agent-timestamp"],
  method: req.method,
  url: req.url,
  body: req.body,
});

if (result.verified) {
  // Peer agent is human-backed \u2014 safe to cooperate
  console.log("Nullifier:", result.nullifier);
}`,
        },
        {
          label: "Solidity (On-chain check)",
          language: "solidity",
          code: `// Check if two agents share the same human
// Useful for detecting sybil behavior
bool same = ISelfAgentRegistry(${contractAddress})
    .sameHuman(agentIdA, agentIdB);

// Or just verify the peer is registered
bool peerOk = ISelfAgentRegistry(${contractAddress})
    .isVerifiedAgent(peerAgentPubKey);`,
        },
        {
          label: "Python (Verify peer)",
          language: "python",
          code: `from web3 import Web3

w3 = Web3(Web3.HTTPProvider(
    "https://forno.celo-sepolia.celo-testnet.org"
))
registry = w3.eth.contract(
    address="${contractAddress}",
    abi=REGISTRY_ABI
)

def verify_peer_agent(peer_pubkey: str) -> dict:
    """Verify a peer agent is human-backed."""
    is_verified = registry.functions.isVerifiedAgent(
        peer_pubkey
    ).call()

    if not is_verified:
        return {"verified": False, "reason": "Not registered"}

    agent_id = registry.functions.getAgentId(
        peer_pubkey
    ).call()
    nullifier = registry.functions.getHumanNullifier(
        agent_id
    ).call()

    return {
        "verified": True,
        "agent_id": agent_id,
        "nullifier": nullifier,
    }`,
        },
      ],
    },
  ];
}
