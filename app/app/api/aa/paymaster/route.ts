import { NextRequest, NextResponse } from "next/server";

const PIMLICO_API_KEY = process.env.PIMLICO_API_KEY;

// Only allow chains we actually operate on
const ALLOWED_CHAINS = new Set(["42220", "11142220"]);

export async function POST(req: NextRequest) {
  if (!PIMLICO_API_KEY) {
    return NextResponse.json(
      { error: "Paymaster not configured" },
      { status: 503 },
    );
  }

  const { searchParams } = new URL(req.url);
  const chainId = searchParams.get("chainId");
  if (!chainId || !ALLOWED_CHAINS.has(chainId)) {
    return NextResponse.json(
      { error: "Unsupported or missing chain" },
      { status: 400 },
    );
  }

  const body = await req.text();
  const pimlicoUrl = `https://api.pimlico.io/v2/${chainId}/rpc?apikey=${PIMLICO_API_KEY}`;

  const upstream = await fetch(pimlicoUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
  });

  const data = await upstream.text();
  return new NextResponse(data, {
    status: upstream.status,
    headers: { "Content-Type": "application/json" },
  });
}
