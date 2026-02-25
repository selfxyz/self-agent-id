// SPDX-FileCopyrightText: 2025-2026 Social Connect Labs, Inc.
// SPDX-License-Identifier: BUSL-1.1
// NOTE: Converts to Apache-2.0 on 2029-06-11 per LICENSE.

import { after, before, describe, it } from "node:test";
import assert from "node:assert";
import { mkdtempSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { createServer as createNetServer } from "node:net";
import { ethers } from "ethers";

const CLI_PATH = resolve(__dirname, "..", "cli.js");
const REPO_ROOT = resolve(__dirname, "..", "..", "..");
const HARNESS_SCRIPT = resolve(REPO_ROOT, "scripts", "local-registry-harness.sh");
const DEMO_VERIFIED_ADDRESS = "0x83fa4380903fecb801F4e123835664973001ff00";
const ANVIL_ALT_HUMAN_ADDRESS = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";
const LIVE = process.env.SELF_AGENT_LIVE_TEST === "1";
const CALLBACK_LIVE = process.env.SELF_AGENT_CALLBACK_TEST === "1";

interface CliResult {
  status: number | null;
  stdout: string;
  stderr: string;
}

interface LocalHarness {
  rpcUrl: string;
  chainId: number;
  registryAddress: string;
  anvilPid: number;
  deployerPrivateKey: string;
  deployerAddress: string;
}

let harness: LocalHarness | null = null;

function runCli(args: string[]): CliResult {
  const out = spawnSync(process.execPath, [CLI_PATH, ...args], { encoding: "utf8" });
  return {
    status: out.status,
    stdout: out.stdout || "",
    stderr: out.stderr || "",
  };
}

function createTempSessionPath(): string {
  const dir = mkdtempSync(join(tmpdir(), "self-agent-cli-"));
  return join(dir, "session.json");
}

function runHarness(args: string[]): CliResult {
  const out = spawnSync(HARNESS_SCRIPT, args, { encoding: "utf8" });
  return {
    status: out.status,
    stdout: out.stdout || "",
    stderr: out.stderr || "",
  };
}

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, "utf8")) as T;
}

function requireHarness(): LocalHarness {
  assert.ok(harness, "local harness is required for live tests");
  return harness;
}

function setHarnessAgent(agentAddress: string, agentId: number, verified = true): void {
  const local = requireHarness();
  const key = ethers.zeroPadValue(ethers.getAddress(agentAddress), 32);
  const set = runHarness([
    "set-agent",
    "--rpc-url",
    local.rpcUrl,
    "--registry",
    local.registryAddress,
    "--agent-key",
    key,
    "--agent-id",
    String(agentId),
    "--verified",
    verified ? "true" : "false",
    "--private-key",
    local.deployerPrivateKey,
  ]);
  assert.strictEqual(set.status, 0, set.stderr || set.stdout);
}

async function waitForPort(url: string, payload: Record<string, unknown>): Promise<void> {
  for (let i = 0; i < 60; i += 1) {
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (res.ok) return;
    } catch {
      // listener not ready yet
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error("Callback listener did not accept request in time");
}

async function getFreePort(): Promise<number> {
  return new Promise((resolvePort, rejectPort) => {
    const server = createNetServer();
    server.once("error", rejectPort);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        rejectPort(new Error("Unable to allocate callback port"));
        return;
      }
      const port = address.port;
      server.close(() => resolvePort(port));
    });
  });
}

describe("CLI registration", () => {
  before(async () => {
    if (!LIVE) return;
    const harnessPort = await getFreePort();
    const start = runHarness(["start", "--port", String(harnessPort)]);
    assert.strictEqual(start.status, 0, start.stderr || start.stdout);
    harness = JSON.parse(start.stdout) as LocalHarness;
  });

  after(() => {
    if (!harness) return;
    const stop = runHarness(["stop", "--pid", String(harness.anvilPid)]);
    assert.strictEqual(stop.status, 0, stop.stderr || stop.stdout);
    harness = null;
  });

  it("creates agent-identity session and exports key only with unsafe flag", () => {
    const sessionPath = createTempSessionPath();
    const init = runCli([
      "register",
      "init",
      "--mode",
      "agent-identity",
      "--human-address",
      "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266",
      "--network",
      "testnet",
      "--out",
      sessionPath,
    ]);
    assert.strictEqual(init.status, 0, init.stderr);

    const blocked = runCli(["register", "export", "--session", sessionPath]);
    assert.notStrictEqual(blocked.status, 0, "export without --unsafe must fail");

    const keyPath = join(resolve(sessionPath, ".."), "agent.key");
    const ok = runCli([
      "register",
      "export",
      "--session",
      sessionPath,
      "--unsafe",
      "--out-key",
      keyPath,
    ]);
    assert.strictEqual(ok.status, 0, ok.stderr);
    assert.ok(existsSync(keyPath), "agent key file should be written");
  });

  it("builds smart-wallet session with template payload", () => {
    const sessionPath = createTempSessionPath();
    const init = runCli([
      "register",
      "init",
      "--mode",
      "smart-wallet",
      "--network",
      "testnet",
      "--out",
      sessionPath,
    ]);
    assert.strictEqual(init.status, 0, init.stderr);

    const session = readJson<{
      operation: string;
      mode: string;
      registration: { smartWalletTemplate?: unknown; userDefinedData?: string };
    }>(sessionPath);
    assert.strictEqual(session.operation, "register");
    assert.strictEqual(session.mode, "smart-wallet");
    assert.ok(session.registration.smartWalletTemplate, "smart-wallet template required");
    assert.strictEqual(session.registration.userDefinedData, undefined);
  });

  it("builds agent-identity deregistration session", () => {
    const sessionPath = createTempSessionPath();
    const init = runCli([
      "deregister",
      "init",
      "--mode",
      "agent-identity",
      "--human-address",
      "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266",
      "--agent-address",
      "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC",
      "--network",
      "testnet",
      "--out",
      sessionPath,
    ]);
    assert.strictEqual(init.status, 0, init.stderr);

    const session = readJson<{
      operation: string;
      mode: string;
      registration: { userDefinedData?: string };
      secrets?: { agentPrivateKey?: string };
    }>(sessionPath);
    assert.strictEqual(session.operation, "deregister");
    assert.strictEqual(session.mode, "agent-identity");
    assert.match(session.registration.userDefinedData || "", /^X[0-5][0-9a-f]{40}$/i);
    assert.strictEqual(session.secrets, undefined);
  });

  it("prints browser handoff URL", () => {
    const sessionPath = createTempSessionPath();
    const init = runCli([
      "register",
      "init",
      "--mode",
      "verified-wallet",
      "--human-address",
      DEMO_VERIFIED_ADDRESS,
      "--network",
      "testnet",
      "--out",
      sessionPath,
    ]);
    assert.strictEqual(init.status, 0, init.stderr);

    const open = runCli(["register", "open", "--session", sessionPath]);
    assert.strictEqual(open.status, 0, open.stderr);
    assert.match(open.stdout, /"url":\s*"https:\/\/self-agent-id\.vercel\.app\/cli\/register\?payload=/);
  });

  it("wait succeeds on live chain for known verified address", () => {
    if (!LIVE) return;
    const local = requireHarness();

    const sessionPath = createTempSessionPath();
    const init = runCli([
      "register",
      "init",
      "--mode",
      "verified-wallet",
      "--human-address",
      ANVIL_ALT_HUMAN_ADDRESS,
      "--chain",
      String(local.chainId),
      "--registry",
      local.registryAddress,
      "--rpc",
      local.rpcUrl,
      "--out",
      sessionPath,
    ]);
    assert.strictEqual(init.status, 0, init.stderr);

    const session = readJson<{ registration: { agentAddress: string } }>(sessionPath);
    setHarnessAgent(session.registration.agentAddress, 101);

    const wait = runCli([
      "register",
      "wait",
      "--session",
      sessionPath,
      "--no-listener",
      "--timeout-seconds",
      "40",
      "--poll-ms",
      "2000",
    ]);
    assert.strictEqual(wait.status, 0, wait.stderr);
    assert.match(wait.stdout, /"agentId":\s*"\d+"/);
  });

  it("accepts callback payload on local listener", async () => {
    if (!LIVE || !CALLBACK_LIVE) return;
    const local = requireHarness();
    const callbackPort = await getFreePort();

    const sessionPath = createTempSessionPath();
    const init = runCli([
      "register",
      "init",
      "--mode",
      "verified-wallet",
      "--human-address",
      local.deployerAddress,
      "--chain",
      String(local.chainId),
      "--registry",
      local.registryAddress,
      "--rpc",
      local.rpcUrl,
      "--callback-port",
      String(callbackPort),
      "--out",
      sessionPath,
    ]);
    assert.strictEqual(init.status, 0, init.stderr);

    const session = readJson<{
      sessionId: string;
      callback: { listenPort: number; stateToken: string; path: string };
      registration: { agentAddress: string };
    }>(sessionPath);

    const child = spawn(process.execPath, [
      CLI_PATH,
      "register",
      "wait",
      "--session",
      sessionPath,
      "--timeout-seconds",
      "40",
      "--poll-ms",
      "2000",
    ], { stdio: ["ignore", "pipe", "pipe"] });

    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (buf) => { stdout += String(buf); });
    child.stderr.on("data", (buf) => { stderr += String(buf); });

    const cbUrl = `http://127.0.0.1:${session.callback.listenPort}${session.callback.path}`;
    await waitForPort(cbUrl, {
      sessionId: session.sessionId,
      stateToken: session.callback.stateToken,
      status: "success",
      timestamp: Date.now(),
    });

    setHarnessAgent(session.registration.agentAddress, 102);

    const exitCode = await new Promise<number>((resolveExit) => {
      child.on("close", (code) => resolveExit(code ?? 1));
    });

    assert.strictEqual(exitCode, 0, stderr);
    assert.match(stdout, /"callbackReceived":\s*true/);
  });

  it("wait succeeds for live deregistration", () => {
    if (!LIVE) return;
    const local = requireHarness();

    const sessionPath = createTempSessionPath();
    const init = runCli([
      "deregister",
      "init",
      "--mode",
      "verified-wallet",
      "--human-address",
      local.deployerAddress,
      "--chain",
      String(local.chainId),
      "--registry",
      local.registryAddress,
      "--rpc",
      local.rpcUrl,
      "--out",
      sessionPath,
    ]);
    assert.strictEqual(init.status, 0, init.stderr);

    const session = readJson<{ registration: { agentAddress: string } }>(sessionPath);
    setHarnessAgent(session.registration.agentAddress, 0, false);

    const wait = runCli([
      "deregister",
      "wait",
      "--session",
      sessionPath,
      "--no-listener",
      "--timeout-seconds",
      "40",
      "--poll-ms",
      "2000",
    ]);
    assert.strictEqual(wait.status, 0, wait.stderr);
    assert.match(wait.stdout, /"stage":\s*"onchain_deregistered"/);
  });
});
