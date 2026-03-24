// In-memory relay store for passing QR session data from agent API calls
// back to the frontend. Keyed by lowercase ed25519 pubkey.
//
// Works for single-instance deployments. For multi-instance / serverless,
// swap this for Redis or a similar shared store.

interface RelayEntry {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  qrData: any;
  deepLink: string;
  sessionToken: string;
  agentAddress: string;
  scanUrl?: string;
  createdAt: number;
}

const store = new Map<string, RelayEntry>();

const TTL_MS = 10 * 60 * 1000; // 10 minutes

export function setEd25519Relay(
  pubkey: string,
  data: Omit<RelayEntry, "createdAt">,
) {
  const key = pubkey.toLowerCase();
  store.set(key, { ...data, createdAt: Date.now() });
  setTimeout(() => store.delete(key), TTL_MS);
}

export function getEd25519Relay(pubkey: string): RelayEntry | null {
  const key = pubkey.toLowerCase();
  const entry = store.get(key);
  if (!entry) return null;
  if (Date.now() - entry.createdAt > TTL_MS) {
    store.delete(key);
    return null;
  }
  return entry;
}
