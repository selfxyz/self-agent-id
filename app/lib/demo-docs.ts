// SPDX-FileCopyrightText: 2025-2026 Social Connect Labs, Inc.
// SPDX-License-Identifier: BUSL-1.1
// NOTE: Converts to Apache-2.0 on 2029-06-11 per LICENSE.

import { NextResponse } from "next/server";

interface EndpointDocConfig {
  endpoint: string;
  method: string;
  description: string;
  requiredHeaders: Record<string, string>;
  optionalHeaders?: Record<string, string>;
  bodySchema?: Record<string, string>;
  exampleBody?: Record<string, unknown>;
  notes?: string[];
}

export function demoEndpointDocs(config: EndpointDocConfig): NextResponse {
  return NextResponse.json(
    {
      endpoint: config.endpoint,
      method: config.method,
      description: config.description,
      authentication: {
        required: true,
        protocol: "Self Agent ID signed headers",
        requiredHeaders: config.requiredHeaders,
        ...(config.optionalHeaders
          ? { optionalHeaders: config.optionalHeaders }
          : {}),
        howToSign:
          "Use agent.fetch() from @selfxyz/agent-sdk, or manually sign with agent.signRequest() and attach headers.",
      },
      ...(config.bodySchema ? { bodySchema: config.bodySchema } : {}),
      ...(config.exampleBody ? { exampleBody: config.exampleBody } : {}),
      ...(config.notes ? { notes: config.notes } : {}),
      sdkExample: `const res = await agent.fetch("https://app.ai.self.xyz${config.endpoint}?network=celo-sepolia", { method: "${config.method}", headers: { "Content-Type": "application/json" }, body: JSON.stringify({}) });`,
    },
    {
      status: 200,
      headers: { "Cache-Control": "public, max-age=3600" },
    },
  );
}
