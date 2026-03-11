// SPDX-FileCopyrightText: 2025-2026 Social Connect Labs, Inc.
// SPDX-License-Identifier: BUSL-1.1
// NOTE: Converts to Apache-2.0 on 2029-06-11 per LICENSE.

import webpack from "next/dist/compiled/webpack/webpack-lib.js";

/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: ["@noble/curves", "@noble/hashes"],
  webpack: (config, { isServer }) => {
    if (!isServer) {
      // Ed25519Agent and SelfAgentVerifier use require("node:crypto") —
      // rewrite to bare "crypto" so webpack's fallback can resolve it.
      config.plugins.push(
        new webpack.NormalModuleReplacementPlugin(
          /^node:crypto$/,
          "crypto-browserify",
        ),
        new webpack.NormalModuleReplacementPlugin(
          /^node:stream$/,
          "stream-browserify",
        ),
      );
      config.resolve.fallback = {
        ...config.resolve.fallback,
        crypto: "crypto-browserify",
        stream: "stream-browserify",
      };
    }
    return config;
  },
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "X-DNS-Prefetch-Control", value: "off" },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=()",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
