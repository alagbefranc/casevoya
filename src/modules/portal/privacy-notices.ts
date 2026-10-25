import { dayMonthYear, localDate } from "@/modules/compliance/format";
import { shortHash } from "@/modules/compliance/privacy-response-format";
import type { PortalNotice } from "./notices";

/**
 * SEC-06 on the client's Home: their privacy request was extended (the new date, the firm's reason,
 * their recourse, and the law when the firm relied on an approved official time limit), or their
 * records are ready to download. Pure parsing and wording of public.privacy_requests_for_me.
 */

export type PrivacyNotice = PortalNotice & {
  /** Delivered: the download (each one is recorded as the delivery proof). */
  download?: { deliveryId: string };
  /** Not dismissible: it stays while it applies. */
  fixed: true;
};

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export function portalPrivacyNotices(raw: unknown, firmName: string, timezone: string, now: Date = new Date()): PrivacyNotice[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((entry): PrivacyNotice[] => {
    if (!entry || typeof entry !== "object") return [];
    const row = entry as Record<string, unknown>;
    const id = text(row.id);
    const reference = text(row.reference);
    if (!id || !reference) return [];
    const deliveryId = text(row.delivery_id);
    const expires = text(row.expires_at);
    if (deliveryId && expires) {
      if (new Date(expires) < now) return [];
      const files = typeof row.file_count === "number" ? `${row.file_count} files. ` : "";
      return [
        {
          id: deliveryId,
          title: `Your privacy request ${reference}: your records are ready`,
          body: `${firmName} has answered your request. Download them by ${dayMonthYear(localDate(expires, timezone))}. ${files}Fingerprint (SHA-256): ${shortHash(text(row.sha256))}. Each download is recorded.`,
          download: { deliveryId },
          fixed: true,
        },
      ];
    }
    const extended = text(row.extended_due_on);
    if (!extended || text(row.closed_at)) return [];
    const reason = text(row.extension_reason);
    const recourse = text(row.extension_recourse);
    const law = text(row.law_name);
    const section = text(row.source_section);
    const currentTo = text(row.current_to);
    const basis =
      row.extension_basis === "official" && law && section
        ? ` ${firmName} extended it under ${law}, ${section}${currentTo ? ` (current to ${dayMonthYear(currentTo)})` : ""}.`
        : "";
    return [
      {
        id,
        title: `We need more time for your privacy request ${reference}`,
        body: `${firmName} will respond by ${dayMonthYear(extended)}.${reason ? ` Why: ${reason}` : ""}${/[.!?]$/.test(reason ?? ".") ? "" : "."}${basis}${recourse ? ` ${recourse}` : ""}`,
        fixed: true,
      },
    ];
  });
}
