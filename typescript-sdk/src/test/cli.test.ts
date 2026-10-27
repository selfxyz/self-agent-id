// SPDX-FileCopyrightText: 2025-2026 Social Connect Labs, Inc.
// SPDX-License-Identifier: BUSL-1.1
// NOTE: Converts to Apache-2.0 on 2029-06-11 per LICENSE.

/** Tests for the `self-agent` CLI; live on-chain cases run only with SELF_AGENT_LIVE_TEST=1. */

import { after, before, describe, it } from "node:test";
import assert from "node:assert";
import { mkdtempSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { createServer as createHttpServer } from "node:http";
import { createServer as createNetServer, type AddressInfo } from "node:net";
import { ethers } from "ethers";

const CLI_PATH = resolve(__dirname, "..", "cli.js");
const REPO_ROOT = resolve(__dirname, "..", "..", "..");
const HARNESS_SCRIPT = resolve(
  REPO_ROOT,
  "scripts",
  "local-registry-harness.sh",
);
const HUMAN_ADDRESS = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266";
const LIVE = process.env.SELF_AGENT_LIVE_TEST === "1";

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

/** Run the built CLI synchronously and capture its output. */
function runCli(args: string[]): CliResult {
  const out = spawnSync(process.execPath, [CLI_PATH, ...args], {
    encoding: "utf8",
  });
  return {
    status: out.status,
    stdout: out.stdout || "",
    stderr: out.stderr || "",
  };
}

/** Run the built CLI without blocking the event loop (so in-process servers can answer). */
function runCliAsync(args: string[]): Promise<CliResult> {
  return new Promise((resolveRun, rejectRun) => {
    const child = spawn(process.execPath, [CLI_PATH, ...args]);
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (c) => (stdout += c));
    child.stderr.on("data", (c) => (stderr += c));
    child.on("error", rejectRun);
    child.on("close", (status) => resolveRun({ status, stdout, stderr }));
  });
}

/** Return a session file path inside a fresh temp directory. */
function createTempSessionPath(): string {
  const dir = mkdtempSync(join(tmpdir(), "self-agent-cli-"));
  return join(dir, "session.json");
}

/** Run scripts/local-registry-harness.sh (anvil + mock registry). */
function runHarness(args: string[]): CliResult {
  const out = spawnSync(HARNESS_SCRIPT, args, { encoding: "utf8" });
  return {
    status: out.status,
    stdout: out.stdout || "",
    stderr: out.stderr || "",
  };
}

/** Read and parse a JSON file. */
function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, "utf8")) as T;
}

/** Return the running harness, failing the test if it was not started. */
function requireHarness(): LocalHarness {
  assert.ok(harness, "local harness is required for live tests");
  return harness;
}

/** Set an agent's ID and verified flag on the harness registry. */
function setHarnessAgent(
  agentAddress: string,
  agentId: number,
  verified = true,
): void {
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

/** Ask the OS for a free localhost TCP port. */
async function getFreePort(): Promise<number> {
  return new Promise((resolvePort, rejectPort) => {
    const server = createNetServer();
    server.once("error", rejectPort);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        rejectPort(new Error("Unable to allocate test server port"));
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

  it("creates linked session and exports key only with unsafe flag", () => {
    const sessionPath = createTempSessionPath();
    const init = runCli([
      "register",
      "init",
      "--mode",
      "linked",
      "--human-address",
      "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266",
      "--network",
      "testnet",
      "--out",
      sessionPath,
    ]);
    assert.strictEqual(init.status, 0, init.stderr);

    const blocked = runCli(["register", "export", "--session", sessionPath]);
    assert.notStrictEqual(
      blocked.status,
      0,
      "export without --unsafe must fail",
    );

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
    // Not registered on-chain yet: export still works but says so.
    assert.match(ok.stderr, /not registered on-chain yet/);
    assert.strictEqual(JSON.parse(ok.stdout).registered, false);
  });

  for (const mode of ["smartwallet", "privy", "ed25519", "ed25519-linked"]) {
    it(`rejects ${mode} mode with a pointer to the SDK`, () => {
      const init = runCli([
        "register",
        "init",
        "--mode",
        mode,
        "--human-address",
        HUMAN_ADDRESS,
        "--out",
        createTempSessionPath(),
      ]);
      assert.notStrictEqual(init.status, 0);
      assert.match(init.stderr, /not supported by the CLI/);
    });
  }

  it("rejects self-custody (not a registration mode)", () => {
    const init = runCli([
      "register",
      "init",
      "--mode",
      "self-custody",
      "--human-address",
      HUMAN_ADDRESS,
      "--out",
      createTempSessionPath(),
    ]);
    assert.notStrictEqual(init.status, 0);
    assert.match(init.stderr, /Unsupported mode/);
  });

  it("builds wallet-free session with W userData", () => {
    const sessionPath = createTempSessionPath();
    const init = runCli([
      "register",
      "init",
      "--mode",
      "wallet-free",
      "--network",
      "testnet",
      "--out",
      sessionPath,
    ]);
    assert.strictEqual(init.status, 0, init.stderr);

    const session = readJson<{
      registration: {
        agentAddress: string;
        humanIdentifier: string;
        userDefinedData?: string;
      };
      secrets?: { agentPrivateKey?: string };
    }>(sessionPath);
    assert.strictEqual(
      session.registration.humanIdentifier,
      session.registration.agentAddress,
    );
    assert.match(session.registration.userDefinedData || "", /^W[0-5]/);
    assert.ok(session.secrets?.agentPrivateKey);
  });

  it("builds linked deregistration session", () => {
    const sessionPath = createTempSessionPath();
    const init = runCli([
      "deregister",
      "init",
      "--mode",
      "linked",
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
    assert.strictEqual(session.mode, "linked");
    assert.match(
      session.registration.userDefinedData || "",
      /^X[0-5][0-9a-f]{40}$/i,
    );
    assert.strictEqual(session.secrets, undefined);
  });

  it("prints /cli/register QR URL with exactly the fields the server reads", () => {
    const sessionPath = createTempSessionPath();
    const init = runCli([
      "register",
      "init",
      "--mode",
      "linked",
      "--human-address",
      HUMAN_ADDRESS,
      "--network",
      "testnet",
      "--minimum-age",
      "18",
      "--out",
      sessionPath,
    ]);
    assert.strictEqual(init.status, 0, init.stderr);

    const open = runCli(["register", "open", "--session", sessionPath]);
    assert.strictEqual(open.status, 0, open.stderr);
    const { url } = JSON.parse(open.stdout) as { url: string };
    const parsed = new URL(url);
    assert.strictEqual(parsed.origin, "https://agent-api.self.xyz");
    assert.strictEqual(parsed.pathname, "/cli/register");
    const payload = JSON.parse(
      Buffer.from(
        parsed.searchParams.get("payload") || "",
        "base64url",
      ).toString("utf8"),
    ) as Record<string, unknown>;
    assert.deepStrictEqual(Object.keys(payload).sort(), [
      "appName",
      "chainId",
      "disclosures",
      "endpointType",
      "expiresAt",
      "humanIdentifier",
      "mode",
      "operation",
      "registryAddress",
      "scope",
      "userDefinedData",
      "version",
    ]);
    assert.strictEqual(payload.appName, "Self Agent ID");
    assert.strictEqual(payload.scope, "self-agent-id");
    assert.strictEqual(payload.endpointType, "staging_celo");
    assert.strictEqual(payload.chainId, 11142220);
    assert.strictEqual(
      payload.registryAddress,
      "0x043DaCac8b0771DD5b444bCC88f2f8BBDBEdd379",
    );
    assert.strictEqual(payload.humanIdentifier, HUMAN_ADDRESS);
    assert.match(String(payload.userDefinedData), /^K1/);
    assert.strictEqual(
      (payload.disclosures as { minimumAge: number }).minimumAge,
      18,
    );
  });

  it("wait reports a timeout distinctly and does not mark the session expired", async () => {
    // Fake chain 31337 node: every eth_call returns zero (not verified, agentId 0).
    const rpc = createHttpServer((req, res) => {
      let raw = "";
      req.on("data", (c) => (raw += c));
      req.on("end", () => {
        const answer = (call: { id: number; method: string }) => ({
          jsonrpc: "2.0",
          id: call.id,
          result:
            call.method === "eth_chainId" ? "0x7a69" : "0x" + "0".repeat(64),
        });
        const body = JSON.parse(raw);
        res.setHeader("Content-Type", "application/json");
        res.end(
          JSON.stringify(Array.isArray(body) ? body.map(answer) : answer(body)),
        );
      });
    });
    await new Promise<void>((r) => rpc.listen(0, "127.0.0.1", r));
    const port = (rpc.address() as AddressInfo).port;
    try {
      const sessionPath = createTempSessionPath();
      const init = runCli([
        "register",
        "init",
        "--mode",
        "linked",
        "--human-address",
        HUMAN_ADDRESS,
        "--chain",
        "31337",
        "--registry",
        "0x0000000000000000000000000000000000000001",
        "--rpc",
        `http://127.0.0.1:${port}`,
        "--out",
        sessionPath,
      ]);
      assert.strictEqual(init.status, 0, init.stderr);

      const wait = await runCliAsync([
        "register",
        "wait",
        "--session",
        sessionPath,
        "--timeout-seconds",
        "1",
        "--poll-ms",
        "200",
      ]);
      assert.strictEqual(wait.status, 2, wait.stderr);
      assert.match(wait.stderr, /Timed out after 1s/);
      assert.match(wait.stderr, /still valid/);

      const session = readJson<{
        state: { stage: string; lastError?: string };
      }>(sessionPath);
      assert.strictEqual(session.state.stage, "initialized");
      assert.match(session.state.lastError || "", /Timed out/);
    } finally {
      rpc.close();
    }
  });

  it("help notes that the CLI defaults to testnet while the SDK defaults to mainnet", () => {
    const help = runCli([]);
    assert.match(help.stdout, /defaults to testnet/);
    assert.match(help.stdout, /default to mainnet/);
  });

  it("wait succeeds on live chain for known verified address", () => {
    if (!LIVE) return;
    const local = requireHarness();

    const sessionPath = createTempSessionPath();
    const init = runCli([
      "register",
      "init",
      "--mode",
      "wallet-free",
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

    const session = readJson<{ registration: { agentAddress: string } }>(
      sessionPath,
    );
    setHarnessAgent(session.registration.agentAddress, 101);

    const wait = runCli([
      "register",
      "wait",
      "--session",
      sessionPath,
      "--timeout-seconds",
      "40",
      "--poll-ms",
      "2000",
    ]);
    assert.strictEqual(wait.status, 0, wait.stderr);
    assert.match(wait.stdout, /"agentId":\s*"\d+"/);
  });

  it("wait succeeds for live deregistration", () => {
    if (!LIVE) return;
    const local = requireHarness();

    const sessionPath = createTempSessionPath();
    const init = runCli([
      "deregister",
      "init",
      "--mode",
      "wallet-free",
      "--agent-address",
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

    const session = readJson<{ registration: { agentAddress: string } }>(
      sessionPath,
    );
    setHarnessAgent(session.registration.agentAddress, 0, false);

    const wait = runCli([
      "deregister",
      "wait",
      "--session",
      sessionPath,
      "--timeout-seconds",
      "40",
      "--poll-ms",
      "2000",
    ]);
    assert.strictEqual(wait.status, 0, wait.stderr);
    assert.match(wait.stdout, /"stage":\s*"onchain_deregistered"/);
  });
});
