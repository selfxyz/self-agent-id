# SPDX-License-Identifier: MIT

"""LangChain + Self Agent ID — minimal example.

Shows how to create a LangChain agent with Self Agent ID tools.

Install:
    pip install selfxyz-agent-sdk[langchain] langchain-openai
"""

import os

from self_agent_sdk import SelfAgent, Ed25519Agent, SelfAgentVerifier
from self_agent_sdk.langchain import SelfAgentToolkit


def make_tools_with_ecdsa_agent():
    """Example: ECDSA agent that can sign requests and verify peers."""
    agent = SelfAgent(
        private_key=os.environ["AGENT_PRIVATE_KEY"],
        network="mainnet",
    )
    verifier = (
        SelfAgentVerifier.create()
        .network("mainnet")
        .sybil_limit(1)
        .build()
    )
    toolkit = SelfAgentToolkit(agent=agent, verifier=verifier)
    return toolkit.get_tools()


def make_tools_with_ed25519_agent():
    """Example: Ed25519 agent (signing only, no verification)."""
    agent = Ed25519Agent(
        private_key=os.environ["ED25519_SEED"],
        network="mainnet",
    )
    toolkit = SelfAgentToolkit(agent=agent)
    return toolkit.get_tools()
