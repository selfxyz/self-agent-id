import { type NextRequest, NextResponse } from "next/server";
import { ethers } from "ethers";
import { CHAIN_CONFIG } from "@/lib/chain-config";
import { VISA_ABI } from "@/lib/constants";
import { CORS_HEADERS, corsResponse, errorResponse } from "@/lib/api-helpers";

export const maxDuration = 60;

const RELAYER_PK = process.env.RELAYER_PRIVATE_KEY;

interface ReviewRequest {
  chainId: string;
  agentId: string;
  targetTier: number;
}

export async function POST(req: NextRequest) {
  if (!RELAYER_PK) {
    return errorResponse("Relayer not configured", 503);
  }

  let body: ReviewRequest;
  try {
    const parsed = (await req.json()) as unknown;
    if (!parsed || typeof parsed !== "object") {
      return errorResponse("Invalid JSON body", 400);
    }
    body = parsed as ReviewRequest;
  } catch {
    return errorResponse("Invalid JSON body", 400);
  }

  const { chainId, agentId, targetTier } = body;

  if (!chainId || !agentId) {
    return errorResponse("chainId and agentId are required", 400);
  }

  if (!targetTier || targetTier < 2 || targetTier > 3) {
    return errorResponse("targetTier must be 2 or 3", 400);
  }

  const config = CHAIN_CONFIG[chainId];
  if (!config) return errorResponse(`Unsupported chain: ${chainId}`, 400);
  if (!config.visa)
    return errorResponse("Visa not deployed on this network", 404);

  try {
    const provider = new ethers.JsonRpcProvider(config.rpc);
    const relayer = new ethers.Wallet(RELAYER_PK, provider);
    const visa = new ethers.Contract(config.visa, VISA_ABI, relayer);

    const tx = await visa.requestReview(BigInt(agentId), targetTier);
    const receipt = await tx.wait();

    return NextResponse.json(
      {
        success: true,
        agentId,
        targetTier,
        txHash: receipt.hash,
      },
      { headers: CORS_HEADERS },
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes("InvalidTier")) {
      return errorResponse("Invalid tier for review request", 400);
    }
    if (message.includes("TierNotHigher")) {
      return errorResponse(
        "Agent is already at or above the requested tier",
        409,
      );
    }
    return errorResponse(`Review request failed: ${message}`, 500);
  }
}

export function OPTIONS() {
  return corsResponse();
}
