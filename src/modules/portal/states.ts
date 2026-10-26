/**
 * DES-04 for the client portal: which record a link asked for that the person can't see, and which
 * parts of a page didn't load. Pure, so the server page and the tests share it. Row-level security
 * decides what a person can read; a link to anything else reads exactly like a missing one, so the
 * copy never says whether it exists.
 */

/** A record named in the address (?matter=, ?invoice=, ?id=, ?thread=, ?response=) the person can't see. */
export type PortalDenied = "matter" | "invoice" | "receipt" | "thread" | "form";

/** A part of a page whose records couldn't be read while the rest could. */
export type PortalPart =
  | "tasks"
  | "documents"
  | "payments"
  | "messages"
  | "consultant"
  | "payment status"
  | "receipts"
  | "credit notes"
  | "client account"
  | "review notes"
  | "consultation summaries"
  | "change rules"
  | "renewal reminders"
  | "updates from your firm"
  | "decision documents";

type DeniedCopy = {
  title: string;
  lead: (firm: string) => string;
  body: (firm: string) => string;
  back: { href: string; label: string };
};

export const DENIED_COPY: Record<PortalDenied, DeniedCopy> = {
  matter: {
    title: "That matter isn’t on your file",
    lead: () => "You can only open matters you’re a part of.",
    body: (firm) => `The link points to a matter you can’t see, so you’re looking at your own instead. If you think you should see it, ask ${firm}.`,
    back: { href: "/portal/matters", label: "My matters" },
  },
  invoice: {
    title: "This invoice isn’t available to you",
    lead: () => "You can only see and pay invoices on your own matters.",
    body: (firm) => `It isn’t on your file, or it was withdrawn. Nothing was charged. If you were asked to pay it, ask ${firm} for a new link.`,
    back: { href: "/portal/payments", label: "Payments" },
  },
  receipt: {
    title: "This receipt isn’t available to you",
    lead: () => "Receipts are shown to the person who paid.",
    body: (firm) => `It isn’t on your file, or it couldn’t be read just now. Your receipts are listed under Payments. If one is missing, ask ${firm}.`,
    back: { href: "/portal/payments", label: "Payments" },
  },
  thread: {
    title: "That conversation isn’t yours to read",
    lead: () => "You see the conversations you’re part of.",
    body: (firm) => `The link points to a conversation you can’t see, so your own are shown instead. If you think you should see it, ask ${firm}.`,
    back: { href: "/portal/messages", label: "Messages" },
  },
  form: {
    title: "That form isn’t on your file",
    lead: () => "You see the forms your firm sent to you.",
    body: (firm) => `The link points to a form you can’t open, so your own forms are shown instead. If you were asked to fill it in, ask ${firm}.`,
    back: { href: "/portal/intake", label: "Your questions" },
  },
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The record the address asked for that didn't resolve to one of the person's own. Only a well-formed
 * id counts: a malformed one was never a record (it is ignored, as before).
 */
export function deniedFor(input: {
  page: string;
  matter?: string | null;
  matterIds: readonly string[];
  invoice?: string | null;
  invoiceIds?: readonly string[] | null;
  receipt?: string | null;
  receiptFound?: boolean;
  thread?: string | null;
  threadOpened?: boolean | null;
  response?: string | null;
  responseSelected?: string | null;
  responseLoaded?: boolean;
}): PortalDenied | null {
  const asked = (value: string | null | undefined): value is string => Boolean(value && UUID.test(value));
  if (input.page === "pay" && asked(input.invoice) && input.invoiceIds && !input.invoiceIds.includes(input.invoice)) return "invoice";
  if (input.page === "receipt" && asked(input.receipt) && input.receiptFound === false) return "receipt";
  if (input.page === "messages" && asked(input.thread) && input.threadOpened === false) return "thread";
  if ((input.page === "intake" || input.page === "correction") && asked(input.response) && input.responseLoaded && input.responseSelected !== input.response) return "form";
  if (asked(input.matter) && !input.matterIds.includes(input.matter)) return "matter";
  return null;
}

/** "Payments", "Payments and messages", "Tasks, documents and messages". */
export function partList(parts: readonly PortalPart[]): string {
  const unique = [...new Set(parts)];
  const text = unique.length <= 1 ? (unique[0] ?? "") : `${unique.slice(0, -1).join(", ")} and ${unique[unique.length - 1]}`;
  return text ? text[0].toUpperCase() + text.slice(1) : text;
}
