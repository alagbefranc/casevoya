/**
 * The Clients page's person tab, live only (SEC-01, SEC-05): the person's consent history, the
 * impact reviews their withdrawals opened, and their portal two-step with the staff-assisted reset.
 * Pure: built from public.person_consent_overview, read as the signed-in staff member (the
 * database decides who may see it). Dates are the firm's calendar dates.
 */
import type { MatterBadge } from "@/components/sheet/designer/matters";
import { CONSENT_LABEL, dayMonthYear, localDate } from "@/modules/compliance/format";

/** The Mark review done dialog and the Reset two-step dialog on the person tab. */
export const CONSENT_REVIEW_DIALOG = "dConsentDone";
export const TWO_STEP_RESET_DIALOG = "dTwoStepReset";

export type ConsentReviewItem = {
  id: string;
  version: number;
  title: string;
  /** "Opened 24 Oct 2026 · from the client's portal" */
  line: string;
  impacts: string[];
  open: boolean;
  /** For a done review: who, when, and their note. */
  done: string | null;
};

export type ConsentHistoryRow = { consent: string; choice: MatterBadge; when: string };

export type PersonConsentData = {
  organizationId: string;
  personId: string;
  reviews: ConsentReviewItem[];
  history: ConsentHistoryRow[];
  /** Null when the person has no portal sign-in. */
  twoStep: { badge: MatterBadge; detail: string; resets: string[] } | null;
};

type Overview = {
  history?: { id?: string; purpose?: string; granted?: boolean; withdrawn_at?: string | null; created_at?: string; scope?: string | null }[];
  reviews?: {
    id?: string;
    purpose?: string;
    source?: string;
    impacts?: unknown;
    status?: string;
    created_at?: string;
    done_at?: string | null;
    done_note?: string | null;
    done_by?: string | null;
    version?: number;
  }[];
  portal?: boolean;
  two_step?: boolean | null;
  resets?: { created_at?: string; identity_method?: string; reset_by?: string }[];
};

function label(purpose: string | undefined): string {
  return purpose ? (CONSENT_LABEL[purpose] ?? purpose.replaceAll("_", " ")) : "Consent";
}

function day(at: string | null | undefined, timeZone: string): string {
  return at ? dayMonthYear(localDate(at, timeZone)) : "—";
}

/** Null when the overview couldn't be read (the viewer may not see this person's consents). */
export function presentPersonConsent(input: {
  organizationId: string;
  personId: string;
  overview: unknown;
  timeZone: string;
  /** Display names of staff by user id, for "done by". */
  userName: (id: string | null | undefined) => string;
}): PersonConsentData | null {
  const data = input.overview;
  if (!data || typeof data !== "object" || Array.isArray(data)) return null;
  const overview = data as Overview;
  const reviews: ConsentReviewItem[] = (overview.reviews ?? [])
    .filter((row): row is typeof row & { id: string } => typeof row.id === "string")
    .map((row) => {
      const open = row.status !== "done";
      return {
        id: row.id,
        version: typeof row.version === "number" ? row.version : 1,
        title: `${label(row.purpose)} withdrawn`,
        line: `Opened ${day(row.created_at, input.timeZone)} · ${row.source === "portal" ? "from the client’s portal" : "recorded by staff"}`,
        impacts: Array.isArray(row.impacts) ? row.impacts.filter((item): item is string => typeof item === "string") : [],
        open,
        done: open ? null : `Done ${day(row.done_at, input.timeZone)} by ${input.userName(row.done_by)}: ${row.done_note ?? ""}`.trim(),
      };
    });
  const history: ConsentHistoryRow[] = (overview.history ?? []).map((row) => ({
    consent: row.scope && row.purpose === "share_section" ? `${label(row.purpose)} (${row.scope.replaceAll("_", " ")})` : label(row.purpose),
    choice: row.withdrawn_at
      ? { tone: "gr", label: `Withdrawn ${day(row.withdrawn_at, input.timeZone)}` }
      : row.granted
        ? { tone: "ok", label: "Given" }
        : { tone: "gr", label: "Refused or turned off" },
    when: day(row.created_at, input.timeZone),
  }));
  const twoStep = overview.portal
    ? {
        badge: overview.two_step ? ({ tone: "ok", label: "On" } as MatterBadge) : ({ tone: "gr", label: "Off" } as MatterBadge),
        detail: overview.two_step
          ? "The client confirms a code from their authenticator app at each sign-in. If they lose it, reset it here only after you’ve confirmed who they are."
          : "The client hasn’t turned on two-step sign-in. They can, on their Account page.",
        resets: (overview.resets ?? []).map((row) => `Reset ${day(row.created_at, input.timeZone)} by ${input.userName(row.reset_by)} · identity: ${row.identity_method ?? "—"}`),
      }
    : null;
  return { organizationId: input.organizationId, personId: input.personId, reviews, history, twoStep };
}

/** A review note, as public.complete_consent_review checks it. */
export function readReviewNote(value: string): { note: string } | { error: string } {
  const note = value.trim();
  if (note.length < 3 || note.length > 2000) return { error: "Write what you did, in 3 to 2000 characters." };
  return { note };
}

/** How the client's identity was checked, as public.reset_client_two_step checks it. */
export function readIdentityMethod(value: string): { method: string } | { error: string } {
  const method = value.trim();
  if (method.length < 3 || method.length > 500) return { error: "Say how you confirmed who the client is, in 3 to 500 characters." };
  return { method };
}

/** The database's refusals for these actions, in plain words. */
export function personConsentError(message: string): string | null {
  if (/version conflict/i.test(message)) return "Someone else changed this review. Reload to see it.";
  if (/already done/i.test(message)) return "This review is already done.";
  if (/3 to 2000/i.test(message)) return "Write what you did, in 3 to 2000 characters.";
  if (/verified who the client is/i.test(message)) return "Say how you confirmed who the client is.";
  if (/no portal sign-in/i.test(message)) return "This person has no portal sign-in.";
  if (/Team and seats/i.test(message)) return "This person is staff. Reset their two-step in Settings › Team and seats.";
  if (/consent review denied|reset denied/i.test(message)) return "You can’t act for this person. Ask the firm owner.";
  return null;
}
