/** Firm logo files: what is accepted and where it is kept. Pure; the upload route, setup and its page use it. */
import { detectMediaType } from "@/modules/documents/files";

export const FIRM_LOGO_BUCKET = "firm-logos";
/** Matches the bucket's own limit. */
export const FIRM_LOGO_MAX_BYTES = 2 * 1024 * 1024;
/** How long a preview link to the stored logo works. */
export const FIRM_LOGO_PREVIEW_SECONDS = 60 * 60;

/**
 * PNG and JPEG only. SVG is refused: it can carry script and links, and a logo is shown to
 * clients, so it would need sanitising before it could be served.
 */
const EXTENSION = { "image/jpeg": "jpg", "image/png": "png" } as const;
export type FirmLogoType = keyof typeof EXTENSION;

/** The file's real type from its bytes. */
export function firmLogoType(bytes: Uint8Array): FirmLogoType | null {
  const type = detectMediaType(bytes);
  return type && type in EXTENSION ? (type as FirmLogoType) : null;
}

export function firmLogoKey(organizationId: string, fileId: string, type: FirmLogoType): string {
  return `${organizationId}/${fileId}.${EXTENSION[type]}`;
}

/** What organizations.branding.logo_locator stores: bucket and key. */
export function firmLogoLocator(key: string): string {
  return `${FIRM_LOGO_BUCKET}/${key}`;
}

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";

/** The storage key inside a locator, only when it is this firm's own stored logo. */
export function ownFirmLogoKey(locator: string, organizationId: string): string | null {
  if (!new RegExp(`^${UUID}$`, "i").test(organizationId)) return null;
  const pattern = new RegExp(`^${FIRM_LOGO_BUCKET}/(${organizationId}/${UUID}\\.(png|jpg))$`, "i");
  const match = pattern.exec(locator.trim());
  return match ? match[1] : null;
}

/** The locator saved on organizations.branding, if any. */
export function brandingLogoLocator(branding: unknown): string | null {
  if (!branding || typeof branding !== "object" || Array.isArray(branding)) return null;
  const value = (branding as Record<string, unknown>).logo_locator;
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

/** The saved accent colour (#RRGGBB) in organizations.branding, if any. */
export function brandingAccent(branding: unknown): string | null {
  if (!branding || typeof branding !== "object" || Array.isArray(branding)) return null;
  const value = (branding as Record<string, unknown>).accent;
  return typeof value === "string" && /^#[0-9A-Fa-f]{6}$/.test(value.trim()) ? value.trim() : null;
}
