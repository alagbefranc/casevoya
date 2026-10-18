import "server-only";

import QRCode from "qrcode";

/**
 * The QR for an authenticator's otpauth:// link, as an SVG data URI of a few kilobytes.
 * Supabase's own qr_code is a ~320 KB SVG; drawing it here keeps the setup small enough
 * to send and to keep in the pending-setup cookie as a link instead of an image.
 */
export async function totpQr(uri: string): Promise<string> {
  const svg = await QRCode.toString(uri, { type: "svg", errorCorrectionLevel: "M", margin: 1 });
  return `data:image/svg+xml;utf-8,${encodeURIComponent(svg)}`;
}
