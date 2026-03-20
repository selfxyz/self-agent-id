// SPDX-FileCopyrightText: 2025-2026 Social Connect Labs, Inc.
// SPDX-License-Identifier: BUSL-1.1
// NOTE: Converts to Apache-2.0 on 2029-06-11 per LICENSE.

import QRCode from "qrcode";

const QR_WIDTH = 400;
const QR_MARGIN = 2;

/** Render `text` as a QR code PNG and return as a Buffer. */
export async function renderQrPng(text: string): Promise<Buffer> {
  return QRCode.toBuffer(text, {
    type: "png",
    width: QR_WIDTH,
    margin: QR_MARGIN,
  });
}

/** Render `text` as a QR code PNG and return as a base64 string (no data-URI prefix). */
export async function renderQrBase64(text: string): Promise<string> {
  const buf = await renderQrPng(text);
  return buf.toString("base64");
}
