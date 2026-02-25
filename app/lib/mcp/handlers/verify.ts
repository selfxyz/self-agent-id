// app/lib/mcp/handlers/verify.ts

import { ethers } from "ethers";
import {
  SelfAgentVerifier,
  NETWORKS,
  REGISTRY_ABI,
  isProofExpiringSoon,
} from "@selfxyz/agent-sdk";
import type { McpConfig } from "../config";
import { toolError, toolSuccess } from "../utils";

interface VerifyAgentArgs {
  agent_address: string;
  network?: "mainnet" | "testnet";
  require_age?: 0 | 18 | 21;
  require_ofac?: boolean;
  require_self_provider?: boolean;
}

interface VerifyRequestArgs {
  agent_address: string;
  agent_signature: string;
  agent_timestamp: string;
  method: string;
  path: string;
  body?: string;
}

export async function handleVerifyAgent(args: VerifyAgentArgs, config: McpConfig) {
  const {
    agent_address,
    network = config.network,
    require_age = 0,
    require_ofac = false,
    require_self_provider = true,
  } = args;

  try {
    const networkConfig = NETWORKS[network];
    const rpcUrl = network === config.network ? config.rpcUrl : networkConfig.rpcUrl;
    const registryAddress = networkConfig.registryAddress;

    const provider = new ethers.JsonRpcProvider(rpcUrl);
    const registry = new ethers.Contract(registryAddress, REGISTRY_ABI, provider);

    const agentKey = ethers.zeroPadValue(agent_address, 32);
    const isVerified: boolean = await registry.isVerifiedAgent(agentKey);

    if (!isVerified) {
      return toolSuccess({
        verified: false,
        agent_address,
        reason: "Agent is not registered or not verified on-chain.",
        network,
      });
    }

    const agentId: bigint = await registry.getAgentId(agentKey);
    const nullifier: bigint = await registry.getHumanNullifier(agentId);
    const agentCount: bigint = await registry.getAgentCountForHuman(nullifier);
    const proofProvider: string = await registry.getProofProvider(agentId);
    const selfProvider: string = await registry.selfProofProvider();
    const registeredAt: bigint = await registry.agentRegisteredAt(agentId);

    // ERC-8004: check proof expiry
    let proofExpiresAt: Date | null = null;
    let proofExpired = false;
    let proofExpiringSoon = false;
    try {
      const expiresAtSecs: bigint = await registry.proofExpiresAt(agentId);
      if (expiresAtSecs > 0n) {
        proofExpiresAt = new Date(Number(expiresAtSecs) * 1000);
        const nowSecs = BigInt(Math.floor(Date.now() / 1000));
        proofExpired = nowSecs >= expiresAtSecs;
        if (!proofExpired) {
          proofExpiringSoon = isProofExpiringSoon(proofExpiresAt);
        }
      }
    } catch {
      // proofExpiresAt may not exist on older contracts — ignore
    }

    const rawCredentials = await registry.getAgentCredentials(agentId);
    const credentials = {
      nationality: rawCredentials.nationality || undefined,
      older_than: Number(rawCredentials.olderThan),
      ofac_clear: rawCredentials.ofac?.[0] === true,
    };

    const failures: string[] = [];

    if (proofExpired) {
      failures.push("Agent's proof-of-human has expired. Re-authentication required.");
    }

    if (require_self_provider) {
      if (proofProvider.toLowerCase() !== selfProvider.toLowerCase()) {
        failures.push(
          `Agent's proof provider (${proofProvider}) does not match Self Protocol provider (${selfProvider}).`,
        );
      }
    }

    if (require_age > 0 && credentials.older_than < require_age) {
      failures.push(
        `Agent's verified age (${credentials.older_than}+) does not meet minimum age requirement (${require_age}+).`,
      );
    }

    if (require_ofac && !credentials.ofac_clear) {
      failures.push("Agent has not passed OFAC screening.");
    }

    const isSelfProvider = proofProvider.toLowerCase() === selfProvider.toLowerCase();
    let verification_strength = "unknown";
    if (isSelfProvider) {
      verification_strength = "self-protocol";
    } else if (proofProvider !== ethers.ZeroAddress) {
      verification_strength = "third-party";
    }

    const expiryInfo: Record<string, unknown> = {};
    if (proofExpiresAt) {
      expiryInfo.proof_expires_at = proofExpiresAt.toISOString();
      expiryInfo.proof_expired = proofExpired;
      if (proofExpiringSoon) {
        expiryInfo.proof_expiring_soon = true;
        expiryInfo.expiry_warning = "Proof expires within 30 days. Agent should re-authenticate soon.";
      }
    }

    if (failures.length > 0) {
      return toolSuccess({
        verified: false,
        agent_address,
        agent_id: Number(agentId),
        reason: failures.join(" "),
        credentials,
        sybil_count: Number(agentCount),
        verification_strength,
        ...expiryInfo,
        network,
      });
    }

    return toolSuccess({
      verified: true,
      agent_address,
      agent_id: Number(agentId),
      credentials,
      sybil_count: Number(agentCount),
      verification_strength,
      registered_at: Number(registeredAt),
      ...expiryInfo,
      network,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return toolError(`Failed to verify agent: ${message}`);
  }
}

export async function handleVerifyRequest(args: VerifyRequestArgs, config: McpConfig) {
  const { agent_signature, agent_timestamp, method, path, body } = args;

  try {
    const verifier = SelfAgentVerifier.create()
      .network(config.network)
      .rpc(config.rpcUrl)
      .includeCredentials()
      .replayProtection(false)
      .build();

    const result = await verifier.verify({
      signature: agent_signature,
      timestamp: agent_timestamp,
      method,
      url: path,
      body,
    });

    if (!result.valid) {
      return toolSuccess({
        valid: false,
        agent_address: result.agentAddress || undefined,
        reason: result.error || "Verification failed",
      });
    }

    const credentials = result.credentials
      ? {
          nationality: result.credentials.nationality || undefined,
          older_than: Number(result.credentials.olderThan),
          ofac_clear: result.credentials.ofac?.[0] === true,
        }
      : undefined;

    return toolSuccess({
      valid: true,
      agent_address: result.agentAddress,
      agent_id: Number(result.agentId),
      agent_count: Number(result.agentCount),
      credentials,
      note: "Replay protection is not enforced at the MCP layer. " +
        "If you are building a service, implement your own nonce or replay cache.",
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return toolError(`Failed to verify request: ${message}`);
  }
}
