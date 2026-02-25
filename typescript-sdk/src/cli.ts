#!/usr/bin/env node
// SPDX-FileCopyrightText: 2025-2026 Social Connect Labs, Inc.
// SPDX-License-Identifier: BUSL-1.1
// NOTE: Converts to Apache-2.0 on 2029-06-11 per LICENSE.

import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { randomBytes } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { ethers } from "ethers";
import {
  REGISTRY_ABI,
  NETWORKS,
  getRegistrationConfigIndex,
  signRegistrationChallenge,
  buildSimpleRegisterUserDataAscii,
  buildSimpleDeregisterUserDataAscii,
  buildAdvancedRegisterUserDataAscii,
  buildAdvancedDeregisterUserDataAscii,
  buildWalletFreeRegisterUserDataAscii,
  type RegistrationDisclosures,
  type RegistrationMode,
  type RegistrationSignatureParts,
} from "./index";

type CliMode = RegistrationMode;
type CliOperation = "register" | "deregister";
type EndpointType = "celo" | "staging_celo";
type SessionStage =
  | "initialized"
  | "handoff_opened"
  | "callback_received"
  | "onchain_verified"
  | "onchain_deregistered"
  | "failed"
  | "expired";

interface CliNetwork {
  chainId: number;
  rpcUrl: string;
  registryAddress: string;
  endpointType: EndpointType;
  appUrl: string;
  appName: string;
  scope: string;
}

interface SmartWalletTemplate {
  agentAddress: string;
  r: string;
  s: string;
  v: number;
  configIndex: number;
}

interface CliSession {
  version: 1;
  operation: CliOperation;
  sessionId: string;
  createdAt: string;
  expiresAt: string;
  mode: CliMode;
  disclosures: RegistrationDisclosures & {
    nationality?: boolean;
    name?: boolean;
    date_of_birth?: boolean;
    gender?: boolean;
    issuing_state?: boolean;
  };
  network: CliNetwork;
  registration: {
    humanIdentifier: string;
    agentAddress: string;
    userDefinedData?: string;
    challengeHash?: string;
    signature?: RegistrationSignatureParts;
    smartWalletTemplate?: SmartWalletTemplate;
  };
  callback: {
    listenHost: "127.0.0.1";
    listenPort: number;
    path: "/callback";
    stateToken: string;
    used: boolean;
    lastStatus?: "success" | "error";
    lastError?: string;
  };
  state: {
    stage: SessionStage;
    updatedAt: string;
    lastError?: string;
    agentId?: string;
    guardianAddress?: string;
  };
  secrets?: {
    agentPrivateKey?: string;
  };
}

interface CliHandoffPayload {
  version: 1;
  operation: CliOperation;
  sessionId: string;
  stateToken: string;
  callbackUrl: string;
  mode: CliMode;
  chainId: number;
  registryAddress: string;
  endpointType: EndpointType;
  appName: string;
  scope: string;
  humanIdentifier: string;
  expectedAgentAddress: string;
  disclosures?: CliSession["disclosures"];
  userDefinedData?: string;
  smartWalletTemplate?: SmartWalletTemplate;
  expiresAt: number;
}

type FlagValue = string | boolean;
type FlagMap = Record<string, FlagValue | FlagValue[]>;

const DEFAULT_APP_URL = process.env.SELF_AGENT_APP_URL || "https://self-agent-id.vercel.app";
const DEFAULT_APP_NAME = process.env.SELF_AGENT_APP_NAME || "Self Agent ID";
const DEFAULT_SCOPE = process.env.SELF_AGENT_SCOPE || "self-agent-id";

function usage(): string {
  return [
    "Self Agent CLI",
    "",
    "Commands:",
    "  register init    Create a local registration session",
    "  register open    Print browser handoff URL (or launch with --launch)",
    "  register wait    Wait for browser callback + on-chain verification",
    "  register status  Show current session status",
    "  register export  Export generated agent private key (explicit unsafe flag required)",
    "  deregister init  Create a local deregistration session",
    "  deregister open  Print browser handoff URL (or launch with --launch)",
    "  deregister wait  Wait for browser callback + on-chain deregistration",
    "  deregister status Show current session status",
    "",
    "Examples:",
    "  self-agent register init --mode verified-wallet --human-address 0x... --network testnet --out .self/session.json",
    "  self-agent register open --session .self/session.json",
    "  self-agent register wait --session .self/session.json --timeout-seconds 1800",
    "  self-agent register export --session .self/session.json --unsafe --out-key .self/agent.key",
    "  self-agent deregister init --mode verified-wallet --human-address 0x... --network testnet --out .self/session.json",
    "  self-agent deregister open --session .self/session.json",
    "  self-agent deregister wait --session .self/session.json --timeout-seconds 1800",
  ].join("\n");
}

function die(message: string): never {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

function nowIso(): string {
  return new Date().toISOString();
}

function base64UrlEncode(text: string): string {
  return Buffer.from(text, "utf8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function randomIdHex(bytes = 16): string {
  return randomBytes(bytes).toString("hex");
}

function ensureDirForFile(path: string): void {
  mkdirSync(dirname(path), { recursive: true });
}

function writeJsonFile(path: string, value: unknown): void {
  ensureDirForFile(path);
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
}

function writeTextFile(path: string, value: string): void {
  ensureDirForFile(path);
  writeFileSync(path, value, { mode: 0o600 });
}

function readSession(path: string): CliSession {
  const raw = readFileSync(path, "utf8");
  return JSON.parse(raw) as CliSession;
}

function saveSession(path: string, session: CliSession): void {
  session.state.updatedAt = nowIso();
  writeJsonFile(path, session);
}

function parseMode(value: string | undefined): CliMode {
  if (!value) die("Missing required --mode");
  const normalized = value.trim().toLowerCase();
  if (normalized === "verified-wallet") return "verified-wallet";
  if (normalized === "agent-identity") return "agent-identity";
  if (normalized === "wallet-free") return "wallet-free";
  if (normalized === "smart-wallet") return "smart-wallet";
  die(`Unsupported mode: ${value}`);
}

function parseIntFlag(name: string, value: string | undefined): number {
  if (!value) die(`Missing value for --${name}`);
  const n = Number(value);
  if (!Number.isFinite(n) || !Number.isInteger(n)) {
    die(`Invalid integer for --${name}: ${value}`);
  }
  return n;
}

function parseNetwork(flags: FlagMap): CliNetwork {
  const networkRaw = String(flags.network || "testnet").toLowerCase();
  const chainFlag = flags.chain ? parseIntFlag("chain", String(flags.chain)) : undefined;
  const registryFlag = flags.registry ? String(flags.registry) : undefined;
  const rpcFlag = flags.rpc ? String(flags.rpc) : undefined;
  const appUrl = String(flags["app-url"] || DEFAULT_APP_URL).replace(/\/+$/, "");
  const appName = String(flags["app-name"] || DEFAULT_APP_NAME);
  const scope = String(flags.scope || DEFAULT_SCOPE);

  if (chainFlag !== undefined) {
    if (!registryFlag) die("--registry is required when --chain is provided");
    if (!rpcFlag) die("--rpc is required when --chain is provided");

    return {
      chainId: chainFlag,
      registryAddress: ethers.getAddress(registryFlag),
      rpcUrl: rpcFlag,
      endpointType: chainFlag === 42220 ? "celo" : "staging_celo",
      appUrl,
      appName,
      scope,
    };
  }

  if (networkRaw !== "mainnet" && networkRaw !== "testnet") {
    die(`Unsupported --network value: ${networkRaw}`);
  }

  const net = NETWORKS[networkRaw];
  return {
    chainId: networkRaw === "mainnet" ? 42220 : 11142220,
    registryAddress: net.registryAddress,
    rpcUrl: net.rpcUrl,
    endpointType: networkRaw === "mainnet" ? "celo" : "staging_celo",
    appUrl,
    appName,
    scope,
  };
}

function parseDisclosures(flags: FlagMap): CliSession["disclosures"] {
  const minimumAgeRaw = flags["minimum-age"] ? String(flags["minimum-age"]) : "0";
  const minimumAge = parseIntFlag("minimum-age", minimumAgeRaw);
  if (minimumAge !== 0 && minimumAge !== 18 && minimumAge !== 21) {
    die("--minimum-age must be 0, 18, or 21");
  }

  return {
    minimumAge: minimumAge as 0 | 18 | 21,
    ofac: Boolean(flags.ofac),
    nationality: Boolean(flags.nationality),
    name: Boolean(flags.name),
    date_of_birth: Boolean(flags["date-of-birth"]),
    gender: Boolean(flags.gender),
    issuing_state: Boolean(flags["issuing-state"]),
  };
}

function parseFlags(argv: string[]): { positionals: string[]; flags: FlagMap } {
  const positionals: string[] = [];
  const flags: FlagMap = {};

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith("--")) {
      positionals.push(token);
      continue;
    }

    const key = token.slice(2);
    const next = argv[i + 1];
    const hasValue = next !== undefined && !next.startsWith("--");
    const value: FlagValue = hasValue ? next : true;
    if (hasValue) i += 1;

    const existing = flags[key];
    if (existing === undefined) {
      flags[key] = value;
    } else if (Array.isArray(existing)) {
      existing.push(value);
      flags[key] = existing;
    } else {
      flags[key] = [existing, value];
    }
  }

  return { positionals, flags };
}

function getSessionPath(flags: FlagMap, required = true): string {
  const raw = flags.session ? String(flags.session) : "";
  if (!raw && required) die("Missing required --session");
  return resolve(raw || ".self/session.json");
}

function getOutPath(flags: FlagMap): string {
  const outRaw = flags.out ? String(flags.out) : `.self/session-${randomIdHex(8)}.json`;
  return resolve(outRaw);
}

function getCallbackPort(flags: FlagMap): number {
  if (flags["callback-port"]) return parseIntFlag("callback-port", String(flags["callback-port"]));
  const min = 37100;
  const max = 37999;
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function expectedAgentKeyHex(agentAddress: string): string {
  return ethers.zeroPadValue(agentAddress, 32);
}

function callbackUrl(session: CliSession): string {
  const host = session.callback.listenHost;
  const port = session.callback.listenPort;
  const path = session.callback.path;
  return `http://${host}:${port}${path}`;
}

function getSessionOperation(session: CliSession): CliOperation {
  return session.operation || "register";
}

function buildHandoffPayload(session: CliSession): CliHandoffPayload {
  return {
    version: 1,
    operation: getSessionOperation(session),
    sessionId: session.sessionId,
    stateToken: session.callback.stateToken,
    callbackUrl: callbackUrl(session),
    mode: session.mode,
    chainId: session.network.chainId,
    registryAddress: session.network.registryAddress,
    endpointType: session.network.endpointType,
    appName: session.network.appName,
    scope: session.network.scope,
    humanIdentifier: session.registration.humanIdentifier,
    expectedAgentAddress: session.registration.agentAddress,
    disclosures: session.disclosures,
    userDefinedData: session.registration.userDefinedData,
    smartWalletTemplate: session.registration.smartWalletTemplate,
    expiresAt: new Date(session.expiresAt).getTime(),
  };
}

function handoffUrl(session: CliSession): string {
  const payload = buildHandoffPayload(session);
  const encoded = base64UrlEncode(JSON.stringify(payload));
  return `${session.network.appUrl}/cli/register?payload=${encoded}`;
}

function printJson(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

function printText(value: string): void {
  process.stdout.write(`${value}\n`);
}

async function commandRegisterInit(flags: FlagMap): Promise<void> {
  return commandInit(flags, "register");
}

async function commandDeregisterInit(flags: FlagMap): Promise<void> {
  return commandInit(flags, "deregister");
}

async function commandInit(flags: FlagMap, operation: CliOperation): Promise<void> {
  const mode = parseMode(flags.mode ? String(flags.mode) : undefined);
  const network = parseNetwork(flags);
  const disclosures = parseDisclosures(flags);
  const configIndex = getRegistrationConfigIndex(disclosures);
  const ttlMinutes = flags["ttl-minutes"] ? parseIntFlag("ttl-minutes", String(flags["ttl-minutes"])) : 30;
  const outPath = getOutPath(flags);

  if (ttlMinutes <= 0) die("--ttl-minutes must be > 0");

  const sessionId = randomIdHex(16);
  const stateToken = randomIdHex(24);
  const createdAt = nowIso();
  const expiresAt = new Date(Date.now() + ttlMinutes * 60_000).toISOString();

  const humanAddressRaw = flags["human-address"] ? String(flags["human-address"]) : undefined;
  const agentAddressRaw = flags["agent-address"] ? String(flags["agent-address"]) : undefined;

  let humanIdentifier = "";
  let agentAddress = "";
  let userDefinedData: string | undefined;
  let signature: RegistrationSignatureParts | undefined;
  let challengeHash: string | undefined;
  let smartWalletTemplate: SmartWalletTemplate | undefined;
  let agentPrivateKey: string | undefined;

  if (mode === "verified-wallet" || mode === "agent-identity") {
    if (!humanAddressRaw) die("--human-address is required for verified-wallet and agent-identity modes");
    humanIdentifier = ethers.getAddress(humanAddressRaw);
  }

  if (operation === "register") {
    if (mode === "verified-wallet") {
      agentAddress = humanIdentifier;
      userDefinedData = buildSimpleRegisterUserDataAscii(disclosures);
    } else if (mode === "agent-identity") {
      const wallet = ethers.Wallet.createRandom();
      agentPrivateKey = wallet.privateKey;
      agentAddress = wallet.address;

      const signed = await signRegistrationChallenge(agentPrivateKey, {
        humanIdentifier,
        chainId: network.chainId,
        registryAddress: network.registryAddress,
      });

      challengeHash = signed.messageHash;
      signature = { r: signed.r, s: signed.s, v: signed.v };
      userDefinedData = buildAdvancedRegisterUserDataAscii({
        agentAddress,
        signature,
        disclosures,
      });
    } else if (mode === "wallet-free") {
      const wallet = ethers.Wallet.createRandom();
      agentPrivateKey = wallet.privateKey;
      agentAddress = wallet.address;
      humanIdentifier = agentAddress;

      const signed = await signRegistrationChallenge(agentPrivateKey, {
        humanIdentifier,
        chainId: network.chainId,
        registryAddress: network.registryAddress,
      });

      challengeHash = signed.messageHash;
      signature = { r: signed.r, s: signed.s, v: signed.v };
      userDefinedData = buildWalletFreeRegisterUserDataAscii({
        agentAddress,
        signature,
        disclosures,
      });
    } else if (mode === "smart-wallet") {
      const wallet = ethers.Wallet.createRandom();
      agentPrivateKey = wallet.privateKey;
      agentAddress = wallet.address;
      humanIdentifier = agentAddress;

      const signed = await signRegistrationChallenge(agentPrivateKey, {
        humanIdentifier,
        chainId: network.chainId,
        registryAddress: network.registryAddress,
      });

      challengeHash = signed.messageHash;
      signature = { r: signed.r, s: signed.s, v: signed.v };
      smartWalletTemplate = {
        agentAddress,
        r: signed.r,
        s: signed.s,
        v: signed.v,
        configIndex,
      };
    }
  } else {
    if (mode === "verified-wallet") {
      agentAddress = humanIdentifier;
      userDefinedData = buildSimpleDeregisterUserDataAscii(disclosures);
    } else if (mode === "agent-identity") {
      if (!agentAddressRaw) die("--agent-address is required for agent-identity deregistration");
      agentAddress = ethers.getAddress(agentAddressRaw);
      userDefinedData = buildAdvancedDeregisterUserDataAscii({
        agentAddress,
        disclosures,
      });
    } else if (mode === "wallet-free" || mode === "smart-wallet") {
      if (!agentAddressRaw) die("--agent-address is required for wallet-free and smart-wallet deregistration");
      agentAddress = ethers.getAddress(agentAddressRaw);
      humanIdentifier = agentAddress;
      userDefinedData = buildSimpleDeregisterUserDataAscii(disclosures);
    }
  }

  const session: CliSession = {
    version: 1,
    operation,
    sessionId,
    createdAt,
    expiresAt,
    mode,
    disclosures,
    network,
    registration: {
      humanIdentifier,
      agentAddress,
      userDefinedData,
      challengeHash,
      signature,
      smartWalletTemplate,
    },
    callback: {
      listenHost: "127.0.0.1",
      listenPort: getCallbackPort(flags),
      path: "/callback",
      stateToken,
      used: false,
    },
    state: {
      stage: "initialized",
      updatedAt: createdAt,
    },
    secrets: agentPrivateKey ? { agentPrivateKey } : undefined,
  };

  writeJsonFile(outPath, session);

  printJson({
    ok: true,
    sessionPath: outPath,
    sessionId,
    operation,
    mode,
    agentAddress,
    requiresHumanAddress: mode === "verified-wallet" || mode === "agent-identity",
    callbackUrl: callbackUrl(session),
    next: [
      `self-agent ${operation} open --session ${outPath}`,
      `self-agent ${operation} wait --session ${outPath}`,
    ],
  });
}

async function commandOpen(flags: FlagMap): Promise<void> {
  const sessionPath = getSessionPath(flags);
  const session = readSession(sessionPath);

  if (Date.now() > new Date(session.expiresAt).getTime()) {
    session.state.stage = "expired";
    session.state.lastError = "Session expired";
    saveSession(sessionPath, session);
    die(`Session expired. Run \`${getSessionOperation(session)} init\` again.`);
  }

  const url = handoffUrl(session);
  session.state.stage = "handoff_opened";
  saveSession(sessionPath, session);

  printJson({
    ok: true,
    sessionPath,
    operation: getSessionOperation(session),
    url,
    callbackUrl: callbackUrl(session),
  });

  if (flags.launch) {
    printText("Browser launch is not automatic in this build. Open the URL above manually.");
  }
}

async function pollOnChain(session: CliSession): Promise<{ verified: boolean; agentId: string }> {
  const provider = new ethers.JsonRpcProvider(session.network.rpcUrl);
  const registry = new ethers.Contract(session.network.registryAddress, REGISTRY_ABI, provider);
  const agentKey = expectedAgentKeyHex(session.registration.agentAddress);
  const [verified, agentIdRaw] = await Promise.all([
    registry.isVerifiedAgent(agentKey),
    registry.getAgentId(agentKey),
  ]);
  const agentId = BigInt(agentIdRaw).toString();
  return { verified: Boolean(verified), agentId };
}

async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  return new Promise((resolveBody, rejectBody) => {
    req.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
    req.on("end", () => {
      try {
        const text = Buffer.concat(chunks).toString("utf8");
        resolveBody(text ? JSON.parse(text) : {});
      } catch (err) {
        rejectBody(err);
      }
    });
    req.on("error", rejectBody);
  });
}

function sendJson(res: ServerResponse, status: number, payload: unknown): void {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.end(JSON.stringify(payload));
}

async function commandRegisterWait(flags: FlagMap): Promise<void> {
  return commandWait(flags);
}

async function commandDeregisterWait(flags: FlagMap): Promise<void> {
  return commandWait(flags);
}

async function commandWait(flags: FlagMap): Promise<void> {
  const sessionPath = getSessionPath(flags);
  const session = readSession(sessionPath);
  const operation = getSessionOperation(session);
  const timeoutSeconds = flags["timeout-seconds"] ? parseIntFlag("timeout-seconds", String(flags["timeout-seconds"])) : 1800;
  const pollMs = flags["poll-ms"] ? parseIntFlag("poll-ms", String(flags["poll-ms"])) : 4000;
  const shouldOpen = Boolean(flags.open);

  if (timeoutSeconds <= 0) die("--timeout-seconds must be > 0");
  if (pollMs <= 0) die("--poll-ms must be > 0");

  if (Date.now() > new Date(session.expiresAt).getTime()) {
    session.state.stage = "expired";
    session.state.lastError = "Session expired";
    saveSession(sessionPath, session);
    die(`Session expired. Run \`${operation} init\` again.`);
  }

  if (shouldOpen) {
    const url = handoffUrl(session);
    printText(url);
    session.state.stage = "handoff_opened";
    saveSession(sessionPath, session);
  }

  let callbackError: string | null = null;
  let callbackSuccess = false;
  let listenerEnabled = !Boolean(flags["no-listener"]);

  const server = createServer(async (req, res) => {
    try {
      const url = req.url || "/";
      if (req.method === "OPTIONS") {
        sendJson(res, 204, { ok: true });
        return;
      }
      if (req.method !== "POST" || url.split("?")[0] !== session.callback.path) {
        sendJson(res, 404, { error: "Not found" });
        return;
      }

      const body = (await readJsonBody(req)) as {
        sessionId?: string;
        stateToken?: string;
        status?: "success" | "error";
        error?: string;
        guardianAddress?: string;
      };

      if (body.sessionId !== session.sessionId) {
        sendJson(res, 400, { error: "Session mismatch" });
        return;
      }
      if (body.stateToken !== session.callback.stateToken) {
        sendJson(res, 401, { error: "Invalid state token" });
        return;
      }
      if (session.callback.used) {
        sendJson(res, 409, { error: "Callback already used" });
        return;
      }

      session.callback.used = true;
      session.callback.lastStatus = body.status === "error" ? "error" : "success";

      if (body.status === "error") {
        callbackError = body.error || "Browser reported flow error";
        session.callback.lastError = callbackError;
        session.state.stage = "failed";
        session.state.lastError = callbackError;
      } else {
        callbackSuccess = true;
        session.state.stage = "callback_received";
        if (body.guardianAddress) {
          session.state.guardianAddress = ethers.getAddress(body.guardianAddress);
        }
      }

      saveSession(sessionPath, session);
      sendJson(res, 200, { ok: true });
    } catch (err) {
      sendJson(res, 400, { error: err instanceof Error ? err.message : String(err) });
    }
  });

  if (listenerEnabled) {
    await new Promise<void>((resolveListen, rejectListen) => {
      server.once("error", rejectListen);
      server.listen(session.callback.listenPort, session.callback.listenHost, () => {
        resolveListen();
      });
    }).catch((err: unknown) => {
      const code = (err as { code?: string } | undefined)?.code || "";
      const message = String(err);
      const permissionLike =
        code === "EPERM" || code === "EACCES" || code === "EADDRNOTAVAIL" || message.includes("operation not permitted");
      if (permissionLike) {
        listenerEnabled = false;
        printText(`Callback listener unavailable (${message}). Continuing with on-chain polling only.`);
        return;
      }
      die(`Failed to start callback listener on ${callbackUrl(session)}: ${message}`);
    });
  }

  const deadline = Date.now() + timeoutSeconds * 1000;
  let verified = false;
  let agentId = "0";
  let lastPollError = "";

  while (Date.now() < deadline) {
    if (callbackError) break;

    try {
      const chain = await pollOnChain(session);
      verified = chain.verified;
      agentId = chain.agentId;
      const onchainVerified = verified && BigInt(agentId) > 0n;
      const onchainDeregistered = !verified && BigInt(agentId) === 0n;
      const reachedTarget =
        operation === "register" ? onchainVerified : onchainDeregistered;
      if (reachedTarget) {
        session.state.stage =
          operation === "register" ? "onchain_verified" : "onchain_deregistered";
        session.state.agentId = operation === "register" ? agentId : undefined;
        session.state.lastError = undefined;
        saveSession(sessionPath, session);
        break;
      }
    } catch (err) {
      lastPollError = err instanceof Error ? err.message : String(err);
    }

    await new Promise((r) => setTimeout(r, pollMs));
  }

  if (listenerEnabled) {
    await new Promise<void>((resolveClose) => {
      server.close(() => resolveClose());
    });
  }

  if (callbackError) {
    die(`${operation === "register" ? "Registration" : "Deregistration"} failed via browser callback: ${callbackError}`);
  }

  const completed =
    operation === "register"
      ? verified && BigInt(agentId) > 0n
      : !verified && BigInt(agentId) === 0n;
  if (!completed) {
    session.state.stage = Date.now() >= deadline ? "expired" : "failed";
    session.state.lastError = lastPollError || `Timed out waiting for on-chain ${operation}`;
    saveSession(sessionPath, session);
    die(`Timed out waiting for on-chain ${operation}. Last poll error: ${lastPollError || "none"}`);
  }

  printJson({
    ok: true,
    sessionPath,
    operation,
    stage: session.state.stage,
    agentAddress: session.registration.agentAddress,
    agentId: operation === "register" ? agentId : null,
    callbackReceived: callbackSuccess || session.callback.used,
    callbackListener: listenerEnabled,
    guardianAddress: session.state.guardianAddress,
  });
}

function commandStatus(flags: FlagMap): void {
  const sessionPath = getSessionPath(flags);
  const session = readSession(sessionPath);
  printJson({
    ok: true,
    sessionPath,
    sessionId: session.sessionId,
    operation: getSessionOperation(session),
    mode: session.mode,
    stage: session.state.stage,
    expiresAt: session.expiresAt,
    agentAddress: session.registration.agentAddress,
    agentId: session.state.agentId || null,
    callbackUrl: callbackUrl(session),
    callbackUsed: session.callback.used,
    lastError: session.state.lastError || null,
  });
}

function commandRegisterExport(flags: FlagMap): void {
  const sessionPath = getSessionPath(flags);
  const session = readSession(sessionPath);
  const key = session.secrets?.agentPrivateKey;

  if (!key) die("No agent private key in this session (verified-wallet mode has no generated key).");
  if (!flags.unsafe) die("Export blocked. Re-run with --unsafe.");

  const printKey = Boolean(flags["print-private-key"]);
  const outKeyPath = flags["out-key"] ? resolve(String(flags["out-key"])) : "";

  if (!printKey && !outKeyPath) {
    die("Nothing to export. Provide --out-key <path> or --print-private-key.");
  }

  if (outKeyPath) {
    writeTextFile(outKeyPath, `${key}\n`);
  }

  if (printKey) {
    printText(key);
  }

  printJson({
    ok: true,
    sessionPath,
    exportedTo: outKeyPath || null,
    printed: printKey,
  });
}

async function main(): Promise<void> {
  const { positionals, flags } = parseFlags(process.argv.slice(2));
  if (
    positionals.length < 2 ||
    (positionals[0] !== "register" && positionals[0] !== "deregister")
  ) {
    printText(usage());
    process.exit(1);
  }

  const family = positionals[0] as CliOperation;
  const sub = positionals[1];
  if (sub === "init") return family === "register" ? commandRegisterInit(flags) : commandDeregisterInit(flags);
  if (sub === "open") return commandOpen(flags);
  if (sub === "wait") return family === "register" ? commandRegisterWait(flags) : commandDeregisterWait(flags);
  if (sub === "status") return commandStatus(flags);
  if (sub === "export") {
    if (family !== "register") die("`deregister export` is not supported.");
    return commandRegisterExport(flags);
  }

  die(`Unknown subcommand: ${sub}`);
}

main().catch((err) => {
  die(err instanceof Error ? err.message : String(err));
});
