import { NextRequest } from "next/server";

export function makeNextRequest(
  url: string,
  init?: ConstructorParameters<typeof NextRequest>[1],
): NextRequest {
  return new NextRequest(url, init);
}

export async function jsonBody<T = Record<string, unknown>>(
  res: Response,
): Promise<T> {
  return (await res.json()) as T;
}
