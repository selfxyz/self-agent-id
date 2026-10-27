// SPDX-FileCopyrightText: 2025-2026 Social Connect Labs, Inc.
// SPDX-License-Identifier: BUSL-1.1
// NOTE: Converts to Apache-2.0 on 2029-06-11 per LICENSE.

/**
 * Builds the Self app request behind every QR / deep link.
 *
 * Used by every human-in-the-loop flow: register, deregister, refresh,
 * identify and the CLI handoff.
 */

import { SelfAppBuilder, type SelfApp } from "@selfxyz/sdk-common";
import {
  DISCLOSURE_KEYS,
  getNetworkConfig,
  type ApiNetwork,
  type ParsedDisclosures,
} from "@/lib/agent-api-helpers";

const SELF_APP_LOGO_URL = "https://i.postimg.cc/mrmVf9hm/self.png";

/**
 * Read the app name and scope seed the registry's Self verification config is
 * bound to.
 *
 * @returns `appName` (NEXT_PUBLIC_SELF_APP_NAME, default "Self Agent ID") and
 *   `scope` (NEXT_PUBLIC_SELF_SCOPE_SEED, default "self-agent-id").
 */
export function selfAppIdentity(): { appName: string; scope: string } {
  return {
    appName: process.env.NEXT_PUBLIC_SELF_APP_NAME || "Self Agent ID",
    scope: process.env.NEXT_PUBLIC_SELF_SCOPE_SEED || "self-agent-id",
  };
}

/**
 * Build the Self app request aimed at this network's registry.
 *
 * Only requested disclosures are included: true flags, and minimumAge when
 * non-zero.
 *
 * @param params.network - Network whose registry receives the proof.
 * @param params.userId - 0x-prefixed 20-byte hex ID (lowercased here; the
 *   builder strips the 0x).
 * @param params.userDefinedData - Action payload the registry decodes.
 * @param params.disclosures - Disclosures to request (default none).
 * @returns The SelfApp to encode as a QR / deep link.
 * @throws If the builder rejects the config (e.g. a malformed userId).
 */
export function buildSelfApp(params: {
  network: ApiNetwork;
  userId: string;
  userDefinedData: string;
  disclosures?: Partial<ParsedDisclosures>;
}): SelfApp {
  const networkConfig = getNetworkConfig(params.network);
  const requested = params.disclosures ?? {};
  const disclosures: Record<string, boolean | number> = {};
  for (const key of DISCLOSURE_KEYS) {
    if (requested[key]) disclosures[key] = true;
  }
  if (requested.minimumAge) disclosures.minimumAge = requested.minimumAge;

  return new SelfAppBuilder({
    version: 2,
    ...selfAppIdentity(),
    endpoint: networkConfig.registryAddress,
    logoBase64: SELF_APP_LOGO_URL,
    userId: params.userId.toLowerCase(),
    endpointType: networkConfig.selfEndpointType,
    userIdType: "hex",
    userDefinedData: params.userDefinedData,
    disclosures,
  }).build();
}
