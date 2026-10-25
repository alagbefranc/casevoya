/**
 * The Lead page's "Follow-up with Vo" panel and the consultation record's "Call notes" panel
 * (PRD AI-01, AI-06). Pure: rows in, the panels' data out, so the switch, consent and copy rules
 * are tested. Vo off, a capability off or the Vo service not set up: no button (the manual paths,
 * notes and Edit lead, still work); a draft already waiting is still shown so a person can decide.
 */
import type { CallNotesData, LeadVoData, VoCrmDraftView, VoCrmWire } from "@/components/sheet/designer/vo-crm";
import { replyGranted, marketingGranted, type ConsentRow } from "@/modules/leads/present";
import { NEEDS_RULE } from "@/modules/vo/prompt";
import { MAX_CALL_NOTES } from "@/modules/vo/crm";
import type { VoSettings } from "@/modules/sheet/vo-present";

export type VoCrmDraftRow = {
  id: string;
  body: string;
  sources: unknown;
  needs_rule: boolean;
  marketing_consent: boolean | null;
  left_out: number;
};

export type MailboxRow = { toolkit: string; status: string };

const MAILBOX_LABEL: Record<string, string> = { gmail: "Gmail", outlook: "Outlook" };

function sourceLabels(value: unknown): string[] {
  return Array.isArray(value)
    ? value
        .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object")
        .map((item) => String(item.label ?? "").trim())
        .filter(Boolean)
    : [];
}

function plural(count: number, one: string, other: string) {
  return `${count} ${count === 1 ? one : other}`;
}

function draftView(row: VoCrmDraftRow, wire: VoCrmWire, extra: Partial<VoCrmDraftView> = {}): VoCrmDraftView {
  const labels = sourceLabels(row.sources);
  return {
    id: row.id,
    body: row.body,
    sources: labels.length ? `Vo read: ${labels.slice(0, 6).join(", ")}${labels.length > 6 ? ` and ${labels.length - 6} more` : ""}.` : "Vo read the firm’s records for this.",
    leftOut: row.left_out > 0 ? `Vo wasn’t given ${plural(row.left_out, "note", "notes")}: ${row.left_out === 1 ? "it mentions" : "they mention"} details the firm keeps from Vo.` : null,
    needsRule: row.needs_rule || row.body.includes(NEEDS_RULE) ? `Replace “${NEEDS_RULE}” with a checked, sourced fact (or remove it) before you use this.` : null,
    marketing: null,
    wire,
    mailbox: [],
    save: null,
    ...extra,
  };
}

export type LeadVoInput = {
  organizationId: string;
  lead: { id: string; email: string | null; phone: string | null; convertedMatterId: string | null };
  consents: readonly ConsentRow[];
  settings: VoSettings;
  agentReady: boolean;
  draft: VoCrmDraftRow | null;
  /** The staff member's own active mail connections, when Composio is set up on this server. */
  mailboxes: readonly MailboxRow[];
};

/** Null: nothing to show (Vo can't draft here and nothing is waiting). */
export function leadVoView(input: LeadVoInput): LeadVoData | null {
  const can = input.settings.enabled && input.settings.reply_drafts && input.settings.read_client_messages && input.agentReady;
  if (!can && !input.draft) return null;
  const reply = replyGranted(input.consents);
  const marketing = marketingGranted(input.consents);
  const wire: VoCrmWire = { "data-org": input.organizationId, "data-lead": input.lead.id };
  let blocked: LeadVoData["blocked"] = null;
  if (input.lead.convertedMatterId) blocked = { title: "This lead is now a client", text: "Write to them from the matter’s Messages tab." };
  else if (!reply) blocked = { title: "No consent to contact", text: "Vo won’t draft a follow-up until this person agrees to be contacted about their enquiry. Record their answer with Edit lead." };
  else if (!input.lead.email && !input.lead.phone) blocked = { title: "No way to reach them", text: "Add an email or phone number with Edit lead first." };
  const draft = input.draft
    ? draftView(input.draft, { "data-org": input.organizationId, "data-draft": input.draft.id }, {
        marketing:
          input.draft.marketing_consent === false
            ? "Drafted without marketing consent: kept to their enquiry, no promotional content."
            : "Drafted with marketing consent: still about their enquiry, no offers or prices.",
        mailbox: input.lead.email
          ? input.mailboxes
              .filter((row) => row.status === "active" && row.toolkit in MAILBOX_LABEL)
              .map((row) => ({ toolkit: row.toolkit as "gmail" | "outlook", label: `Save to my ${MAILBOX_LABEL[row.toolkit]} drafts` }))
          : [],
        save: { label: "Mark as sent", hint: "After you’ve sent it yourself: the text is kept as a note on this lead." },
      })
    : null;
  return {
    intro: "Vo drafts a follow-up from this lead’s enquiry and notes. You edit it and send it yourself (by email or phone); Vo never sends anything.",
    consent: marketing
      ? "Contact consent given. Marketing consent given: the draft stays about their enquiry, with no offers or prices."
      : reply
        ? "Contact consent given. No marketing consent: Vo keeps the draft to their enquiry, with no promotional content."
        : "No consent to contact recorded.",
    blocked,
    action: can && !blocked && !draft ? { ...wire, "data-vo-crm": "lead-draft" } : null,
    draft,
  };
}

export type CallVoInput = {
  organizationId: string;
  booking: { id: string; locationKind: string; status: string; startsAt: string; isSample: boolean };
  /** The call took place in Casevoya (a video session started). */
  callStarted: boolean;
  /** Where the summary is kept: the linked lead, else the consultation's matter. */
  target: { lead: string | null; matter: string | null };
  settings: VoSettings;
  agentReady: boolean;
  draft: VoCrmDraftRow | null;
  now: number;
};

export function callVoView(input: CallVoInput): CallNotesData | null {
  if (input.booking.locationKind !== "video") return null;
  const can = input.settings.enabled && input.settings.staff_answers && input.agentReady;
  if (!can && !input.draft) return null;
  // Before the call there is nothing to summarise yet.
  if (!input.draft && Date.parse(input.booking.startsAt) > input.now) return null;
  const keptOn = input.target.lead ? `the lead ${input.target.lead}` : input.target.matter ? `the matter ${input.target.matter}` : null;
  let blocked: CallNotesData["blocked"] = null;
  if (input.booking.status !== "completed" && !(input.booking.status === "confirmed" && input.callStarted)) {
    blocked = { title: "After the call", text: "Vo summarises notes once the call has taken place in Casevoya, or once you mark the consultation attended." };
  } else if (!keptOn) {
    blocked = { title: "Nowhere to keep a summary yet", text: "Link this consultation to a lead (or a matter) first." };
  }
  const draft = input.draft
    ? draftView(input.draft, { "data-org": input.organizationId, "data-draft": input.draft.id }, {
        save: { label: input.target.lead ? "Save to the lead’s notes" : "Save to the matter’s notes", hint: `Kept as a staff note on ${keptOn ?? "the file"}. Clients never see it.` },
      })
    : null;
  return {
    intro: `Casevoya doesn’t record calls. Paste or upload your own notes and Vo drafts a summary for ${keptOn ?? "the file"}. Your pasted notes aren’t stored; only the summary you save is kept.`,
    blocked,
    form: can && !blocked && !draft ? { "data-org": input.organizationId, "data-booking": input.booking.id, "data-vo-crm": "call-draft" } : null,
    max: MAX_CALL_NOTES,
    draft,
  };
}
