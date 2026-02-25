// SPDX-FileCopyrightText: 2025-2026 Social Connect Labs, Inc.
// SPDX-License-Identifier: BUSL-1.1
// NOTE: Converts to Apache-2.0 on 2029-06-11 per LICENSE.

"use client";

import { useReducer, useCallback, useRef, useEffect, useMemo, useState } from "react";
import { ethers } from "ethers";
import MatrixText from "@/components/MatrixText";
import {
  ShieldCheck,
  Users,
  Lock,
  Eye,
  EyeOff,
  Fingerprint,
  KeyRound,
  Wallet,
  Loader2,
  AlertCircle,
  Rocket,
  Skull,
  Terminal,
  Bot,
  Send,
} from "lucide-react";
import { SelfAgent, SelfAgentVerifier } from "@selfxyz/agent-sdk";
import TestCard, { StepEntry } from "@/components/TestCard";
import { Card } from "@/components/Card";
import { Badge } from "@/components/Badge";
import { Button } from "@/components/Button";
import {
  REGISTRY_ABI,
  AGENT_DEMO_VERIFIER_ABI,
} from "@/lib/constants";
import { signInWithPasskey, isPasskeySupported } from "@/lib/aa";
import {
  getAgentPrivateKeyByAgent,
  getAgentPrivateKeyByGuardian,
  saveAgentPrivateKey,
} from "@/lib/agentKeyVault";
import { useNetwork } from "@/lib/NetworkContext";
import type { NetworkConfig } from "@/lib/network";
import { TESTS } from "@/lib/demo-constants";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface AgentCredentials {
  issuingState: string;
  name: string[];
  nationality: string;
  dateOfBirth: string;
  gender: string;
  expiryDate: string;
  olderThan: bigint;
  ofac: boolean[];
}

interface AgentSetup {
  address: string;
  agentKey: string;
  agentId: string;
  isVerified: boolean;
  credentials?: AgentCredentials;
}

type TestStatus = "idle" | "running" | "success" | "error";

interface TestState {
  status: TestStatus;
  steps: StepEntry[];
  result: React.ReactNode | null;
  error: string | null;
}

interface LogEntry {
  timestamp: number;
  testId: string;
  message: string;
}

interface ChatMessage {
  role: "user" | "agent";
  content: string;
}

interface DemoState {
  phase: "setup" | "testing" | "results";
  privateKey: string;
  showKey: boolean;
  loading: boolean;
  setupError: string;
  agent: AgentSetup | null;
  tests: Record<string, TestState>;
  logs: LogEntry[];
  chatMessages: ChatMessage[];
  chatInput: string;
  chatLoading: boolean;
  chatOpen: boolean;
  chatUnlocked: boolean;
}

type Action =
  | { type: "SET_KEY"; key: string }
  | { type: "TOGGLE_KEY" }
  | { type: "LOADING" }
  | { type: "SETUP_ERROR"; error: string }
  | { type: "SETUP_DONE"; agent: AgentSetup }
  | { type: "START_TESTS" }
  | { type: "UPDATE_TEST"; testId: string; state: Partial<TestState> }
  | { type: "ADD_LOG"; testId: string; message: string }
  | { type: "SET_CHAT_INPUT"; value: string }
  | { type: "ADD_CHAT_MESSAGE"; message: ChatMessage }
  | { type: "CHAT_LOADING"; loading: boolean }
  | { type: "TOGGLE_CHAT" }
  | { type: "UNLOCK_CHAT" }
  | { type: "RESET" };

// ---------------------------------------------------------------------------
// Reducer
// ---------------------------------------------------------------------------

function makeEmptyTest(): TestState {
  return { status: "idle", steps: [], result: null, error: null };
}

const initialState: DemoState = {
  phase: "setup",
  privateKey: "",
  showKey: false,
  loading: false,
  setupError: "",
  agent: null,
  tests: {
    service: makeEmptyTest(),
    peer: makeEmptyTest(),
    gate: makeEmptyTest(),
  },
  logs: [],
  chatMessages: [],
  chatInput: "",
  chatLoading: false,
  chatOpen: false,
  chatUnlocked: false,
};

function reducer(state: DemoState, action: Action): DemoState {
  switch (action.type) {
    case "SET_KEY":
      return { ...state, privateKey: action.key, setupError: "" };
    case "TOGGLE_KEY":
      return { ...state, showKey: !state.showKey };
    case "LOADING":
      return { ...state, loading: true, setupError: "" };
    case "SETUP_ERROR":
      return { ...state, loading: false, setupError: action.error };
    case "SETUP_DONE":
      return { ...state, loading: false, agent: action.agent };
    case "START_TESTS":
      return {
        ...state,
        tests: {
          service: { ...makeEmptyTest(), status: "running" },
          peer: { ...makeEmptyTest(), status: "running" },
          gate: { ...makeEmptyTest(), status: "running" },
        },
      };
    case "UPDATE_TEST": {
      const updated = { ...state.tests[action.testId], ...action.state };
      const newTests = { ...state.tests, [action.testId]: updated };
      // Unlock chat when any test succeeds (agent proved human-backed)
      const justUnlocked = !state.chatUnlocked && updated.status === "success";
      return {
        ...state,
        tests: newTests,
        chatUnlocked: state.chatUnlocked || updated.status === "success",
        chatOpen: justUnlocked ? true : state.chatOpen,
      };
    }
    case "ADD_LOG":
      return {
        ...state,
        logs: [
          ...state.logs,
          { timestamp: Date.now(), testId: action.testId, message: action.message },
        ],
      };
    case "SET_CHAT_INPUT":
      return { ...state, chatInput: action.value };
    case "ADD_CHAT_MESSAGE":
      return { ...state, chatMessages: [...state.chatMessages, action.message] };
    case "CHAT_LOADING":
      return { ...state, chatLoading: action.loading };
    case "TOGGLE_CHAT":
      return { ...state, chatOpen: !state.chatOpen };
    case "UNLOCK_CHAT":
      return { ...state, chatUnlocked: true };
    case "RESET":
      return initialState;
    default:
      return state;
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function cleanStr(s: string): string {
  // Strip null bytes and other non-printable chars from on-chain strings
  return s.replace(/[\x00-\x1f]/g, "").trim();
}

function buildCredentialBadges(creds: AgentCredentials): string[] {
  const badges: string[] = [];
  const nat = cleanStr(creds.nationality ?? "");
  if (nat) badges.push(nat);
  if (creds.olderThan > 0n) badges.push(`${creds.olderThan.toString()}+`);
  if (creds.ofac?.some(Boolean)) badges.push("Not on OFAC List");
  const names = (creds.name ?? []).map(cleanStr).filter(Boolean);
  if (names.length > 0) badges.push(names.join(" "));
  return badges.filter(b => b.length > 0);
}

function makeSteps(
  labels: string[],
  activeIndex: number,
  timings?: (number | undefined)[],
  error?: boolean,
): StepEntry[] {
  return labels.map((label, i) => ({
    label,
    status:
      i < activeIndex
        ? "done"
        : i === activeIndex
          ? error
            ? "error"
            : "active"
          : "pending",
    durationMs: i < activeIndex ? timings?.[i] : undefined,
  }));
}

function allDone(labels: string[], timings?: (number | undefined)[]): StepEntry[] {
  return labels.map((label, i) => ({
    label,
    status: "done" as const,
    durationMs: timings?.[i],
  }));
}

function shortAddr(addr: string): string {
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
}

const TEST_LABELS: Record<string, string> = {
  agent: "Agent SDK",
  service: "Agent-to-Service",
  peer: "Agent-to-Agent",
  gate: "Agent-to-Chain",
  chat: "AI Chat",
};

const LOG_COLORS: Record<string, string> = {
  agent: "text-yellow-400",
  service: "text-blue-400",
  peer: "text-purple-400",
  gate: "text-green-400",
  chat: "text-cyan-400",
};

// ---------------------------------------------------------------------------
// Chat Section Component
// ---------------------------------------------------------------------------

const CHAT_SUGGESTIONS = [
  "Who am I?",
  "What are you?",
  "meow?",
];

function ChatSection({
  messages,
  input,
  loading,
  unlocked,
  isOpen,
  dispatch,
  onSend,
}: {
  messages: ChatMessage[];
  input: string;
  loading: boolean;
  unlocked: boolean;
  isOpen: boolean;
  dispatch: React.Dispatch<Action>;
  onSend: (query: string) => void;
}) {
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const q = input.trim();
    if (!q || loading) return;
    onSend(q);
  };

  return (
    <Card className="mt-6">
      {/* Collapsible header */}
      <button
        type="button"
        onClick={() => dispatch({ type: "TOGGLE_CHAT" })}
        className="flex items-center gap-2 w-full text-left"
      >
        <Bot size={20} className={unlocked ? "text-cyan-400" : "text-muted"} />
        <h3 className="font-semibold">AI Agent Chat</h3>
        {unlocked && (
          <Badge variant="success" className="ml-1">verified</Badge>
        )}
        <span className="text-xs text-muted ml-auto">
          {isOpen ? "▲" : "▼"}
        </span>
      </button>

      {/* Collapsible body */}
      {isOpen && (
        <div className="mt-4">
          {/* Message list */}
          <div className="bg-[#0d1117] border border-border rounded-lg p-3 min-h-[200px] max-h-[400px] overflow-y-auto mb-3 space-y-3">
            {messages.length === 0 && !loading && (
              <div className="flex flex-col items-center justify-center h-[180px] text-muted text-sm space-y-3">
                <Bot size={32} className="opacity-30" />
                <p className="text-muted">Try talking to the AI agent</p>
                <div className="flex flex-wrap gap-2 justify-center">
                  {CHAT_SUGGESTIONS.map((s) => (
                    <button
                      key={s}
                      onClick={() => onSend(s)}
                      className="px-3 py-1.5 text-xs border border-border rounded-full
                                 hover:border-cyan-400/50 hover:text-cyan-400 transition-colors"
                    >
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {messages.map((msg, i) => (
              <div
                key={i}
                className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
              >
                <div
                  className={`max-w-[80%] px-3 py-2 rounded-lg text-sm ${
                    msg.role === "user"
                      ? "bg-accent/20 text-foreground"
                      : "bg-surface-2 text-foreground"
                  }`}
                >
                  {msg.role === "agent" && (
                    <span className="text-cyan-400 text-xs font-medium block mb-1">Agent</span>
                  )}
                  <span className="whitespace-pre-wrap">{msg.content}</span>
                </div>
              </div>
            ))}

            {loading && (
              <div className="flex justify-start">
                <div className="bg-surface-2 px-3 py-2 rounded-lg text-sm flex items-center gap-2">
                  <Loader2 size={14} className="animate-spin text-cyan-400" />
                  <span className="text-muted">Thinking...</span>
                </div>
              </div>
            )}

            <div ref={messagesEndRef} />
          </div>

          {/* Input */}
          <form onSubmit={handleSubmit} className="flex gap-2">
            <input
              type="text"
              value={input}
              onChange={(e) => dispatch({ type: "SET_CHAT_INPUT", value: e.target.value })}
              placeholder="Ask the AI agent..."
              disabled={loading}
              className="flex-1 px-4 py-2.5 bg-surface-2 border border-border rounded-lg
                         focus:border-cyan-400 focus:ring-0 text-sm
                         disabled:opacity-50 disabled:cursor-not-allowed"
            />
            <Button
              type="submit"
              disabled={loading || !input.trim()}
              className="px-4"
            >
              {loading ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
            </Button>
          </form>
        </div>
      )}
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Console Log Component
// ---------------------------------------------------------------------------

function ConsoleLog({ logs }: { logs: LogEntry[] }) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
    }
  }, [logs]);

  if (logs.length === 0) return null;

  return (
    <div className="mt-6">
      <div className="flex items-center gap-2 mb-2">
        <Terminal size={14} className="text-muted" />
        <span className="text-xs font-medium text-muted uppercase tracking-wider">Live Console</span>
      </div>
      <div
        ref={containerRef}
        className="bg-[#0d1117] border border-border rounded-lg p-3 max-h-60 overflow-y-auto font-mono text-xs leading-relaxed"
      >
        {logs.map((log, i) => {
          const ts = new Date(log.timestamp);
          const time = ts.toLocaleTimeString("en-US", {
            hour12: false,
            hour: "2-digit",
            minute: "2-digit",
            second: "2-digit",
          }) + "." + String(ts.getMilliseconds()).padStart(3, "0");

          return (
            <div key={i} className="whitespace-pre-wrap">
              <span className="text-gray-500">[{time}</span>
              <span className="text-gray-500"> | </span>
              <span className={LOG_COLORS[log.testId] || "text-gray-400"}>
                {TEST_LABELS[log.testId] || log.testId}
              </span>
              <span className="text-gray-500">] </span>
              <span className="text-gray-300">{log.message}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Code snippets for "View Code" (generated dynamically per network)
// ---------------------------------------------------------------------------

function getServiceCode(net: NetworkConfig): string {
  return `import { SelfAgent } from "@selfxyz/agent-sdk";

const CENSUS_SERVICE = "${net.demoServiceUrl || "https://agent-id-demo-service-<hash>-uc.a.run.app"}";

const agent = new SelfAgent({
  privateKey: process.env.AGENT_PRIVATE_KEY,
  registryAddress: "${net.registryAddress}",
  rpcUrl: "${net.rpcUrl}",
});

// 1. Verify agent + get credentials
const verifyRes = await agent.fetch(CENSUS_SERVICE + "/verify", {
  method: "POST",
  body: JSON.stringify({ action: "demo" }),
});

// 2. Contribute credentials to census
const censusRes = await agent.fetch(CENSUS_SERVICE + "/census", {
  method: "POST",
  body: JSON.stringify({ action: "contribute" }),
});

// 3. Read aggregate stats (gated)
const statsRes = await agent.fetch(CENSUS_SERVICE + "/census");
const stats = await statsRes.json();
// stats.topCountries, stats.verifiedOver18, stats.ofacClear`;
}

function getPeerCode(net: NetworkConfig): string {
  return `import { SelfAgent } from "@selfxyz/agent-sdk";

const DEMO_AGENT = "${net.demoAgentUrl || "https://agent-id-demo-agent-<hash>-uc.a.run.app"}";

// Client: your agent signs a request to the demo agent
const res = await myAgent.fetch(DEMO_AGENT, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ action: "peer-verify" }),
});
const data = await res.json();
// data.sameHuman, data.demoAgent, data.callerAgent

// Server (demo agent): verifies caller, checks sameHuman
const verifier = new SelfAgentVerifier({ registryAddress });
const result = await verifier.verify({ signature, timestamp, method, url, body });
const sameHuman = await registry.sameHuman(demoAgentId, callerAgentId);

// Demo agent signs its response back
const responseHeaders = await demoAgent.signRequest("POST", url, responseBody);`;
}

function getGateCode(net: NetworkConfig): string {
  return `import { ethers } from "ethers";

// 1. Read nonce from contract
const nonce = await verifier.nonces(agentKey);

// 2. Sign EIP-712 typed data
const domain = {
  name: "AgentDemoVerifier", version: "1",
  chainId: ${net.chainId},
  verifyingContract: "${net.agentDemoVerifierAddress}",
};
const types = {
  MetaVerify: [
    { name: "agentKey", type: "bytes32" },
    { name: "nonce", type: "uint256" },
    { name: "deadline", type: "uint256" },
  ],
};
const deadline = Math.floor(Date.now() / 1000) + 300;
const sig = await wallet.signTypedData(domain, types,
  { agentKey, nonce, deadline });

// 3. Relayer submits meta-tx on-chain
const res = await agent.fetch("/api/demo/chain-verify", {
  method: "POST",
  body: JSON.stringify({ agentKey, nonce, deadline, eip712Signature: sig }),
});
// res: { txHash, blockNumber, explorerUrl, rateLimitRemaining }`;
}

// ---------------------------------------------------------------------------
// EIP-712 types for AgentDemoVerifier (domain is built per-network)
// ---------------------------------------------------------------------------

const EIP712_TYPES = {
  MetaVerify: [
    { name: "agentKey", type: "bytes32" },
    { name: "nonce", type: "uint256" },
    { name: "deadline", type: "uint256" },
  ],
};

// ---------------------------------------------------------------------------
// Shared test runners (used by both real + fake agent)
// ---------------------------------------------------------------------------

type Dispatch = React.Dispatch<Action>;
type LogFn = (testId: string, message: string) => void;

async function runServiceTest(
  agent: SelfAgent,
  agentLabel: string,
  dispatch: Dispatch,
  log: LogFn,
  net: NetworkConfig,
) {
  const id = "service";
  const baseUrl = net.demoServiceUrl || window.location.origin + "/api/demo";
  const networkSuffix = net.demoServiceUrl ? "" : `?network=${net.id}`;
  const serviceUrl = (path: string) => baseUrl + path + networkSuffix;
  const steps = [
    "ECDSA sign + POST /verify...",
    "POST /census — contributing credentials...",
    "GET /census — reading aggregate stats...",
  ];
  const t: (number | undefined)[] = [];
  const totalStart = performance.now();

  try {
    log(id, `Starting Agent-to-Service test...`);
    log(id, `Agent: ${agentLabel}`);

    // Step 0: verify
    log(id, "Constructing POST /verify");
    log(id, "Signing request body with secp256k1...");
    dispatch({ type: "UPDATE_TEST", testId: id, state: { steps: makeSteps(steps, 0, t) } });
    await new Promise((r) => setTimeout(r, 0));
    const t0 = performance.now();

    const verifyRes = await agent.fetch(serviceUrl("/verify"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "demo-verification", timestamp: Date.now() }),
    });

    const verifyElapsed = Math.round(performance.now() - t0);
    t.push(verifyElapsed);
    const verifyData = await verifyRes.json();
    log(id, `POST /verify — HTTP ${verifyRes.status} (${verifyElapsed}ms)`);

    if (!verifyData.valid) {
      log(id, `Verification failed: ${verifyData.error || "unknown"}`);
      dispatch({
        type: "UPDATE_TEST",
        testId: id,
        state: {
          status: "error",
          steps: makeSteps(steps, 0, t, true),
          error: verifyData.error || "Verification failed",
        },
      });
      return;
    }

    log(id, `Agent verified — ID #${verifyData.agentId}, ${verifyData.credentials?.nationality || "?"} ${verifyData.credentials?.olderThan || "?"}+`);

    // Step 1: POST census
    dispatch({ type: "UPDATE_TEST", testId: id, state: { steps: makeSteps(steps, 1, t) } });
    log(id, "Contributing credentials to census...");
    const t1 = performance.now();

    const censusRes = await agent.fetch(serviceUrl("/census"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "contribute" }),
    });

    const censusElapsed = Math.round(performance.now() - t1);
    t.push(censusElapsed);
    const censusData = await censusRes.json();

    if (!censusRes.ok) {
      log(id, `Census POST failed: ${censusData.error || "unknown"} (${censusElapsed}ms)`);
      dispatch({
        type: "UPDATE_TEST",
        testId: id,
        state: {
          status: "error",
          steps: makeSteps(steps, 1, t, true),
          error: censusData.error || "Census contribution failed",
        },
      });
      return;
    }

    log(id, `POST /census — HTTP ${censusRes.status} — credentials recorded (${censusElapsed}ms)`);

    // Step 2: GET census stats
    dispatch({ type: "UPDATE_TEST", testId: id, state: { steps: makeSteps(steps, 2, t) } });
    log(id, "Signing GET /census request...");
    const t2 = performance.now();

    const statsRes = await agent.fetch(serviceUrl("/census"));
    const statsElapsed = Math.round(performance.now() - t2);
    t.push(statsElapsed);
    const stats = await statsRes.json();

    if (!statsRes.ok) {
      log(id, `GET /census failed: ${stats.error || "unknown"} (${statsElapsed}ms)`);
      dispatch({
        type: "UPDATE_TEST",
        testId: id,
        state: {
          status: "error",
          steps: makeSteps(steps, 2, t, true),
          error: stats.error || "Census read failed",
        },
      });
      return;
    }

    const topStr = stats.topCountries?.map((c: { country: string; count: number }) => `${c.country}(${c.count})`).join(" ") || "none";
    log(id, `GET /census — HTTP ${statsRes.status} — Top: ${topStr} | 18+: ${stats.verifiedOver18} | OFAC clear: ${stats.ofacClear} (${statsElapsed}ms)`);

    const totalElapsed = Math.round(performance.now() - totalStart);
    log(id, `Test complete (${totalElapsed}ms total)`);

    dispatch({
      type: "UPDATE_TEST",
      testId: id,
      state: {
        status: "success",
        steps: allDone(steps, t),
        result: (
          <div className="space-y-1 text-xs">
            <p className="text-accent-success font-bold text-sm">Census Service: Agent Verified</p>
            <p className="text-muted">
              Agent ID: <span className="text-foreground font-mono">#{verifyData.agentId}</span>
              {verifyData.credentials?.nationality && (
                <> | <span className="text-foreground">{verifyData.credentials.nationality}</span></>
              )}
              {verifyData.credentials?.olderThan && Number(verifyData.credentials.olderThan) > 0 && (
                <> <span className="text-foreground">{verifyData.credentials.olderThan}+</span></>
              )}
            </p>
            <p className="text-muted">
              Census: <span className="text-foreground">{stats.totalAgents} agents</span>
            </p>
            {stats.topCountries?.filter((c: { country: string }) => c.country?.trim()).length > 0 && (
              <p className="text-muted">
                Top countries:{" "}
                <span className="text-foreground">
                  {stats.topCountries.filter((c: { country: string }) => c.country?.trim()).map((c: { country: string; count: number }) => `${c.country} (${c.count})`).join(", ")}
                </span>
              </p>
            )}
            <p className="text-muted">
              18+: <span className="text-foreground">{stats.verifiedOver18}</span>
              {" | "}21+: <span className="text-foreground">{stats.verifiedOver21}</span>
              {" | "}OFAC clear: <span className="text-foreground">{stats.ofacClear}</span>
            </p>
          </div>
        ),
      },
    });
  } catch (err) {
    log(id, `Error: ${err instanceof Error ? err.message : "Request failed"}`);
    dispatch({
      type: "UPDATE_TEST",
      testId: id,
      state: {
        status: "error",
        steps: makeSteps(steps, 0, t, true),
        error: err instanceof Error ? err.message : "Request failed",
      },
    });
  }
}

async function runPeerTest(
  agent: SelfAgent,
  agentLabel: string,
  dispatch: Dispatch,
  log: LogFn,
  net: NetworkConfig,
) {
  const id = "peer";
  const agentUrl = net.demoAgentUrl || window.location.origin + `/api/demo/agent-to-agent?network=${net.id}`;
  const steps = [
    "ECDSA sign + POST to demo agent...",
    "Demo agent: ecrecover \u2192 on-chain verify + sameHuman()...",
    "Verifying demo agent\u2019s ECDSA response signature...",
  ];
  const t: (number | undefined)[] = [];
  const totalStart = performance.now();

  try {
    log(id, `Starting Agent-to-Agent test...`);
    log(id, `Agent: ${agentLabel}`);
    log(id, "Constructing POST to demo agent");
    log(id, "Signing request body with secp256k1...");
    dispatch({ type: "UPDATE_TEST", testId: id, state: { steps: makeSteps(steps, 0, t) } });
    await new Promise((r) => setTimeout(r, 0));
    let t0 = performance.now();

    const res = await agent.fetch(agentUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "peer-verify" }),
    });

    const elapsed = Math.round(performance.now() - t0);
    t.push(elapsed);
    log(id, `POST demo-agent — HTTP ${res.status} (${elapsed}ms)`);

    if (!res.ok) {
      const errData = await res.json().catch(() => ({ error: "Request rejected" }));
      log(id, `Rejected: ${errData.error || "unknown"}`);
      dispatch({
        type: "UPDATE_TEST",
        testId: id,
        state: {
          status: "error",
          steps: makeSteps(steps, 1, t, true),
          error: errData.error || `HTTP ${res.status}`,
        },
      });
      return;
    }

    log(id, "Demo agent is verifying caller on-chain...");
    dispatch({ type: "UPDATE_TEST", testId: id, state: { steps: makeSteps(steps, 1, t) } });

    t0 = performance.now();
    const responseBody = await res.text();
    let data: Record<string, unknown>;
    try {
      const parsed = JSON.parse(responseBody);
      if (!parsed || typeof parsed !== "object") {
        throw new Error("Response is not a JSON object");
      }
      data = parsed as Record<string, unknown>;
    } catch {
      log(id, "Demo agent returned invalid JSON");
      dispatch({
        type: "UPDATE_TEST",
        testId: id,
        state: {
          status: "error",
          steps: makeSteps(steps, 1, t, true),
          error: "Invalid JSON response from demo agent",
        },
      });
      return;
    }
    const parseElapsed = Math.round(performance.now() - t0);
    t.push(parseElapsed);
    const demoAgentInfo = (data.demoAgent as {
      address?: string;
      agentId?: string;
      verified?: boolean;
    } | undefined) ?? {};
    const callerAgentInfo = (data.callerAgent as {
      agentId?: string;
      verified?: boolean;
    } | undefined) ?? {};
    const sameHuman = Boolean(data.sameHuman);
    const message = typeof data.message === "string" ? data.message : "";

    log(id, `Demo agent: ID #${demoAgentInfo.agentId}, verified=${demoAgentInfo.verified}`);
    log(id, `Caller agent: ID #${callerAgentInfo.agentId}, verified=${callerAgentInfo.verified}`);
    log(id, `sameHuman(#${demoAgentInfo.agentId}, #${callerAgentInfo.agentId}) = ${sameHuman}`);

    // Verify response came from demo agent
    const demoSig = res.headers.get("x-self-agent-signature");
    const demoAddr = res.headers.get("x-self-agent-address");
    const demoTs = res.headers.get("x-self-agent-timestamp");
    let responseSigVerified = false;

    dispatch({ type: "UPDATE_TEST", testId: id, state: { steps: makeSteps(steps, 2, t) } });
    log(id, "Verifying demo agent's response signature...");
    if (demoAddr) log(id, `x-self-agent-address: ${shortAddr(demoAddr)}`);
    if (demoSig) log(id, `x-self-agent-signature: ${shortAddr(demoSig)}`);
    if (demoTs) log(id, `x-self-agent-timestamp: ${demoTs}`);

    if (demoSig && demoTs) {
      const responseVerifier = new SelfAgentVerifier({
        registryAddress: net.registryAddress,
        rpcUrl: net.rpcUrl,
        maxAgentsPerHuman: 0,
        includeCredentials: false,
      });
      const sigCheck = await responseVerifier.verify({
        signature: demoSig,
        timestamp: demoTs,
        method: "POST",
        url: agentUrl,
        body: responseBody || undefined,
      });

      const expectedDemoAddr = (net.demoAgentAddress || demoAgentInfo.address || "").toLowerCase();
      if (net.demoAgentAddress && demoAgentInfo.address) {
        const payloadDemoAddr = demoAgentInfo.address.toLowerCase();
        if (payloadDemoAddr !== net.demoAgentAddress.toLowerCase()) {
          log(
            id,
            `Demo agent payload address mismatch: expected ${shortAddr(net.demoAgentAddress)}, got ${shortAddr(demoAgentInfo.address)}`,
          );
          dispatch({
            type: "UPDATE_TEST",
            testId: id,
            state: {
              status: "error",
              steps: makeSteps(steps, 2, t, true),
              error: "Demo agent identity mismatch",
            },
          });
          return;
        }
      }
      responseSigVerified =
        sigCheck.valid &&
        expectedDemoAddr.length > 0 &&
        sigCheck.agentAddress.toLowerCase() === expectedDemoAddr;

      if (responseSigVerified) {
        log(id, "Response signature verified against on-chain demo agent identity \u2713");
      } else {
        log(id, `Response signature invalid: ${sigCheck.error || "address mismatch"}`);
        dispatch({
          type: "UPDATE_TEST",
          testId: id,
          state: {
            status: "error",
            steps: makeSteps(steps, 2, t, true),
            error: sigCheck.error || "Demo agent response signature invalid",
          },
        });
        return;
      }
    } else {
      log(id, "Missing response signature headers");
      dispatch({
        type: "UPDATE_TEST",
        testId: id,
        state: {
          status: "error",
          steps: makeSteps(steps, 2, t, true),
          error: "Demo agent response was not signed",
        },
      });
      return;
    }

    if (message) log(id, `"${message}"`);

    const totalElapsed = Math.round(performance.now() - totalStart);
    log(id, `Test complete (${totalElapsed}ms total)`);

    t.push(0);
    dispatch({
      type: "UPDATE_TEST",
      testId: id,
      state: {
        status: "success",
        steps: allDone(steps, t),
        result: (
          <div className="space-y-1 text-xs">
            <p className="text-accent-success font-bold text-sm">Agent-to-Agent Verified</p>
            <p className="text-muted">
              Your agent: <span className={callerAgentInfo.verified ? "text-accent-success" : "text-accent-error"}>
                {callerAgentInfo.verified ? "Verified" : "Not verified"}
              </span> (ID #{callerAgentInfo.agentId ?? "unknown"})
            </p>
            <p className="text-muted">
              Demo agent: <span className={demoAgentInfo.verified ? "text-accent-success" : "text-accent-error"}>
                {demoAgentInfo.verified ? "Verified" : "Not registered"}
              </span> (ID #{demoAgentInfo.agentId ?? "unknown"})
            </p>
            <p className="text-muted">
              Same human: <span className={sameHuman ? "text-accent-success" : "text-foreground"}>
                {sameHuman ? "Yes" : "No (different humans)"}
              </span>
            </p>
            <p className="text-muted">
              Response signed by: <span className="font-mono text-foreground">
                {demoAddr ? shortAddr(demoAddr) : "unsigned"}
              </span>
              {responseSigVerified ? " \u2713 verified" : " (invalid signature)"}
            </p>
            {message && (
              <p className="text-muted italic mt-1">&ldquo;{message}&rdquo;</p>
            )}
          </div>
        ),
      },
    });
  } catch (err) {
    log(id, `Error: ${err instanceof Error ? err.message : "Agent-to-agent request failed"}`);
    dispatch({
      type: "UPDATE_TEST",
      testId: id,
      state: {
        status: "error",
        steps: makeSteps(steps, 0, t, true),
        error: err instanceof Error ? err.message : "Agent-to-agent request failed",
      },
    });
  }
}

async function runGateTest(
  agent: SelfAgent,
  privateKey: string,
  agentLabel: string,
  dispatch: Dispatch,
  log: LogFn,
  net: NetworkConfig,
) {
  const id = "gate";
  const steps = [
    "Read nonce + sign EIP-712 meta-transaction...",
    "POST /api/demo/chain-verify (relayer submits tx)...",
    "Waiting for block confirmation...",
  ];
  const t: (number | undefined)[] = [];
  const totalStart = performance.now();

  try {
    log(id, `Starting Agent-to-Chain test...`);
    log(id, `Agent: ${agentLabel}`);

    // Step 0: Read nonce + EIP-712 signing
    dispatch({ type: "UPDATE_TEST", testId: id, state: { steps: makeSteps(steps, 0, t) } });
    await new Promise((r) => setTimeout(r, 0));

    const agentKey = ethers.zeroPadValue(agent.address, 32);
    const provider = new ethers.JsonRpcProvider(net.rpcUrl);
    const verifierContract = new ethers.Contract(
      net.agentDemoVerifierAddress,
      AGENT_DEMO_VERIFIER_ABI,
      provider,
    );

    log(id, "Reading nonce from contract...");
    const nonce = await verifierContract.nonces(agentKey);
    log(id, `nonce=${nonce.toString()}`);

    const deadline = Math.floor(Date.now() / 1000) + 300;
    log(id, "Constructing EIP-712 typed data (MetaVerify)");
    log(id, `domain: AgentDemoVerifier v1, chainId=${net.chainId}, deadline=${deadline}`);

    // Use raw wallet if private key available, otherwise prompt browser wallet
    let eip712Signer: ethers.Signer & { signTypedData: typeof ethers.Wallet.prototype.signTypedData };
    if (privateKey) {
      eip712Signer = new ethers.Wallet(privateKey);
      log(id, "Signing EIP-712 with agent key (secp256k1)...");
    } else if (window.ethereum) {
      const browserProvider = new ethers.BrowserProvider(window.ethereum);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      eip712Signer = await browserProvider.getSigner() as any;
      log(id, "Signing EIP-712 via browser wallet...");
    } else {
      throw new Error("No private key or browser wallet available for EIP-712 signing.");
    }

    const eip712Signature = await eip712Signer.signTypedData(
      {
        name: "AgentDemoVerifier",
        version: "1",
        chainId: BigInt(net.chainId),
        verifyingContract: net.agentDemoVerifierAddress as `0x${string}`,
      },
      EIP712_TYPES,
      { agentKey, nonce, deadline },
    );
    log(id, `EIP-712 signature: ${shortAddr(eip712Signature)}`);

    const t0 = performance.now();
    t.push(Math.round(t0 - totalStart));

    // Step 1: POST to chain-verify
    dispatch({ type: "UPDATE_TEST", testId: id, state: { steps: makeSteps(steps, 1, t) } });
    log(id, "Signing HTTP request via SDK...");
    log(id, "POST /api/demo/chain-verify — awaiting response...");

    const res = await agent.fetch(window.location.origin + "/api/demo/chain-verify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        agentKey,
        nonce: nonce.toString(),
        deadline,
        eip712Signature,
        networkId: net.id,
      }),
    });

    const elapsed1 = Math.round(performance.now() - t0);
    t.push(elapsed1);

    const data = await res.json();

    if (!res.ok) {
      log(id, `HTTP ${res.status} — ${data.error || "failed"}`);
      dispatch({
        type: "UPDATE_TEST",
        testId: id,
        state: {
          status: "error",
          steps: makeSteps(steps, 1, t, true),
          error: data.error || "Chain verification failed",
        },
      });
      return;
    }

    // Step 2: confirmed
    dispatch({ type: "UPDATE_TEST", testId: id, state: { steps: makeSteps(steps, 2, t) } });

    log(id, `HTTP ${res.status} — tx submitted (${elapsed1}ms)`);
    log(id, `tx ${data.txHash?.slice(0, 10)}...${data.txHash?.slice(-8)} confirmed in block #${data.blockNumber}`);
    log(id, `On-chain: signer verified as ${shortAddr(agent.address)}`);
    if (data.credentials) {
      log(id, `AgentChainVerified(agent=#${data.agentId}, age=${data.credentials.olderThan}+, ${data.credentials.nationality})`);
    }
    log(id, `Verification #${data.verificationCount} for agent, #${data.totalVerifications} total`);
    if (data.rateLimitRemaining != null) {
      log(id, `${data.rateLimitRemaining} verification${data.rateLimitRemaining === 1 ? "" : "s"} remaining this hour`);
    }
    log(id, `Explorer: ${data.explorerUrl}`);

    const totalElapsed = Math.round(performance.now() - totalStart);
    log(id, `Test complete (${totalElapsed}ms total)`);

    t.push(0);
    dispatch({
      type: "UPDATE_TEST",
      testId: id,
      state: {
        status: "success",
        steps: allDone(steps, t),
        result: (
          <div className="space-y-1 text-xs">
            <p className="text-accent-success font-bold text-sm">Verified On-Chain ({net.isTestnet ? "Celo Sepolia" : "Celo Mainnet"})</p>
            <p className="text-muted">
              Tx:{" "}
              <a
                href={data.explorerUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-accent hover:underline font-mono"
              >
                {data.txHash.slice(0, 10)}...{data.txHash.slice(-8)}
              </a>
            </p>
            <p className="text-muted">
              Block: <span className="text-foreground font-mono">#{data.blockNumber}</span>
            </p>
            <p className="text-muted">
              Agent ID: <span className="text-foreground font-mono">#{data.agentId}</span>
            </p>
            {data.credentials?.nationality && (
              <p className="text-muted">
                Nationality: <span className="text-foreground">{data.credentials.nationality}</span>
              </p>
            )}
            {data.credentials?.olderThan && Number(data.credentials.olderThan) > 0 && (
              <p className="text-muted">
                Age: <span className="text-foreground">{data.credentials.olderThan}+</span>
              </p>
            )}
            <p className="text-muted">
              Verification #{data.verificationCount} for agent, #{data.totalVerifications} total
            </p>
            {data.rateLimitRemaining != null && (
              <p className="text-muted">
                {data.rateLimitRemaining} remaining this hour
              </p>
            )}
            {data.gasUsed && (
              <p className="text-muted">
                Gas used: <span className="text-foreground font-mono">{Number(data.gasUsed).toLocaleString()}</span>
              </p>
            )}
          </div>
        ),
      },
    });
  } catch (err) {
    log(id, `Error: ${err instanceof Error ? err.message : "Chain verification failed"}`);
    dispatch({
      type: "UPDATE_TEST",
      testId: id,
      state: {
        status: "error",
        steps: makeSteps(steps, 0, t, true),
        error: err instanceof Error ? err.message : "Chain verification failed",
      },
    });
  }
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function DemoPage() {
  const [state, dispatch] = useReducer(reducer, initialState);
  const { network } = useNetwork();
  const agentRef = useRef<SelfAgent | null>(null);
  const privateKeyRef = useRef<string>("");
  const chatUnlockedRef = useRef(false);
  const [setupMode, setSetupMode] = useState<
    "private-key" | "passkey" | "wallet"
  >("private-key");
  const [passkeyAvailable, setPasskeyAvailable] = useState(false);
  const [passkeyLoading, setPasskeyLoading] = useState(false);
  const [loadedViaPasskey, setLoadedViaPasskey] = useState(false);
  const [passkeyWalletAddress, setPasskeyWalletAddress] = useState<string | null>(null);
  const [passkeyHasSigningKey, setPasskeyHasSigningKey] = useState(false);
  const [passkeyKeyInput, setPasskeyKeyInput] = useState("");
  const [passkeyKeyError, setPasskeyKeyError] = useState("");
  const [walletLoading, setWalletLoading] = useState(false);
  const [walletAddress, setWalletAddress] = useState<string | null>(null);
  const [walletError, setWalletError] = useState("");

  // Unique session ID — regenerated on every page load so the AI treats
  // each visit as a fresh encounter with no memory of prior sessions.
  const sessionId = useMemo(() => crypto.randomUUID(), []);

  // Keep ref in sync so the chat callback can read current unlock state
  chatUnlockedRef.current = state.chatUnlocked;

  useEffect(() => {
    setPasskeyAvailable(isPasskeySupported());
  }, []);

  const log = useCallback(
    (testId: string, message: string) => {
      dispatch({ type: "ADD_LOG", testId, message });
    },
    [],
  );

  // ---- Setup ----

  const handleLoadAgent = useCallback(async () => {
    dispatch({ type: "LOADING" });
    const bootLog = (msg: string) => dispatch({ type: "ADD_LOG", testId: "agent", message: msg });
    const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

    try {
      let key = state.privateKey.trim();
      if (!key.startsWith("0x")) key = "0x" + key;

      bootLog("Initializing Self Agent SDK...");
      await delay(150);

      const agent = new SelfAgent({
        privateKey: key,
        registryAddress: network.registryAddress,
        rpcUrl: network.rpcUrl,
      });

      agentRef.current = agent;
      privateKeyRef.current = key;
      saveAgentPrivateKey({ agentAddress: agent.address, privateKey: key });
      setLoadedViaPasskey(false);
      setPasskeyWalletAddress(null);
      setPasskeyHasSigningKey(true);
      setPasskeyKeyInput("");
      setPasskeyKeyError("");

      bootLog(`Agent address: ${shortAddr(agent.address)}`);
      await delay(100);

      const rpcHost = network.rpcUrl.replace(/^https?:\/\//, "").split("/")[0];
      bootLog(`Connecting to ${network.isTestnet ? "Celo Sepolia" : "Celo"} (RPC: ${rpcHost})...`);
      await delay(100);

      bootLog(`Checking on-chain registry (${shortAddr(network.registryAddress)})...`);
      const registered = await agent.isRegistered();
      if (!registered) {
        bootLog("ERROR: Agent not found in registry. Register at /register first.");
        dispatch({
          type: "SETUP_ERROR",
          error: "Agent not registered. Register at /register first.",
        });
        return;
      }

      const info = await agent.getInfo();
      bootLog(`Agent ID: #${info.agentId} — ${info.isVerified ? "Verified" : "Not verified"}`);
      await delay(100);

      // Check proof provider
      const provider = new ethers.JsonRpcProvider(network.rpcUrl);
      const contract = new ethers.Contract(network.registryAddress, REGISTRY_ABI, provider);

      try {
        const providerAddr = await contract.agentProofProvider(info.agentId);
        bootLog(`Proof provider: ${shortAddr(providerAddr)}`);
      } catch {
        // Provider not available
      }
      await delay(100);

      // Fetch credentials
      let credentials: AgentCredentials | undefined;
      try {
        const raw = await contract.getAgentCredentials(info.agentId);
        const creds: AgentCredentials = {
          issuingState: raw.issuingState ?? raw[0] ?? "",
          name: raw.name ?? raw[1] ?? [],
          nationality: raw.nationality ?? raw[3] ?? "",
          dateOfBirth: raw.dateOfBirth ?? raw[4] ?? "",
          gender: raw.gender ?? raw[5] ?? "",
          expiryDate: raw.expiryDate ?? raw[6] ?? "",
          olderThan: raw.olderThan ?? raw[7] ?? 0n,
          ofac: raw.ofac ?? raw[8] ?? [false, false, false],
        };
        if (creds.nationality || creds.olderThan > 0n) {
          credentials = creds;
          const parts: string[] = [];
          if (creds.nationality) parts.push(`nationality=${creds.nationality}`);
          if (creds.olderThan > 0n) parts.push(`olderThan=${creds.olderThan.toString()}`);
          if (creds.ofac?.some(Boolean)) parts.push("ofac=[clear]");
          bootLog(`Credentials loaded: ${parts.join(", ")}`);
        } else {
          bootLog("No ZK-attested credentials found");
        }
      } catch {
        bootLog("No ZK-attested credentials found");
      }
      await delay(100);

      // Log verification config from credentials
      if (credentials) {
        const configParts: string[] = [];
        if (credentials.olderThan > 0n) configParts.push(`age >= ${credentials.olderThan.toString()}`);
        if (credentials.ofac?.some(Boolean)) configParts.push("OFAC screening enabled");
        if (configParts.length > 0) {
          bootLog(`Verification config: ${configParts.join(", ")}`);
        }
      }
      await delay(80);

      bootLog("Signing protocol: ECDSA + x-self-agent-* headers");
      await delay(80);

      // Log target endpoints
      const serviceHost = network.demoServiceUrl ? new URL(network.demoServiceUrl).host : "localhost";
      const agentHost = network.demoAgentUrl ? new URL(network.demoAgentUrl).host : "localhost";
      bootLog(`Demo service endpoint: ${serviceHost}`);
      bootLog(`Demo agent endpoint: ${agentHost}`);
      await delay(80);

      bootLog("Agent ready.");

      dispatch({
        type: "SETUP_DONE",
        agent: {
          address: info.address,
          agentKey: info.agentKey,
          agentId: info.agentId.toString(),
          isVerified: info.isVerified,
          credentials,
        },
      });
    } catch (err) {
      bootLog(`ERROR: ${err instanceof Error ? err.message : "Failed to load agent"}`);
      dispatch({
        type: "SETUP_ERROR",
        error: err instanceof Error ? err.message : "Failed to load agent",
      });
    }
  }, [state.privateKey, network]);

  const handleLoadAgentWithPasskey = useCallback(async () => {
    if (!passkeyAvailable) {
      dispatch({
        type: "SETUP_ERROR",
        error: "Passkeys are not supported in this browser.",
      });
      return;
    }

    dispatch({ type: "LOADING" });
    setPasskeyLoading(true);
    setPasskeyHasSigningKey(false);
    setPasskeyKeyInput("");
    setPasskeyKeyError("");
    const bootLog = (msg: string) => dispatch({ type: "ADD_LOG", testId: "agent", message: msg });

    try {
      bootLog("Authenticating with passkey...");
      const { walletAddress } = await signInWithPasskey(network);
      setPasskeyWalletAddress(walletAddress);
      bootLog(`Passkey smart wallet: ${shortAddr(walletAddress)}`);

      const provider = new ethers.JsonRpcProvider(network.rpcUrl);
      const registry = new ethers.Contract(network.registryAddress, REGISTRY_ABI, provider);

      bootLog("Scanning registry for guardian-managed agents...");
      const mintFilter = registry.filters.Transfer(ethers.ZeroAddress, null);
      const latestBlock = await provider.getBlockNumber();
      const blockWindow = 50_000;

      let selected:
        | {
            agentId: bigint;
            agentKey: string;
            address: string;
            credentials?: AgentCredentials;
          }
        | undefined;

      for (let toBlock = latestBlock; toBlock >= 0 && !selected; toBlock -= blockWindow) {
        const fromBlock = Math.max(0, toBlock - blockWindow + 1);
        const mintEvents = await registry.queryFilter(mintFilter, fromBlock, toBlock);

        for (let i = mintEvents.length - 1; i >= 0; i -= 1) {
          const logEvent = mintEvents[i] as ethers.EventLog;
          const agentId = logEvent.args[2] as bigint;

          try {
            const guardian: string = await registry.agentGuardian(agentId);
            if (guardian.toLowerCase() !== walletAddress.toLowerCase()) continue;

            const agentKey: string = await registry.agentIdToAgentKey(agentId);
            const isVerified: boolean = await registry.isVerifiedAgent(agentKey);
            if (!isVerified) continue;

            const address = "0x" + agentKey.slice(26);

            let credentials: AgentCredentials | undefined;
            try {
              const raw = await registry.getAgentCredentials(agentId);
              const creds: AgentCredentials = {
                issuingState: raw.issuingState ?? raw[0] ?? "",
                name: raw.name ?? raw[1] ?? [],
                nationality: raw.nationality ?? raw[3] ?? "",
                dateOfBirth: raw.dateOfBirth ?? raw[4] ?? "",
                gender: raw.gender ?? raw[5] ?? "",
                expiryDate: raw.expiryDate ?? raw[6] ?? "",
                olderThan: raw.olderThan ?? raw[7] ?? 0n,
                ofac: raw.ofac ?? raw[8] ?? [false, false, false],
              };
              if (creds.nationality || creds.olderThan > 0n) credentials = creds;
            } catch {
              // credentials are optional
            }

            selected = { agentId, agentKey, address, credentials };
            break;
          } catch {
            // Skip entries that don't expose guardian fields or were burned
          }
        }
      }

      if (!selected) {
        dispatch({
          type: "SETUP_ERROR",
          error: "No verified guardian-managed agents found for this passkey.",
        });
        return;
      }

      setLoadedViaPasskey(true);
      setPasskeyKeyError("");
      setPasskeyKeyInput("");

      // Try to recover a locally cached agent key so passkey mode can run signed tests.
      const cachedKey =
        getAgentPrivateKeyByAgent(selected.address) || getAgentPrivateKeyByGuardian(walletAddress);
      let signingReady = false;
      if (cachedKey) {
        try {
          const signerAgent = new SelfAgent({
            privateKey: cachedKey,
            registryAddress: network.registryAddress,
            rpcUrl: network.rpcUrl,
          });
          if (signerAgent.address.toLowerCase() !== selected.address.toLowerCase()) {
            throw new Error("Cached key does not match selected agent.");
          }
          agentRef.current = signerAgent;
          privateKeyRef.current = cachedKey;
          saveAgentPrivateKey({
            agentAddress: signerAgent.address,
            privateKey: cachedKey,
            guardianAddress: walletAddress,
          });
          signingReady = true;
          bootLog("Recovered local agent signing key. Signed tests are enabled.");
        } catch {
          agentRef.current = null;
          privateKeyRef.current = "";
        }
      } else {
        agentRef.current = null;
        privateKeyRef.current = "";
      }
      setPasskeyHasSigningKey(signingReady);

      bootLog(
        `Loaded guardian-managed agent #${selected.agentId.toString()} (${shortAddr(selected.address)})`,
      );
      if (!signingReady) {
        bootLog("Passkey mode loaded. Add this agent key once to run signed tests.");
      }

      dispatch({
        type: "SETUP_DONE",
        agent: {
          address: selected.address,
          agentKey: selected.agentKey,
          agentId: selected.agentId.toString(),
          isVerified: true,
          credentials: selected.credentials,
        },
      });
    } catch (err) {
      dispatch({
        type: "SETUP_ERROR",
        error: err instanceof Error ? err.message : "Passkey sign-in failed",
      });
    } finally {
      setPasskeyLoading(false);
    }
  }, [network, passkeyAvailable]);

  const handleAttachPasskeyAgentKey = useCallback(() => {
    if (!state.agent || !loadedViaPasskey) return;
    let key = passkeyKeyInput.trim();
    if (!key) {
      setPasskeyKeyError("Enter the agent private key.");
      return;
    }
    if (!key.startsWith("0x")) key = `0x${key}`;

    try {
      const signerAgent = new SelfAgent({
        privateKey: key,
        registryAddress: network.registryAddress,
        rpcUrl: network.rpcUrl,
      });
      if (signerAgent.address.toLowerCase() !== state.agent.address.toLowerCase()) {
        throw new Error("This private key does not match the passkey-selected agent.");
      }
      agentRef.current = signerAgent;
      privateKeyRef.current = key;
      saveAgentPrivateKey({
        agentAddress: signerAgent.address,
        privateKey: key,
        guardianAddress: passkeyWalletAddress || undefined,
      });
      setPasskeyHasSigningKey(true);
      setPasskeyKeyInput("");
      setPasskeyKeyError("");
      log("agent", "Agent signing key attached. Signed tests are now enabled.");
    } catch (err) {
      setPasskeyHasSigningKey(false);
      setPasskeyKeyError(
        err instanceof Error ? err.message : "Failed to attach agent private key.",
      );
    }
  }, [state.agent, loadedViaPasskey, passkeyKeyInput, network, passkeyWalletAddress, log]);

  const handleConnectWallet = useCallback(async () => {
    setWalletLoading(true);
    setWalletError("");
    try {
      if (!window.ethereum) {
        throw new Error("No wallet detected. Install MetaMask or another browser wallet.");
      }
      const provider = new ethers.BrowserProvider(window.ethereum);
      const signer = await provider.getSigner();
      const address = await signer.getAddress();

      // Derive agent key (simple mode: address = agent)
      const agentKey = ethers.zeroPadValue(address, 32);

      // Check on-chain
      const rpcProvider = new ethers.JsonRpcProvider(network.rpcUrl);
      const registry = new ethers.Contract(
        network.registryAddress,
        REGISTRY_ABI,
        rpcProvider
      );
      const isVerified = await registry.isVerifiedAgent(agentKey);

      if (!isVerified) {
        throw new Error(
          "This wallet is not registered as a verified agent. " +
          "Register first using Simple (Verified Wallet) mode."
        );
      }

      // Create SelfAgent with wallet signer
      const agent = new SelfAgent({ signer, network: network.isTestnet ? "testnet" : "mainnet" });
      agentRef.current = agent;
      privateKeyRef.current = ""; // no raw key — wallet signs directly
      setWalletAddress(address);

      // Load agent info
      const agentId = await registry.getAgentId(agentKey);

      dispatch({
        type: "SETUP_DONE",
        agent: {
          address,
          agentKey,
          agentId: agentId.toString(),
          isVerified: true,
        },
      });
    } catch (err) {
      setWalletError(err instanceof Error ? err.message : "Failed to connect wallet");
    } finally {
      setWalletLoading(false);
    }
  }, [network]);

  // ---- Tests ----

  const runAllTests = useCallback(async () => {
    const agent = agentRef.current;
    const pk = privateKeyRef.current;
    const hasWallet = !!walletAddress;
    if (!state.agent || !agent || (!pk && !hasWallet)) {
      const setupError = loadedViaPasskey
        ? "Passkey mode needs this agent signing key. Add it once to run signed tests."
        : "No agent loaded — enter a private key above";
      dispatch({ type: "START_TESTS" });
      for (const id of ["service", "peer", "gate"]) {
        dispatch({
          type: "UPDATE_TEST",
          testId: id,
          state: {
            status: "error",
            steps: makeSteps(["Loading agent..."], 0, undefined, true),
            error: setupError,
          },
        });
      }
      return;
    }

    dispatch({ type: "START_TESTS" });
    log("agent", "--- Running all tests ---");

    const agentLabel = `${shortAddr(agent.address)} (ID #${state.agent.agentId}${state.agent.credentials ? `, ${state.agent.credentials.olderThan.toString()}+ ${state.agent.credentials.nationality}` : ""})`;

    // When using browser wallet (no raw private key), each agent.fetch() triggers
    // a wallet popup for personal_sign. Running tests in parallel would fire
    // multiple concurrent signing requests, overwhelming the wallet UI and causing
    // rejections. Run sequentially in wallet mode so the user approves one at a time.
    if (!pk && hasWallet) {
      log("agent", "Browser wallet detected — running tests sequentially to avoid concurrent signing popups");
      await runServiceTest(agent, agentLabel, dispatch, log, network);
      await runPeerTest(agent, agentLabel, dispatch, log, network);
      await runGateTest(agent, pk, agentLabel, dispatch, log, network);
    } else {
      await Promise.all([
        runServiceTest(agent, agentLabel, dispatch, log, network),
        runPeerTest(agent, agentLabel, dispatch, log, network),
        runGateTest(agent, pk, agentLabel, dispatch, log, network),
      ]);
    }
  }, [state.agent, loadedViaPasskey, walletAddress, log, network]);

  const runFakeAgent = useCallback(async () => {
    const fakeWallet = ethers.Wallet.createRandom();
    const fakeAgent = new SelfAgent({
      privateKey: fakeWallet.privateKey,
      registryAddress: network.registryAddress,
      rpcUrl: network.rpcUrl,
    });

    dispatch({ type: "START_TESTS" });
    log("agent", "--- Running all tests (FAKE agent) ---");

    const fakeLabel = `${shortAddr(fakeWallet.address)} (unregistered)`;
    log("service", `Starting test with FAKE agent...`);
    log("service", `Generated random key: ${shortAddr(fakeWallet.address)} (unregistered)`);
    log("peer", `Starting test with FAKE agent...`);
    log("peer", `Generated random key: ${shortAddr(fakeWallet.address)} (unregistered)`);
    log("gate", `Starting test with FAKE agent...`);
    log("gate", `Generated random key: ${shortAddr(fakeWallet.address)} (unregistered)`);

    await Promise.all([
      runServiceTest(fakeAgent, fakeLabel, dispatch, log, network),
      runPeerTest(fakeAgent, fakeLabel, dispatch, log, network),
      runGateTest(fakeAgent, fakeWallet.privateKey, fakeLabel, dispatch, log, network),
    ]);
  }, [log, network]);

  // ---- Chat ----

  const sendChatMessage = useCallback(
    async (query: string) => {
      dispatch({ type: "SET_CHAT_INPUT", value: "" });
      dispatch({ type: "ADD_CHAT_MESSAGE", message: { role: "user", content: query } });
      dispatch({ type: "CHAT_LOADING", loading: true });
      log("chat", `User: ${query}`);

      try {
        const chatUrl = window.location.origin + `/api/demo/chat?network=${network.id}`;
        const agent = agentRef.current;
        const unlocked = chatUnlockedRef.current;
        let res: Response;

        log("chat", `chatUnlocked=${unlocked}, agentLoaded=${!!agent}`);

        if (agent && unlocked) {
          // Tests passed — send signed request with agent identity
          log("chat", `Sending SIGNED request (agent ${shortAddr(agent.address)})...`);
          res = await agent.fetch(chatUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ query, session_id: sessionId }),
          });
        } else {
          // Tests NOT passed or no agent — send anonymous (LangChain will hard-refuse)
          if (agent && !unlocked) {
            log("chat", "Agent loaded but tests not passed yet — sending as ANONYMOUS");
          } else {
            log("chat", "No agent loaded — sending as ANONYMOUS");
          }
          res = await fetch(chatUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ query, session_id: sessionId }),
          });
        }

        const data = await res.json();
        log("chat", `Response: HTTP ${res.status}, verified=${data.verified ?? "n/a"}, agent=${data.agent ?? "n/a"}`);

        if (!res.ok) {
          const errMsg = data.error || `HTTP ${res.status}`;
          log("chat", `Error: ${errMsg}`);
          dispatch({
            type: "ADD_CHAT_MESSAGE",
            message: { role: "agent", content: `Error: ${errMsg}` },
          });
        } else {
          log("chat", `Agent: ${data.response?.slice(0, 100)}${data.response?.length > 100 ? "..." : ""}`);
          dispatch({
            type: "ADD_CHAT_MESSAGE",
            message: { role: "agent", content: data.response },
          });
        }
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : "Request failed";
        log("chat", `Error: ${errMsg}`);
        dispatch({
          type: "ADD_CHAT_MESSAGE",
          message: { role: "agent", content: `Error: ${errMsg}` },
        });
      } finally {
        dispatch({ type: "CHAT_LOADING", loading: false });
      }
    },
    [log, network, sessionId],
  );

  // ---- Render ----

  const testIcons = { service: ShieldCheck, peer: Users, gate: Lock } as const;

  return (
    <main className="min-h-screen max-w-5xl mx-auto px-6 pt-24 pb-12 space-y-8">
      {/* Header */}
      <div className="text-center">
        <div className="flex justify-center mb-2">
          <MatrixText text="Live Demo" fontSize={42} />
        </div>
        <p className="text-muted max-w-lg mx-auto">
          Test Self Agent ID integration end-to-end. Load your registered agent,
          then run real verification tests against on-chain contracts and service endpoints.
        </p>
        <p className="text-xs text-subtle max-w-lg mx-auto mt-2">
          Don&apos;t have an agent yet?{" "}
          <a href="/agents/register" className="text-accent hover:text-accent-2 underline underline-offset-2">Register via dApp</a>
          {" "}or use the{" "}
          <a href="/cli" className="text-accent hover:text-accent-2 underline underline-offset-2">CLI</a>
          {" "}for terminal and agent-guided workflows.
        </p>
      </div>

      {/* Setup / Agent Info Card */}
      {!state.agent ? (
        <Card className="max-w-md mx-auto">
          <h2 className="font-semibold mb-4">Load Your Agent</h2>
          <div className="flex gap-2 mb-4">
            <button
              type="button"
              onClick={() => setSetupMode("private-key")}
              className={`flex-1 px-3 py-2 rounded-lg text-sm font-medium border transition-colors flex items-center justify-center gap-1.5 ${
                setupMode === "private-key"
                  ? "bg-surface-2 border-accent text-foreground"
                  : "bg-surface-1 border-border text-muted hover:text-foreground"
              }`}
            >
              <KeyRound className="w-3.5 h-3.5" />
              Private Key
            </button>
            <button
              type="button"
              onClick={() => passkeyAvailable && setSetupMode("passkey")}
              disabled={!passkeyAvailable}
              className={`flex-1 px-3 py-2 rounded-lg text-sm font-medium border transition-colors flex items-center justify-center gap-1.5 ${
                !passkeyAvailable
                  ? "bg-surface-1 border-border text-muted/40 cursor-not-allowed"
                  : setupMode === "passkey"
                    ? "bg-surface-2 border-accent-success text-foreground"
                    : "bg-surface-1 border-border text-muted hover:text-foreground"
              }`}
            >
              <Fingerprint className="w-3.5 h-3.5" />
              Passkey
            </button>
            <button
              type="button"
              onClick={() => setSetupMode("wallet")}
              className={`flex-1 px-3 py-2 rounded-lg text-sm font-medium border transition-colors flex items-center justify-center gap-1.5 ${
                setupMode === "wallet"
                  ? "bg-surface-2 border-accent text-foreground"
                  : "bg-surface-1 border-border text-muted hover:text-foreground"
              }`}
            >
              <Wallet className="w-3.5 h-3.5" />
              Wallet
            </button>
          </div>

          {setupMode === "private-key" ? (
            <>
              <p className="text-xs text-muted mb-4">
                Enter the private key of a registered agent. The key stays in your browser
                and is never sent to the server.
              </p>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  handleLoadAgent();
                }}
                className="space-y-3"
              >
                <div className="relative">
                  <input
                    type={state.showKey ? "text" : "password"}
                    value={state.privateKey}
                    onChange={(e) => dispatch({ type: "SET_KEY", key: e.target.value })}
                    placeholder="0x... (agent private key)"
                    className="w-full px-4 py-3 pr-10 bg-surface-2 border border-border rounded-lg focus:border-accent focus:ring-0 font-mono text-sm"
                  />
                  <button
                    type="button"
                    onClick={() => dispatch({ type: "TOGGLE_KEY" })}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted hover:text-foreground"
                  >
                    {state.showKey ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                </div>

                <Button
                  type="submit"
                  disabled={state.loading || !state.privateKey.trim()}
                  className="w-full"
                >
                  {state.loading ? (
                    <>
                      <Loader2 size={16} className="animate-spin" />
                      Loading...
                    </>
                  ) : (
                    <>
                      <Rocket size={16} />
                      Load Agent
                    </>
                  )}
                </Button>
              </form>
            </>
          ) : setupMode === "passkey" ? (
            <div className="space-y-3">
              <p className="text-xs text-muted">
                Sign in with your passkey to load the guardian-managed agent tied to your smart wallet.
              </p>
              <Button
                type="button"
                onClick={handleLoadAgentWithPasskey}
                disabled={state.loading || passkeyLoading || !passkeyAvailable}
                className="w-full"
              >
                {passkeyLoading ? (
                  <>
                    <Loader2 size={16} className="animate-spin" />
                    Authenticating...
                  </>
                ) : (
                  <>
                    <Fingerprint size={16} />
                    Sign in with Passkey
                  </>
                )}
              </Button>
            </div>
          ) : (
            <>
              <p className="text-xs text-muted mb-4">
                Connect your browser wallet to load a Simple (Verified Wallet)
                mode agent. Your wallet address is your agent identity.
              </p>
              {walletError && (
                <div className="flex items-start gap-2 bg-red-500/10 border border-red-500/30 rounded-lg p-3 mb-4">
                  <AlertCircle className="w-4 h-4 text-red-400 mt-0.5 flex-shrink-0" />
                  <p className="text-xs text-red-400">{walletError}</p>
                </div>
              )}
              <Button
                onClick={handleConnectWallet}
                disabled={walletLoading}
                className="w-full"
              >
                {walletLoading ? (
                  <Loader2 className="w-4 h-4 animate-spin mr-2" />
                ) : (
                  <Wallet className="w-4 h-4 mr-2" />
                )}
                {walletLoading ? "Connecting..." : "Connect Wallet"}
              </Button>
            </>
          )}

          {state.setupError && (
            <div className="flex items-start gap-2 text-accent-error text-sm mt-3">
              <AlertCircle size={16} className="mt-0.5 shrink-0" />
              <span>{state.setupError}</span>
            </div>
          )}
        </Card>
      ) : (
        <Card variant="success" className="max-w-md mx-auto">
          <div className="flex items-center gap-2 mb-3">
            <ShieldCheck size={20} className="text-accent-success" />
            <span className="font-semibold">Agent Loaded</span>
            <button
              onClick={() => {
                dispatch({ type: "RESET" });
                setLoadedViaPasskey(false);
                setPasskeyWalletAddress(null);
                setPasskeyHasSigningKey(false);
                setPasskeyKeyInput("");
                setPasskeyKeyError("");
                setWalletAddress(null);
                setWalletError("");
                setSetupMode("private-key");
              }}
              className="ml-auto text-xs text-muted hover:text-foreground"
            >
              Change
            </button>
          </div>
          <div className="text-sm space-y-1.5">
            <div className="flex justify-between">
              <span className="text-muted">Address</span>
              <span className="font-mono text-xs">
                {state.agent.address.slice(0, 8)}...{state.agent.address.slice(-6)}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted">Agent ID</span>
              <span className="font-mono">#{state.agent.agentId}</span>
            </div>
            {loadedViaPasskey && (
              <div className="text-xs text-muted pt-1 border-t border-border/60 mt-2">
                Loaded via passkey
                {passkeyWalletAddress ? ` (${shortAddr(passkeyWalletAddress)})` : ""}.
                {passkeyHasSigningKey
                  ? " Local signing key found. Signed tests are enabled."
                  : " Add this agent key once to run signed tests."}
              </div>
            )}
            {loadedViaPasskey && !passkeyHasSigningKey && (
              <div className="mt-3 pt-3 border-t border-border/60 space-y-2">
                <p className="text-xs text-muted">
                  Enter this agent&apos;s private key once. It will be cached in this browser for passkey demo sessions.
                </p>
                <div className="flex gap-2">
                  <input
                    type="password"
                    value={passkeyKeyInput}
                    onChange={(e) => setPasskeyKeyInput(e.target.value)}
                    placeholder="0x... (agent private key)"
                    className="flex-1 px-3 py-2 bg-surface-2 border border-border rounded text-xs font-mono focus:border-accent focus:ring-0"
                  />
                  <Button type="button" size="sm" onClick={handleAttachPasskeyAgentKey}>
                    Attach Key
                  </Button>
                </div>
                {passkeyKeyError && (
                  <p className="text-xs text-accent-error">{passkeyKeyError}</p>
                )}
              </div>
            )}
            {state.agent.credentials && (() => {
              const badges = buildCredentialBadges(state.agent.credentials!).filter(b => b.trim());
              return badges.length > 0 ? (
                <div className="flex flex-wrap gap-1 mt-2">
                  {badges.map((b, i) => (
                    <Badge key={i} variant="success">{b}</Badge>
                  ))}
                </div>
              ) : null;
            })()}
          </div>
        </Card>
      )}

      {/* Test buttons */}
      <div className="flex items-center justify-center gap-3">
        <Button
          onClick={runAllTests}
          disabled={
            state.loading ||
            Object.values(state.tests).some((t) => t.status === "running") ||
            !state.agent ||
            !agentRef.current ||
            (!privateKeyRef.current && !walletAddress)
          }
          size="lg"
        >
          {Object.values(state.tests).some((t) => t.status === "running") ? (
            <>
              <Loader2 size={18} className="animate-spin" />
              Running Tests...
            </>
          ) : (
            <>
              <Rocket size={18} />
              Run All Tests
            </>
          )}
        </Button>
        <Button
          onClick={runFakeAgent}
          disabled={state.loading || Object.values(state.tests).some((t) => t.status === "running")}
          size="lg"
          variant="secondary"
        >
          <Skull size={18} />
          Test with Fake Agent
        </Button>
      </div>
      {loadedViaPasskey && !passkeyHasSigningKey && (
        <p className="text-xs text-subtle text-center">
          Passkey mode is active. Attach this agent&apos;s private key once to enable signed integration tests.
        </p>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {TESTS.filter((t) => t.id !== "chat").map((test) => (
          <TestCard
            key={test.id}
            title={test.title}
            icon={testIcons[test.id as keyof typeof testIcons]}
            description={test.description}
            steps={state.tests[test.id]?.steps ?? []}
            status={state.tests[test.id]?.status ?? "idle"}
            result={state.tests[test.id]?.result ?? null}
            error={state.tests[test.id]?.error ?? null}
            codeSnippet={
              test.id === "service"
                ? getServiceCode(network)
                : test.id === "peer"
                  ? getPeerCode(network)
                  : getGateCode(network)
            }
            codeLanguage="typescript"
          />
        ))}
      </div>

      {/* Live Console Log */}
      <ConsoleLog logs={state.logs} />

      {/* AI Agent Chat — below console, unlocked after tests pass */}
      <ChatSection
        messages={state.chatMessages}
        input={state.chatInput}
        loading={state.chatLoading}
        unlocked={state.chatUnlocked}
        isOpen={state.chatOpen}
        dispatch={dispatch}
        onSend={sendChatMessage}
      />
    </main>
  );
}
