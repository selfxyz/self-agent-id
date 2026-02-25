// SPDX-FileCopyrightText: 2025-2026 Social Connect Labs, Inc.
// SPDX-License-Identifier: BUSL-1.1
// NOTE: Converts to Apache-2.0 on 2029-06-11 per LICENSE.

import { ethers } from "ethers";

// Fixed test key — never changes, used only for deterministic test vectors
const TEST_PRIVATE_KEY = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
const wallet = new ethers.Wallet(TEST_PRIVATE_KEY);

interface TestVector {
  timestamp: string;
  method: string;
  url: string;
  body: string | null;
  body_hash: string;
  message: string;
  signature: string;
  recovered_address: string;
  agent_key: string;
}

function canonicalizeSigningUrl(url: string): string {
  if (!url) return "";
  if (url.startsWith("http://") || url.startsWith("https://")) {
    try {
      const parsed = new URL(url);
      return (parsed.pathname || "/") + parsed.search;
    } catch {
      return url;
    }
  }
  if (url.startsWith("?")) return `/${url}`;
  if (url.startsWith("/")) return url;
  try {
    const parsed = new URL(url, "http://self.local");
    return (parsed.pathname || "/") + parsed.search;
  } catch {
    return url;
  }
}

const cases = [
  { ts: "1700000000000", method: "GET",  url: "https://api.example.com/data", body: null },
  { ts: "1700000000001", method: "POST", url: "https://api.example.com/data", body: '{"query":"test"}' },
  { ts: "1700000000002", method: "POST", url: "https://api.example.com/data", body: "" },
  { ts: "1700000000003", method: "PUT",  url: "https://api.example.com/data", body: "héllo wörld \u{1F30D}" },
  { ts: "1700000000004", method: "post", url: "https://api.example.com/data", body: '{"a":1}' },
  { ts: "1700000000005", method: "GET",  url: "https://api.example.com/search?q=test&page=2", body: null },
];

async function generate(): Promise<void> {
  const vectors: TestVector[] = [];

  for (const c of cases) {
    const bodyHash = c.body !== null
      ? ethers.keccak256(ethers.toUtf8Bytes(c.body))
      : ethers.keccak256(ethers.toUtf8Bytes(""));

    const canonicalUrl = canonicalizeSigningUrl(c.url);
    const message = ethers.keccak256(
      ethers.toUtf8Bytes(c.ts + c.method.toUpperCase() + canonicalUrl + bodyHash)
    );

    const signature = await wallet.signMessage(ethers.getBytes(message));
    const recovered = ethers.verifyMessage(ethers.getBytes(message), signature);
    const agentKey = ethers.zeroPadValue(wallet.address, 32);

    vectors.push({
      timestamp: c.ts,
      method: c.method,
      url: c.url,
      body: c.body,
      body_hash: bodyHash,
      message,
      signature,
      recovered_address: recovered,
      agent_key: agentKey,
    });
  }

  console.log(JSON.stringify({ private_key: TEST_PRIVATE_KEY, vectors }, null, 2));
}

generate();
