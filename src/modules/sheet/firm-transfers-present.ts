/**
 * Settings > Team and seats, Continuity (ORG-06): the firm's transfers to another firm, from
 * public.firm_transfers_overview. Pure: the panel's rows and labels, and the server action
 * errors. Nothing here moves a matter; the receiving firm gets only what the owner hands over.
 */
import { dayMonth } from "@/modules/sheet/home-present";

export const TRANSFER_NEW_DIALOG = "dlgXfer";
export const TRANSFER_REVIEW_DIALOG = "dlgXferRev";
export const TRANSFER_CLOSE_DIALOG = "dlgXferClose";

export type TransferItemView = {
  id: string;
  matterId: string;
  matter: string;
  authority: { tone: "ok" | "chg" | "bad"; label: string };
  note: string | null;
  export: { label: string; href: string } | { label: string; href: null };
  /** Open transfer: Review authority (or review again). */
  canReview: boolean;
};

export type TransferView = {
  id: string;
  title: string;
  meta: string;
  status: { tone: "ok" | "chg" | "unv"; label: string };
  note: string | null;
  open: boolean;
  items: TransferItemView[];
  progress: string;
  /** Completed needs every matter's authority reviewed. */
  canComplete: boolean;
};

export type FirmTransfersData = {
  organizationId: string;
  transfers: TransferView[];
  /** The firm's own (not sample) matters, for New transfer. */
  matters: { id: string; label: string }[];
};

function obj(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}
function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}
function day(value: unknown): string | null {
  const iso = text(value);
  return iso ? dayMonth(iso.slice(0, 10)) : null;
}

const AUTHORITY: Record<string, TransferItemView["authority"]> = {
  pending: { tone: "chg", label: "Authority not reviewed" },
  authorised: { tone: "ok", label: "Client authorised" },
  not_authorised: { tone: "bad", label: "Client did not authorise" },
};

export function transferViews(raw: unknown): TransferView[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((row): TransferView[] => {
    const t = obj(row);
    const id = text(t.id);
    if (!id) return [];
    const status = text(t.status) ?? "open";
    const open = status === "open";
    const items = (Array.isArray(t.items) ? t.items : []).map(obj).flatMap((item): TransferItemView[] => {
      const itemId = text(item.id);
      const matterId = text(item.matter_id);
      if (!itemId || !matterId) return [];
      const authority = AUTHORITY[text(item.authority) ?? "pending"] ?? AUTHORITY.pending;
      const ready = obj(item.export);
      const readyOn = day(ready.ready_at);
      return [
        {
          id: itemId,
          matterId,
          matter: text(item.matter) ?? "A matter",
          authority,
          note: text(item.authority_note),
          export: text(ready.id)
            ? { label: `Export ready ${readyOn ?? ""}`.trim(), href: "/sheet/exports" }
            : open
              ? { label: "Create the export", href: "/sheet/exports" }
              : { label: "No export", href: null },
          canReview: open,
        },
      ];
    });
    const reviewed = items.filter((item) => item.authority.label !== AUTHORITY.pending.label).length;
    const exported = items.filter((item) => item.export.label.startsWith("Export ready")).length;
    const contact = [text(t.contact_name), text(t.contact_email)].filter(Boolean).join(", ");
    return [
      {
        id,
        title: `To ${text(t.receiving_firm) ?? "another firm"}`,
        meta: [`Recorded ${day(t.created_at) ?? ""}`.trim(), contact || null, status !== "open" && day(t.closed_at) ? `closed ${day(t.closed_at)}` : null].filter(Boolean).join(" · "),
        status: open ? { tone: "chg", label: "Open" } : status === "completed" ? { tone: "ok", label: "Completed" } : { tone: "unv", label: "Cancelled" },
        note: text(t.note),
        open,
        items,
        progress: `${reviewed} of ${items.length} authority reviewed · ${exported} of ${items.length} exported`,
        canComplete: open && items.length > 0 && reviewed === items.length,
      },
    ];
  });
}

/** The database's refusals in the owner's words, or null for the generic message. */
export function transferError(message: string): { error: string; stepUp?: boolean } | null {
  if (/step-up|aal2/i.test(message)) return { error: "Confirm it’s you with your authenticator, then try again.", stepUp: true };
  if (/receiving firm'?s email/i.test(message)) return { error: "Enter a full email address for the receiving firm, or leave it empty." };
  if (/name the receiving firm/i.test(message)) return { error: "Name the receiving firm." };
  if (/matters in scope/i.test(message)) return { error: "Choose at least one matter." };
  if (/own matters/i.test(message)) return { error: "Choose your firm’s own matters. Sample matters can’t be transferred." };
  if (/add a note/i.test(message)) return { error: "Add a note on the client’s authority (at least 3 characters)." };
  if (/whether the client authorised/i.test(message)) return { error: "Say whether the client authorised the transfer." };
  if (/every matter/i.test(message)) return { error: "Review the client’s authority on every matter before completing the transfer." };
  if (/closed/i.test(message)) return { error: "This transfer is already closed." };
  if (/too long/i.test(message)) return { error: "That’s too long. Shorten it and try again." };
  if (/denied|not found/i.test(message)) return { error: "Only the firm owner can do this." };
  return null;
}
