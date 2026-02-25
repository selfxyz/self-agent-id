/** Privy configuration helpers */

export function isPrivyConfigured(): boolean {
  return !!process.env.NEXT_PUBLIC_PRIVY_APP_ID;
}

export function getPrivyAppId(): string {
  return process.env.NEXT_PUBLIC_PRIVY_APP_ID || "";
}
