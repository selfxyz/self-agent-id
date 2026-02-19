"""LangChain ReAct agent with Self Agent ID tools."""
from langchain.agents import create_tool_calling_agent, AgentExecutor
from langchain_openai import ChatOpenAI
from langchain_core.prompts import ChatPromptTemplate

from tools import verify_peer_agent, check_agent_status

llm = ChatOpenAI(model="gpt-4o-mini", temperature=0)

prompt = ChatPromptTemplate.from_messages([
    (
        "system",
        "You are a helpful AI agent that can verify peer agents using Self Agent ID. "
        "Use your tools to check if agents are human-verified on-chain.",
    ),
    ("human", "{input}"),
    ("placeholder", "{agent_scratchpad}"),
])

tools = [verify_peer_agent, check_agent_status]
agent = create_tool_calling_agent(llm, tools, prompt)
executor = AgentExecutor(agent=agent, tools=tools, max_iterations=5, verbose=True)
