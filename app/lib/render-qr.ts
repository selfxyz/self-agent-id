// SPDX-FileCopyrightText: 2025-2026 Social Connect Labs, Inc.
// SPDX-License-Identifier: BUSL-1.1
// NOTE: Converts to Apache-2.0 on 2029-06-11 per LICENSE.

/**
 * Server-side QR code rendering (PNG) for Self app deep links.
 */

import QRCode from "qrcode";

// Whole pixels per module keep edges crisp when the image is scaled down with
// CSS; 4 modules of quiet zone is the QR spec minimum for reliable scanning.
// Self deep links render at ~113 modules → a ~968px, ~21KB PNG.
const QR_SCALE = 8;
const QR_MARGIN = 4;

/**
 * Render text as a QR code PNG.
 *
 * @param text - Content to encode (usually a Self deep link).
 * @returns PNG bytes.
 * @throws If the text is too long to fit in a QR code.
 */
export async function renderQrPng(text: string): Promise<Buffer> {
  return QRCode.toBuffer(text, {
    type: "png",
    scale: QR_SCALE,
    margin: QR_MARGIN,
  });
}

/**
 * Render text as a QR code PNG, base64-encoded.
 *
 * @param text - Content to encode (usually a Self deep link).
 * @returns Base64 PNG with no data-URI prefix.
 * @throws If the text is too long to fit in a QR code.
 */
export async function renderQrBase64(text: string): Promise<string> {
  const buf = await renderQrPng(text);
  return buf.toString("base64");
}
