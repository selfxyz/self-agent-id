#!/usr/bin/env node
// SPDX-FileCopyrightText: 2025-2026 Social Connect Labs, Inc.
// SPDX-License-Identifier: BUSL-1.1
// NOTE: Converts to Apache-2.0 on 2029-06-11 per LICENSE.

/**
 * `self-agent` CLI: register or deregister an agent via a local session file
 * and a `/cli/register` QR handoff, then poll the registry for completion.
 *
 * Supports linked and wallet-free modes only; defaults to testnet. Session
 * files (0600) hold the generated agent private key until exported.
 */

import { randomBytes } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { ethers } from "ethers";
import {
  NETWORKS,
  signRegistrationChallenge,
  buildSimpleDeregisterUserDataAscii,
  buildAdvancedRegisterUserDataAscii,
  buildAdvancedDeregisterUserDataAscii,
  buildWalletFreeRegisterUserDataAscii,
  type RegistrationDisclosures,
  type RegistrationMode,
  type RegistrationSignatureParts,
} from "./index";

import { typedRegistry } from "./contract-types";
import { trimTrailingSlashes } from "./registration-flow";

/**
 * Modes the CLI can register. The `/cli/register` browser handoff only
 * supports linked and wallet-free; every other mode goes through the SDK's
 * REST flow (`requestRegistration`) instead.
 */
type CliMode = Extract<RegistrationMode, "linked" | "wallet-free">;

/** Every mode the REST API accepts; `satisfies` fails the build if one is missing. */
const API_MODES = {
  linked: true,
  "wallet-free": true,
  ed25519: true,
  "ed25519-linked": true,
  privy: true,
  smartwallet: true,
} satisfies Record<RegistrationMode, true>;

/** Top-level CLI operation: register a new agent or deregister an existing one. */
type CliOperation = "register" | "deregister";

/** Self Protocol endpoint discriminator for Celo mainnet vs staging/testnet. */
type EndpointType = "celo" | "staging_celo";

/**
 * Lifecycle stage of a CLI session, tracking progress from initialization
 * through QR handoff and on-chain confirmation.
 */
type SessionStage =
  | "initialized"
  | "handoff_opened"
  | "onchain_verified"
  | "onchain_deregistered"
  | "failed"
  | "expired";

/** Network configuration for a CLI session, including chain details and app metadata. */
interface CliNetwork {
  /** EVM chain ID (42220 for Celo mainnet, 11142220 for Celo Sepolia). */
  chainId: number;
  /** JSON-RPC endpoint URL for the target chain. */
  rpcUrl: string;
  /** Checksummed address of the SelfAgentRegistry contract. */
  registryAddress: string;
  /** Self Protocol endpoint type (mainnet or staging). */
  endpointType: EndpointType;
  /** Base URL of the Self Agent ID API that renders the handoff QR. */
  appUrl: string;
  /** Human-readable application name shown during verification. */
  appName: string;
  /** Self Protocol scope identifier for this registration. */
  scope: string;
}

/**
 * Persistent session state written to disk as JSON. Tracks the full lifecycle
 * of a register or deregister flow: initialization, QR handoff, and on-chain
 * verification.
 */
interface CliSession {
  /** Schema version for forward compatibility. */
  version: 1;
  /** Whether this session is a registration or deregistration. */
  operation: CliOperation;
  /** Unique hex identifier for this session. */
  sessionId: string;
  /** ISO 8601 timestamp when the session was created. */
  createdAt: string;
  /** ISO 8601 timestamp when the session expires. */
  expiresAt: string;
  /** Registration mode governing key generation and on-chain flow. */
  mode: CliMode;
  /** Disclosure flags controlling what passport data is verified. */
  disclosures: RegistrationDisclosures & {
    nationality?: boolean;
    name?: boolean;
    date_of_birth?: boolean;
    gender?: boolean;
    issuing_state?: boolean;
  };
  /** Target network configuration. */
  network: CliNetwork;
  /** Registration-specific data: addresses, signatures, and user-defined payload. */
  registration: {
    /** Address identifying the human (wallet address or generated agent address). */
    humanIdentifier: string;
    /** Checksummed agent wallet address to be registered on-chain. */
    agentAddress: string;
    /** ASCII-encoded userData payload for the Self Hub verification request. */
    userDefinedData?: string;
    /** Keccak256 hash of the signed registration challenge. */
    challengeHash?: string;
    /** ECDSA signature parts proving agent key ownership. */
    signature?: RegistrationSignatureParts;
  };
  /** Mutable session state tracking lifecycle progress. */
  state: {
    /** Current lifecycle stage. */
    stage: SessionStage;
    /** ISO 8601 timestamp of the last state update. */
    updatedAt: string;
    /** Most recent error message, if any. */
    lastError?: string;
    /** On-chain agent token ID after successful registration. */
    agentId?: string;
  };
  /** Sensitive key material; only present for modes that generate agent keys. */
  secrets?: {
    /** Hex-encoded private key of the generated agent wallet. */
    agentPrivateKey?: string;
  };
}

/**
 * JSON payload base64url-encoded into the `/cli/register` handoff URL. The
 * server renders it as a Self app QR code; completion is detected on-chain.
 */
interface CliHandoffPayload {
  /** Schema version. */
  version: 1;
  /** Register or deregister. */
  operation: CliOperation;
  /** Registration mode. */
  mode: CliMode;
  /** Target EVM chain ID. */
  chainId: number;
  /** Checksummed registry contract address. */
  registryAddress: string;
  /** Self Protocol endpoint type. */
  endpointType: EndpointType;
  /** Application name displayed during verification. */
  appName: string;
  /** Self Protocol scope identifier. */
  scope: string;
  /** Human identifier (wallet address or generated agent address). */
  humanIdentifier: string;
  /** Disclosure flags for the verification request. */
  disclosures?: CliSession["disclosures"];
  /** ASCII-encoded userData for the Self Hub request. */
  userDefinedData: string;
  /** Unix epoch milliseconds when this session expires. */
  expiresAt: number;
}

/** A single parsed CLI flag value: a string argument or a boolean (present/absent). */
type FlagValue = string | boolean;

/** Map of parsed CLI flags. Repeated flags produce arrays. */
type FlagMap = Record<string, FlagValue | FlagValue[]>;

/** Base URL of the API serving `/cli/register`. Override via SELF_AGENT_APP_URL env var. */
const DEFAULT_APP_URL =
  process.env.SELF_AGENT_APP_URL || "https://agent-api.self.xyz";

/** Application name shown during Self verification. Override via SELF_AGENT_APP_NAME env var. */
const DEFAULT_APP_NAME = process.env.SELF_AGENT_APP_NAME || "Self Agent ID";

/** Self Protocol scope identifier. Override via SELF_AGENT_SCOPE env var. */
const DEFAULT_SCOPE = process.env.SELF_AGENT_SCOPE || "self-agent-id";

/**
 * Builds the CLI help text listing all available commands and example invocations.
 *
 * @returns Multi-line usage string.
 */
function usage(): string {
  return [
    "Self Agent CLI",
    "",
    "Commands:",
    "  register init    Create a local registration session (--mode linked | wallet-free)",
    "  register open    Print the QR code URL for the human to scan with the Self app",
    "  register wait    Wait for on-chain verification",
    "  register status  Show current session status",
    "  register export  Export generated agent private key (explicit unsafe flag required)",
    "  deregister init  Create a local deregistration session (--mode linked | wallet-free)",
    "  deregister open  Print the QR code URL for the human to scan with the Self app",
    "  deregister wait  Wait for on-chain deregistration",
    "  deregister status Show current session status",
    "",
    "Notes:",
    "  --network defaults to testnet (Celo Sepolia) in this CLI, while the SDK",
    "  classes (SelfAgent, SelfAgentVerifier, ...) default to mainnet.",
    "  Pass --network mainnet for production agents.",
    "  wait exits 0 on success, 2 on --timeout-seconds (the session stays",
    "  valid; run wait again), 1 on any other error, including an expired session.",
    "",
    "Examples:",
    "  self-agent register init --mode linked --human-address 0x... --network testnet --out .self/session.json",
    "  self-agent register open --session .self/session.json",
    "  self-agent register wait --session .self/session.json --timeout-seconds 1800",
    "  self-agent register export --session .self/session.json --unsafe --out-key .self/agent.key",
    "  self-agent deregister init --mode linked --human-address 0x... --agent-address 0x... --network testnet --out .self/session.json",
    "  self-agent deregister open --session .self/session.json",
    "  self-agent deregister wait --session .self/session.json --timeout-seconds 1800",
  ].join("\n");
}

/** Exit code of `wait` when `--timeout-seconds` elapses before completion. */
const EXIT_TIMEOUT = 2;

/**
 * Prints an error message to stderr and exits the process.
 *
 * @param message - Error message to display.
 * @param code - Exit code (default 1; {@link EXIT_TIMEOUT} for a wait timeout).
 */
function die(message: string, code = 1): never {
  process.stderr.write(`${message}\n`);
  process.exit(code);
}

/**
 * Returns the current time as an ISO 8601 string.
 *
 * @returns ISO 8601 timestamp.
 */
function nowIso(): string {
  return new Date().toISOString();
}

/**
 * Encodes a UTF-8 string as base64url (RFC 4648 Section 5) without padding.
 *
 * @param text - Plain text to encode.
 * @returns Base64url-encoded string.
 */
function base64UrlEncode(text: string): string {
  return Buffer.from(text, "utf8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

/**
 * Generates a cryptographically random hex string.
 *
 * @param bytes - Number of random bytes (default 16, producing 32 hex chars).
 * @returns Hex-encoded random string.
 */
function randomIdHex(bytes = 16): string {
  return randomBytes(bytes).toString("hex");
}

/**
 * Creates all parent directories for the given file path if they do not exist.
 *
 * @param path - Absolute or relative file path.
 */
function ensureDirForFile(path: string): void {
  mkdirSync(dirname(path), { recursive: true });
}

/**
 * Writes a value as pretty-printed JSON to a file with restrictive permissions (0600).
 *
 * @param path - Destination file path.
 * @param value - Value to serialize.
 */
function writeJsonFile(path: string, value: unknown): void {
  ensureDirForFile(path);
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
}

/**
 * Writes a plain text string to a file with restrictive permissions (0600).
 *
 * @param path - Destination file path.
 * @param value - Text content to write.
 */
function writeTextFile(path: string, value: string): void {
  ensureDirForFile(path);
  writeFileSync(path, value, { mode: 0o600 });
}

/**
 * Reads and parses a session JSON file from disk.
 *
 * @param path - Path to the session file.
 * @returns Parsed CLI session object.
 * @throws If the file cannot be read or is not valid JSON.
 */
function readSession(path: string): CliSession {
  const raw = readFileSync(path, "utf8");
  return JSON.parse(raw) as CliSession;
}

/**
 * Updates the session's `updatedAt` timestamp and writes it to disk.
 *
 * @param path - Path to the session file.
 * @param session - Session object to persist.
 */
function saveSession(path: string, session: CliSession): void {
  session.state.updatedAt = nowIso();
  writeJsonFile(path, session);
}

/**
 * Parses and validates a --mode flag value into a CliMode.
 *
 * @param value - Raw flag value (e.g. "linked"). Exits if missing or invalid.
 * @returns Validated registration mode.
 */
function parseMode(value: string | undefined): CliMode {
  if (!value) die("Missing required --mode");
  const normalized = value.trim().toLowerCase();
  if (normalized === "linked" || normalized === "wallet-free") {
    return normalized;
  }
  if (Object.prototype.hasOwnProperty.call(API_MODES, normalized)) {
    die(
      `--mode ${normalized} is not supported by the CLI. Use linked or wallet-free, ` +
        `or register with the SDK: requestRegistration({ mode: "${normalized}", ... }).`,
    );
  }
  die(`Unsupported mode: ${value}. Valid CLI modes: linked, wallet-free`);
}

/**
 * Parses a CLI flag value as a finite integer, exiting on invalid input.
 *
 * @param name - Flag name (for error messages).
 * @param value - Raw string value to parse.
 * @returns Parsed integer.
 */
function parseIntFlag(name: string, value: string | undefined): number {
  if (!value) die(`Missing value for --${name}`);
  const n = Number(value);
  if (!Number.isFinite(n) || !Number.isInteger(n)) {
    die(`Invalid integer for --${name}: ${value}`);
  }
  return n;
}

/**
 * Resolves network configuration from CLI flags. Supports named networks
 * (mainnet/testnet) or custom chains via --chain, --registry, and --rpc.
 *
 * @param flags - Parsed CLI flags (default network: testnet).
 * @returns Resolved network configuration.
 * @throws If `--registry` is not a valid address.
 */
function parseNetwork(flags: FlagMap): CliNetwork {
  const networkRaw = String(flags.network || "testnet").toLowerCase();
  const chainFlag = flags.chain
    ? parseIntFlag("chain", String(flags.chain))
    : undefined;
  const registryFlag = flags.registry ? String(flags.registry) : undefined;
  const rpcFlag = flags.rpc ? String(flags.rpc) : undefined;
  const appUrl = trimTrailingSlashes(
    String(flags["app-url"] || DEFAULT_APP_URL),
  );
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

/**
 * Parses disclosure flags (--minimum-age, --ofac, --nationality, etc.) into
 * a disclosure configuration object.
 *
 * @param flags - Parsed CLI flags.
 * @returns Disclosure settings for the verification request.
 */
function parseDisclosures(flags: FlagMap): CliSession["disclosures"] {
  const minimumAgeRaw = flags["minimum-age"]
    ? String(flags["minimum-age"])
    : "0";
  const minimumAge = parseIntFlag("minimum-age", minimumAgeRaw);
  if (minimumAge !== 0 && minimumAge !== 18 && minimumAge !== 21) {
    die("--minimum-age must be 0, 18, or 21");
  }

  return {
    minimumAge: minimumAge,
    ofac: Boolean(flags.ofac),
    nationality: Boolean(flags.nationality),
    name: Boolean(flags.name),
    date_of_birth: Boolean(flags["date-of-birth"]),
    gender: Boolean(flags.gender),
    issuing_state: Boolean(flags["issuing-state"]),
  };
}

/**
 * Parses raw argv tokens into positional arguments and a flag map.
 * Flags are identified by `--` prefix; values follow the flag unless the next
 * token is also a flag. Repeated flags produce arrays.
 *
 * @param argv - Argument tokens (typically `process.argv.slice(2)`).
 * @returns Object containing positional args and parsed flags.
 */
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

/**
 * Resolves the session file path from the --session flag.
 *
 * @param flags - Parsed CLI flags.
 * @param required - If true, exits when --session is not provided.
 * @returns Absolute path to the session file.
 */
function getSessionPath(flags: FlagMap, required = true): string {
  const raw = flags.session ? String(flags.session) : "";
  if (!raw && required) die("Missing required --session");
  return resolve(raw || ".self/session.json");
}

/**
 * Resolves the output file path from the --out flag, defaulting to a
 * randomly named file under `.self/`.
 *
 * @param flags - Parsed CLI flags.
 * @returns Absolute path for session output.
 */
function getOutPath(flags: FlagMap): string {
  const outRaw = flags.out
    ? String(flags.out)
    : `.self/session-${randomIdHex(8)}.json`;
  return resolve(outRaw);
}

/**
 * Converts an agent address into the 32-byte zero-padded hex key used
 * for on-chain registry lookups.
 *
 * @param agentAddress - Checksummed Ethereum address.
 * @returns 32-byte hex string (0x-prefixed).
 */
function expectedAgentKeyHex(agentAddress: string): string {
  return ethers.zeroPadValue(agentAddress, 32);
}

/**
 * Returns the session's operation type, defaulting to "register" for
 * backward compatibility with sessions created before the operation field existed.
 *
 * @param session - CLI session.
 * @returns The operation type.
 */
function getSessionOperation(session: CliSession): CliOperation {
  return session.operation || "register";
}

/**
 * Builds the handoff payload object from a session, ready to be
 * base64url-encoded and embedded in the browser handoff URL.
 *
 * @param session - CLI session to extract payload data from.
 * @returns Handoff payload for the browser app.
 */
function buildHandoffPayload(session: CliSession): CliHandoffPayload {
  if (!session.registration.userDefinedData) {
    die(
      `Session ${session.sessionId} has no userDefinedData (mode ${session.mode} is not supported by the CLI). Run \`init\` again.`,
    );
  }
  return {
    version: 1,
    operation: getSessionOperation(session),
    mode: session.mode,
    chainId: session.network.chainId,
    registryAddress: session.network.registryAddress,
    endpointType: session.network.endpointType,
    appName: session.network.appName,
    scope: session.network.scope,
    humanIdentifier: session.registration.humanIdentifier,
    disclosures: session.disclosures,
    userDefinedData: session.registration.userDefinedData,
    expiresAt: new Date(session.expiresAt).getTime(),
  };
}

/**
 * Constructs the `/cli/register` URL with the base64url-encoded payload as a
 * query parameter. The URL serves a PNG QR code for the human to scan.
 *
 * @param session - CLI session to generate the URL for.
 * @returns Complete handoff URL.
 */
function handoffUrl(session: CliSession): string {
  const payload = buildHandoffPayload(session);
  const encoded = base64UrlEncode(JSON.stringify(payload));
  return `${session.network.appUrl}/cli/register?payload=${encoded}`;
}

/**
 * Pretty-prints a value as JSON to stdout.
 *
 * @param value - Value to serialize and print.
 */
function printJson(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

/**
 * Prints a plain text string to stdout with a trailing newline.
 *
 * @param value - Text to print.
 */
function printText(value: string): void {
  process.stdout.write(`${value}\n`);
}

/**
 * Handles the `register init` subcommand. Delegates to {@link commandInit}.
 *
 * @param flags - Parsed CLI flags.
 */
async function commandRegisterInit(flags: FlagMap): Promise<void> {
  return commandInit(flags, "register");
}

/**
 * Handles the `deregister init` subcommand. Delegates to {@link commandInit}.
 *
 * @param flags - Parsed CLI flags.
 */
async function commandDeregisterInit(flags: FlagMap): Promise<void> {
  return commandInit(flags, "deregister");
}

/**
 * Core init command shared by register and deregister flows. Creates a new
 * session file with generated keys and signed challenges (register) or the
 * deregistration userData.
 *
 * @param flags - Parsed CLI flags.
 * @param operation - Whether to initialize a registration or deregistration session.
 * @throws If `--human-address` or `--agent-address` is not a valid address.
 */
async function commandInit(
  flags: FlagMap,
  operation: CliOperation,
): Promise<void> {
  const mode = parseMode(flags.mode ? String(flags.mode) : undefined);
  const network = parseNetwork(flags);
  const disclosures = parseDisclosures(flags);
  const ttlMinutes = flags["ttl-minutes"]
    ? parseIntFlag("ttl-minutes", String(flags["ttl-minutes"]))
    : 30;
  const outPath = getOutPath(flags);

  if (ttlMinutes <= 0) die("--ttl-minutes must be > 0");

  const sessionId = randomIdHex(16);
  const createdAt = nowIso();
  const expiresAt = new Date(Date.now() + ttlMinutes * 60_000).toISOString();

  const humanAddressRaw = flags["human-address"]
    ? String(flags["human-address"])
    : undefined;
  const agentAddressRaw = flags["agent-address"]
    ? String(flags["agent-address"])
    : undefined;

  let humanIdentifier = "";
  let agentAddress = "";
  let userDefinedData: string | undefined;
  let signature: RegistrationSignatureParts | undefined;
  let challengeHash: string | undefined;
  let agentPrivateKey: string | undefined;

  if (mode === "linked") {
    if (!humanAddressRaw) die("--human-address is required for linked mode");
    humanIdentifier = ethers.getAddress(humanAddressRaw);
  }

  if (operation === "register") {
    if (mode === "linked") {
      const wallet = ethers.Wallet.createRandom();
      agentPrivateKey = wallet.privateKey;
      agentAddress = wallet.address;

      // Nonce is 0 for freshly generated agent wallets (never registered before)
      const signed = await signRegistrationChallenge(agentPrivateKey, {
        humanIdentifier,
        chainId: network.chainId,
        registryAddress: network.registryAddress,
        nonce: 0,
      });

      challengeHash = signed.messageHash;
      signature = { r: signed.r, s: signed.s, v: signed.v };
      userDefinedData = buildAdvancedRegisterUserDataAscii({
        agentAddress,
        signature,
        disclosures,
      });
    } else {
      const wallet = ethers.Wallet.createRandom();
      agentPrivateKey = wallet.privateKey;
      agentAddress = wallet.address;
      humanIdentifier = agentAddress;

      // Nonce is 0 for freshly generated agent wallets (never registered before)
      const signed = await signRegistrationChallenge(agentPrivateKey, {
        humanIdentifier,
        chainId: network.chainId,
        registryAddress: network.registryAddress,
        nonce: 0,
      });

      challengeHash = signed.messageHash;
      signature = { r: signed.r, s: signed.s, v: signed.v };
      userDefinedData = buildWalletFreeRegisterUserDataAscii({
        agentAddress,
        signature,
        disclosures,
      });
    }
  } else {
    if (mode === "linked") {
      if (!agentAddressRaw)
        die("--agent-address is required for linked deregistration");
      agentAddress = ethers.getAddress(agentAddressRaw);
      userDefinedData = buildAdvancedDeregisterUserDataAscii({
        agentAddress,
        disclosures,
      });
    } else {
      if (!agentAddressRaw)
        die("--agent-address is required for wallet-free deregistration");
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
    requiresHumanAddress: mode === "linked",
    next: [
      `self-agent ${operation} open --session ${outPath}`,
      `self-agent ${operation} wait --session ${outPath}`,
    ],
  });
}

/**
 * Handles the `open` subcommand. Loads the session, checks expiry, generates
 * the QR code URL, and prints it to stdout. Updates the session stage to
 * "handoff_opened".
 *
 * @param flags - Parsed CLI flags (requires --session).
 */
function commandOpen(flags: FlagMap): void {
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
    instructions:
      "Open the URL to show a QR code, then scan it with the Self app. Run `wait` to detect completion on-chain.",
  });

  if (flags.launch) {
    printText(
      "Browser launch is not automatic in this build. Open the URL above manually.",
    );
  }
}

/**
 * Queries the on-chain registry to check whether the agent is verified and
 * retrieve its token ID.
 *
 * @param session - CLI session containing network and agent address info.
 * @returns Object with `verified` status and `agentId` token ID string.
 * @throws If an RPC call fails.
 */
async function pollOnChain(
  session: CliSession,
): Promise<{ verified: boolean; agentId: string }> {
  const provider = new ethers.JsonRpcProvider(session.network.rpcUrl);
  const registry = typedRegistry(session.network.registryAddress, provider);
  const agentKey = expectedAgentKeyHex(session.registration.agentAddress);
  const [verified, agentIdRaw] = await Promise.all([
    registry.isVerifiedAgent(agentKey),
    registry.getAgentId(agentKey),
  ]);
  const agentId = BigInt(agentIdRaw).toString();
  return { verified: Boolean(verified), agentId };
}

/**
 * Handles the `register wait` subcommand. Delegates to {@link commandWait}.
 *
 * @param flags - Parsed CLI flags.
 */
async function commandRegisterWait(flags: FlagMap): Promise<void> {
  return commandWait(flags);
}

/**
 * Handles the `deregister wait` subcommand. Delegates to {@link commandWait}.
 *
 * @param flags - Parsed CLI flags.
 */
async function commandDeregisterWait(flags: FlagMap): Promise<void> {
  return commandWait(flags);
}

/**
 * Core wait command shared by register and deregister flows. Optionally prints
 * the QR code URL, then polls the on-chain registry until the operation
 * completes or times out.
 *
 * A timeout exits with code 2 and leaves the session's stage unchanged (only
 * `lastError` is recorded); the session is marked "expired" only once its
 * `expiresAt` has passed (exit code 1).
 *
 * @param flags - Parsed CLI flags (requires --session; optional --timeout-seconds,
 *   --poll-ms, --open).
 */
async function commandWait(flags: FlagMap): Promise<void> {
  const sessionPath = getSessionPath(flags);
  const session = readSession(sessionPath);
  const operation = getSessionOperation(session);
  const timeoutSeconds = flags["timeout-seconds"]
    ? parseIntFlag("timeout-seconds", String(flags["timeout-seconds"]))
    : 1800;
  const pollMs = flags["poll-ms"]
    ? parseIntFlag("poll-ms", String(flags["poll-ms"]))
    : 4000;

  if (timeoutSeconds <= 0) die("--timeout-seconds must be > 0");
  if (pollMs <= 0) die("--poll-ms must be > 0");

  if (Date.now() > new Date(session.expiresAt).getTime()) {
    session.state.stage = "expired";
    session.state.lastError = "Session expired";
    saveSession(sessionPath, session);
    die(`Session expired. Run \`${operation} init\` again.`);
  }

  if (flags.open) {
    printText(handoffUrl(session));
    session.state.stage = "handoff_opened";
    saveSession(sessionPath, session);
  }

  const deadline = Date.now() + timeoutSeconds * 1000;
  let lastPollError = "";

  while (Date.now() < deadline) {
    try {
      // Bound each poll by the deadline: an unreachable RPC can stall forever.
      const { verified, agentId } = await withDeadline(
        pollOnChain(session),
        deadline,
      );
      const reachedTarget =
        operation === "register"
          ? verified && BigInt(agentId) > 0n
          : !verified && BigInt(agentId) === 0n;
      if (reachedTarget) {
        session.state.stage =
          operation === "register"
            ? "onchain_verified"
            : "onchain_deregistered";
        session.state.agentId = operation === "register" ? agentId : undefined;
        session.state.lastError = undefined;
        saveSession(sessionPath, session);
        printJson({
          ok: true,
          sessionPath,
          operation,
          stage: session.state.stage,
          agentAddress: session.registration.agentAddress,
          agentId: operation === "register" ? agentId : null,
        });
        return;
      }
    } catch (err) {
      lastPollError = err instanceof Error ? err.message : String(err);
    }

    await new Promise((r) =>
      setTimeout(r, Math.min(pollMs, Math.max(0, deadline - Date.now()))),
    );
  }

  if (Date.now() > new Date(session.expiresAt).getTime()) {
    session.state.stage = "expired";
    session.state.lastError = "Session expired";
    saveSession(sessionPath, session);
    die(`Session expired. Run \`${operation} init\` again.`);
  }

  // A timeout is not an expiry: the session stays usable until expiresAt.
  session.state.lastError =
    `Timed out waiting for on-chain ${operation}` +
    (lastPollError ? ` (last poll error: ${lastPollError})` : "");
  saveSession(sessionPath, session);
  die(
    `Timed out after ${timeoutSeconds}s waiting for on-chain ${operation}. ` +
      `Last poll error: ${lastPollError || "none"}. The session is still ` +
      `valid until ${session.expiresAt}; run \`${operation} wait\` again.`,
    EXIT_TIMEOUT,
  );
}

/**
 * Settle with `promise`, or reject once `deadline` passes.
 *
 * @param promise - Work to wait for.
 * @param deadline - Epoch milliseconds after which to give up.
 * @returns What `promise` resolves to.
 * @throws What `promise` rejects with, or a timeout error at the deadline.
 */
async function withDeadline<T>(
  promise: Promise<T>,
  deadline: number,
): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error("RPC call did not complete before the timeout")),
      Math.max(0, deadline - Date.now()),
    );
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Handles the `status` subcommand. Reads the session file and prints its
 * current state as JSON to stdout.
 *
 * @param flags - Parsed CLI flags (requires --session).
 */
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
    lastError: session.state.lastError || null,
  });
}

/**
 * Handles the `register export` subcommand. Extracts the generated agent
 * private key from the session and writes it to a file or prints it to stdout.
 * Requires the --unsafe flag as an explicit acknowledgment of key exposure.
 * The key is local, so export works before registration, but it warns on
 * stderr and reports `registered: false` until `wait` saw the agent on-chain.
 *
 * @param flags - Parsed CLI flags (requires --session, --unsafe; optional
 *   --out-key, --print-private-key).
 */
function commandRegisterExport(flags: FlagMap): void {
  const sessionPath = getSessionPath(flags);
  const session = readSession(sessionPath);
  const key = session.secrets?.agentPrivateKey;

  if (!key)
    die(
      "No agent private key in this session (deregistration sessions have no generated key).",
    );
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

  const registered = session.state.stage === "onchain_verified";
  if (!registered) {
    process.stderr.write(
      "Warning: this agent is not registered on-chain yet; run `register wait` first. The key won't verify until then.\n",
    );
  }

  printJson({
    ok: true,
    sessionPath,
    exportedTo: outKeyPath || null,
    printed: printKey,
    registered,
  });
}

/**
 * CLI entry point. Parses argv, dispatches to the appropriate command handler
 * based on the operation (register/deregister) and subcommand (init/open/wait/status/export).
 * Errors that escape a command are printed and exit with code 1.
 */
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
  if (sub === "init")
    return family === "register"
      ? commandRegisterInit(flags)
      : commandDeregisterInit(flags);
  if (sub === "open") return commandOpen(flags);
  if (sub === "wait")
    return family === "register"
      ? commandRegisterWait(flags)
      : commandDeregisterWait(flags);
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
