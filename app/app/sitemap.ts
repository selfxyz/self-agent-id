// SPDX-FileCopyrightText: 2025-2026 Social Connect Labs, Inc.
// SPDX-License-Identifier: BUSL-1.1
// NOTE: Converts to Apache-2.0 on 2029-06-11 per LICENSE.

import type { MetadataRoute } from "next";

const BASE = "https://app.ai.self.xyz";

export default function sitemap(): MetadataRoute.Sitemap {
  return [
    { url: BASE, changeFrequency: "weekly", priority: 1.0 },
    {
      url: `${BASE}/agents/register`,
      changeFrequency: "weekly",
      priority: 0.9,
    },
    { url: `${BASE}/agents`, changeFrequency: "daily", priority: 0.8 },
    { url: `${BASE}/agents/verify`, changeFrequency: "weekly", priority: 0.7 },
    { url: `${BASE}/agents/visa`, changeFrequency: "weekly", priority: 0.6 },
    { url: `${BASE}/demo`, changeFrequency: "monthly", priority: 0.6 },
    { url: `${BASE}/cli`, changeFrequency: "monthly", priority: 0.5 },
    { url: `${BASE}/api-docs`, changeFrequency: "weekly", priority: 0.7 },
    { url: `${BASE}/integration`, changeFrequency: "monthly", priority: 0.5 },
    { url: `${BASE}/explainer`, changeFrequency: "monthly", priority: 0.5 },
    { url: `${BASE}/erc8004`, changeFrequency: "monthly", priority: 0.5 },
    { url: `${BASE}/llms.txt`, changeFrequency: "weekly", priority: 0.8 },
    {
      url: `${BASE}/.well-known/agent-card.json`,
      changeFrequency: "weekly",
      priority: 0.7,
    },
  ];
}
