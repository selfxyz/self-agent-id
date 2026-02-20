import { NextRequest, NextResponse } from "next/server";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ agentId: string }> }
) {
  const { agentId } = await params;
  const chain = req.nextUrl.searchParams.get("chain") || "42220";

  const origin = req.nextUrl.origin;
  const target = `${origin}/api/cards/${chain}/${agentId}`;

  return NextResponse.redirect(target, 302);
}
