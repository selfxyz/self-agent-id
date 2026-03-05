# LangChain Integration

LangChain tools for Self Agent ID — make authenticated requests and verify agent identities.

## Setup

```bash
pip install selfxyz-agent-sdk[langchain] langchain-openai
```

## Tools

| Tool | Purpose |
|------|---------|
| `SelfAuthenticatedRequestTool` | Make signed HTTP requests using agent identity |
| `SelfVerifyAgentTool` | Verify incoming request signatures |
| `SelfAgentInfoTool` | Look up agent status on-chain |

## Quick Start

```python
from self_agent_sdk import SelfAgent, SelfAgentVerifier
from self_agent_sdk.langchain import SelfAgentToolkit
from langchain_openai import ChatOpenAI
from langchain.agents import create_tool_calling_agent, AgentExecutor
from langchain_core.prompts import ChatPromptTemplate

# Create agent and verifier
agent = SelfAgent(private_key="0x...", network="mainnet")
verifier = SelfAgentVerifier.create().network("mainnet").sybil_limit(1).build()

# Get LangChain tools
toolkit = SelfAgentToolkit(agent=agent, verifier=verifier)
tools = toolkit.get_tools()

# Build LangChain agent
llm = ChatOpenAI(model="gpt-4o-mini")
prompt = ChatPromptTemplate.from_messages([
    ("system", "You are an AI agent with a verified identity."),
    ("human", "{input}"),
    ("placeholder", "{agent_scratchpad}"),
])
lc_agent = create_tool_calling_agent(llm, tools, prompt)
executor = AgentExecutor(agent=lc_agent, tools=tools)
executor.invoke({"input": "Check if 0xabc...def is a verified agent"})
```

## Individual Tools

You can also use tools directly without the toolkit:

```python
from self_agent_sdk.langchain import SelfAuthenticatedRequestTool, SelfAgentInfoTool

request_tool = SelfAuthenticatedRequestTool(agent=my_agent)
info_tool = SelfAgentInfoTool()
```
