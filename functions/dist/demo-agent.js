"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const functions_framework_1 = require("@google-cloud/functions-framework");
const agent_sdk_1 = require("@selfxyz/agent-sdk");
const ethers_1 = require("ethers");
const REGISTRY = process.env.REGISTRY_ADDRESS;
const RPC = process.env.RPC_URL;
const DEMO_AGENT_PK = process.env.DEMO_AGENT_PRIVATE_KEY;
const verifier = new agent_sdk_1.SelfAgentVerifier({
    registryAddress: REGISTRY,
    rpcUrl: RPC,
    maxAgentsPerHuman: 0,
    includeCredentials: false,
});
// In-memory counters (resets on cold start — fine for demo)
let verificationCount = 0;
const uniqueHumans = new Set();
// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || "").split(",").filter(Boolean);
function setCors(req, res) {
    const origin = req.headers.origin || "";
    if (ALLOWED_ORIGINS.includes(origin) || ALLOWED_ORIGINS.includes("*")) {
        res.set("Access-Control-Allow-Origin", origin);
    }
    res.set("Access-Control-Allow-Headers", "Content-Type, x-self-agent-address, x-self-agent-signature, x-self-agent-timestamp");
    res.set("Access-Control-Expose-Headers", "x-self-agent-address, x-self-agent-signature, x-self-agent-timestamp");
    res.set("Access-Control-Allow-Methods", "POST, OPTIONS, GET");
}
// ---------------------------------------------------------------------------
// Cloud Function entry point
// ---------------------------------------------------------------------------
(0, functions_framework_1.http)("demoAgent", async (req, res) => {
    setCors(req, res);
    if (req.method === "OPTIONS") {
        res.status(204).send("");
        return;
    }
    // GET /health
    if (req.method === "GET" && (req.path === "/health" || req.path === "/")) {
        res.status(200).json({ status: "ok", service: "agent-id-demo-agent" });
        return;
    }
    if (req.method !== "POST") {
        res.status(405).json({ error: "Method not allowed" });
        return;
    }
    if (!DEMO_AGENT_PK) {
        res
            .status(500)
            .json({ error: "Demo agent not configured (missing DEMO_AGENT_PRIVATE_KEY)" });
        return;
    }
    // 1. Extract caller's signature headers
    const signature = req.headers[agent_sdk_1.HEADERS.SIGNATURE];
    const timestamp = req.headers[agent_sdk_1.HEADERS.TIMESTAMP];
    if (!signature || !timestamp) {
        res.status(401).json({ error: "Missing agent authentication headers" });
        return;
    }
    // Reconstruct the URL the agent signed against.
    // Cloud Run terminates TLS at the LB, so req.protocol is "http" internally.
    const proto = req.headers["x-forwarded-proto"] || req.protocol;
    const host = req.get("host");
    const urlPath = req.originalUrl === "/" ? "" : req.originalUrl;
    const fullUrl = `${proto}://${host}${urlPath}`;
    const body = req.rawBody?.toString("utf-8") || "";
    // 2. Demo agent verifies the caller's identity on-chain
    const verifyResult = await verifier.verify({
        signature,
        timestamp,
        method: "POST",
        url: fullUrl,
        body: body || undefined,
    });
    if (!verifyResult.valid) {
        res.status(403).json({
            verified: false,
            error: verifyResult.error || "Agent verification failed",
        });
        return;
    }
    // 3. Demo agent does on-chain sameHuman check
    const demoAgent = new agent_sdk_1.SelfAgent({
        privateKey: DEMO_AGENT_PK,
        registryAddress: REGISTRY,
        rpcUrl: RPC,
    });
    const provider = new ethers_1.ethers.JsonRpcProvider(RPC);
    const registry = new ethers_1.ethers.Contract(REGISTRY, [
        "function getAgentId(bytes32) view returns (uint256)",
        "function sameHuman(uint256, uint256) view returns (bool)",
        "function isVerifiedAgent(bytes32) view returns (bool)",
    ], provider);
    const demoKey = ethers_1.ethers.zeroPadValue(demoAgent.address, 32);
    const callerKey = verifyResult.agentKey;
    const [demoVerified, demoId, callerId, callerVerified] = await Promise.all([
        registry.isVerifiedAgent(demoKey),
        registry.getAgentId(demoKey),
        registry.getAgentId(callerKey),
        registry.isVerifiedAgent(callerKey),
    ]);
    let sameHumanResult = false;
    if (demoId > 0n && callerId > 0n) {
        sameHumanResult = await registry.sameHuman(demoId, callerId);
    }
    // Track verification stats
    verificationCount++;
    if (verifyResult.agentAddress) {
        uniqueHumans.add(verifyResult.agentAddress.toLowerCase());
    }
    const message = `Beep boop! You are agent #${verificationCount} that I have verified as being verified by a human. I have seen ${uniqueHumans.size} unique agent${uniqueHumans.size === 1 ? "" : "s"} so far.`;
    // 4. Build response payload
    const responsePayload = {
        verified: true,
        demoAgent: {
            address: demoAgent.address,
            agentId: demoId.toString(),
            verified: demoVerified,
        },
        callerAgent: {
            address: verifyResult.agentAddress,
            agentId: callerId.toString(),
            verified: callerVerified,
        },
        sameHuman: sameHumanResult,
        verificationCount,
        uniqueAgents: uniqueHumans.size,
        message,
    };
    const responseBody = JSON.stringify(responsePayload);
    // 5. Demo agent signs the response so caller can verify it came from us
    const responseHeaders = await demoAgent.signRequest("POST", fullUrl, responseBody);
    res.status(200);
    res.set("Content-Type", "application/json");
    res.set(agent_sdk_1.HEADERS.ADDRESS, responseHeaders[agent_sdk_1.HEADERS.ADDRESS]);
    res.set(agent_sdk_1.HEADERS.SIGNATURE, responseHeaders[agent_sdk_1.HEADERS.SIGNATURE]);
    res.set(agent_sdk_1.HEADERS.TIMESTAMP, responseHeaders[agent_sdk_1.HEADERS.TIMESTAMP]);
    res.send(responseBody);
});
