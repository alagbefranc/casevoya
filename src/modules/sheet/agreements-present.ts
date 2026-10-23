/**
 * Pure helpers for the Sheet's Agreements page: the words for each agreement state, the
 * filter-chip tokens, what the New agreement and New template dialogs send, how database
 * refusals read, and where a step-up goes. The database decides every create, approve and send.
 */
import type { CountersignDialogData } from "@/components/sheet/designer/agreements";
import type { MatterBadge } from "@/components/sheet/designer/matters";
import { safeAccessError } from "@/lib/auth/step-up";

/** Agreement kinds the Sheet can create from a template and send for signature in one step. */
export const SENDABLE_KINDS = ["service", "consultation", "consent"] as const;
export type SendableKind = (typeof SENDABLE_KINDS)[number];

export const KIND_LABEL: Record<string, string> = {
  service: "Service agreement",
  consultation: "Consultation agreement",
  consent: "Consent",
  quote: "Quote",
  amendment: "Amendment",
};

export function kindLabel(kind: string): string {
  return KIND_LABEL[kind] ?? "Agreement";
}

export function isSendableKind(kind: string): kind is SendableKind {
  return (SENDABLE_KINDS as readonly string[]).includes(kind);
}

/** The Designer's state badges on the All agreements list. */
export function agreementBadge(status: string, kind: string): MatterBadge {
  if (kind === "quote" && (status === "draft" || status === "sent")) {
    return { tone: "gr", label: "Quote", detail: "not an agreement" };
  }
  switch (status) {
    case "draft":
      return { tone: "gr", label: "Draft", detail: "not sent" };
    case "sent":
      return { tone: "rev", label: "Sent" };
    case "partially_signed":
      return { tone: "blue", label: "Partially signed" };
    case "completed":
      return { tone: "ok", label: "Executed" };
    case "accepted":
      return { tone: "ok", label: "Quote accepted" };
    case "declined":
      return { tone: "bad", label: "Declined" };
    case "expired":
      return { tone: "gr", label: "Expired" };
    case "voided":
      return { tone: "gr", label: "Voided" };
    case "superseded":
      return { tone: "gr", label: "Replaced" };
    default:
      return { tone: "gr", label: status.replaceAll("_", " ") };
  }
}

/** Filter-chip tokens ("Waiting", "Executed", "Quotes", "Declined, voided, expired"). */
export function agreementFlags(status: string, kind: string): string[] {
  const flags: string[] = [];
  if ((status === "sent" || status === "partially_signed") && kind !== "quote") flags.push("waiting");
  if (status === "completed") flags.push("executed");
  if (kind === "quote") flags.push("quote");
  if (["declined", "voided", "expired", "superseded"].includes(status)) flags.push("closed");
  return flags;
}

/** The terms an agreement version stores next to its text (public.agreement_versions). */
export type AgreementTerms = {
  scope: string;
  exclusions: string | null;
  refundPolicy: string | null;
  /** Professional fee in integer minor units (cents). Null: the agreement states no professional fee. */
  feeCents: number | null;
  currency: string;
  governmentFeeNote: string | null;
};

export type AgreementInput = AgreementTerms & { matterId: string; templateId: string };

/** The currencies the dialog offers. The database accepts any three-letter code. */
export const AGREEMENT_CURRENCIES = ["CAD", "USD", "EUR", "GBP"] as const;
export const DEFAULT_CURRENCY = "CAD";

/**
 * The government fee note the dialog starts with. It names who pays and where the amounts come
 * from; it never states an amount (Casevoya does not keep a government fee schedule).
 */
export const DEFAULT_GOVERNMENT_FEE_NOTE =
  "Government fees are paid by the client directly to IRCC at the amounts on the IRCC fee list on the day of payment.";

/** The largest professional fee the dialog accepts: 10,000,000.00 in major units. */
const MAX_FEE_CENTS = 1_000_000_000;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function clean(value: string | null | undefined): string {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
}

/** Multi-line text as typed: line breaks kept, trailing spaces and blank edges dropped. Empty is null. */
function paragraphs(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const text = value
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.replace(/[ \t]+$/g, ""))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return text ? text : null;
}

/**
 * A professional fee typed in major units ("1500", "1,500.00", "$1 500.5") as integer minor units.
 * Blank means no fee. String arithmetic only, so 0.1 + 0.2 never creeps in.
 */
export function parseFeeMinor(value: string | null | undefined): { cents: number | null } | { error: string } {
  const text = typeof value === "string" ? value.replace(/[\s$, ]/g, "").replace(/^(CAD|USD|EUR|GBP|€|£)/i, "") : "";
  if (!text) return { cents: null };
  if (text.startsWith("-")) return { error: "A professional fee can’t be negative." };
  const match = /^(\d{0,8})(?:\.(\d{0,2}))?$/.exec(text);
  if (!match || !/\d/.test(text)) return { error: "Enter the professional fee as an amount, like 1,500.00." };
  const whole = Number(match[1] || "0");
  const minor = Number((match[2] ?? "").padEnd(2, "0"));
  const cents = whole * 100 + minor;
  if (cents > MAX_FEE_CENTS) return { error: "That professional fee is too large." };
  return { cents };
}

/** Minor units as the dialog shows them in its fee field ("1500.00"); null is blank. */
export function feeInputValue(cents: number | string | null | undefined): string {
  if (cents == null || cents === "") return "";
  const value = Math.trunc(Number(cents));
  if (!Number.isFinite(value) || value < 0) return "";
  return `${Math.floor(value / 100)}.${String(value % 100).padStart(2, "0")}`;
}

export type NewAgreementFields = {
  matter?: string | null;
  template?: string | null;
  scope?: string | null;
  fee?: string | null;
  currency?: string | null;
  exclusions?: string | null;
  refund?: string | null;
  government?: string | null;
};

/** What the New agreement dialog sends, or the first thing to fix. The database checks it again. */
export function readNewAgreement(fields: NewAgreementFields): { input: AgreementInput } | { error: string } {
  const matterId = clean(fields.matter);
  const templateId = clean(fields.template);
  const scope = clean(fields.scope);
  if (!UUID.test(matterId)) return { error: "Choose the matter." };
  if (!UUID.test(templateId)) return { error: "Choose an approved agreement template." };
  if (scope.length < 3) return { error: "Describe the services this agreement covers." };
  if (scope.length > 2000) return { error: "Keep the scope to 2,000 characters." };
  const fee = parseFeeMinor(fields.fee);
  if ("error" in fee) return { error: fee.error };
  const currency = clean(fields.currency).toUpperCase() || DEFAULT_CURRENCY;
  if (!/^[A-Z]{3}$/.test(currency)) return { error: "Choose the currency." };
  const exclusions = paragraphs(fields.exclusions);
  if (exclusions && exclusions.length > 2000) return { error: "Keep what is not included to 2,000 characters." };
  const refundPolicy = paragraphs(fields.refund);
  if (refundPolicy && refundPolicy.length > 2000) return { error: "Keep the refund policy to 2,000 characters." };
  const governmentFeeNote = paragraphs(fields.government);
  if (governmentFeeNote && governmentFeeNote.length > 500) return { error: "Keep the government fees note to 500 characters." };
  return {
    input: { matterId, templateId, scope, exclusions, refundPolicy, feeCents: fee.cents, currency, governmentFeeNote },
  };
}

/**
 * Whether an unsent draft's version carries exactly these terms. Only then is the draft sent in
 * place of a new one: a different fee, currency, scope or clause makes a new draft.
 */
export function sameTerms(
  version: {
    scope_summary: string;
    exclusions: string | null;
    refund_policy: string | null;
    fee_cents: number | string | null;
    currency: string;
    government_fee_note: string | null;
  },
  terms: AgreementTerms,
): boolean {
  const fee = version.fee_cents == null ? null : String(version.fee_cents);
  return (
    version.scope_summary === terms.scope &&
    (version.exclusions ?? null) === terms.exclusions &&
    (version.refund_policy ?? null) === terms.refundPolicy &&
    fee === (terms.feeCents == null ? null : String(terms.feeCents)) &&
    version.currency === terms.currency &&
    (version.government_fee_note ?? null) === terms.governmentFeeNote
  );
}

/** What a template starts the dialog with: the terms of the firm's last agreement from it. */
export type TemplateDefaults = {
  fee: string;
  currency: string;
  exclusions: string;
  refund: string;
  government: string;
};

export function templateDefaults(
  version: {
    exclusions: string | null;
    refund_policy: string | null;
    fee_cents: number | string | null;
    currency: string | null;
    government_fee_note: string | null;
  } | null | undefined,
): TemplateDefaults {
  return {
    fee: feeInputValue(version?.fee_cents),
    currency: version?.currency && /^[A-Z]{3}$/.test(version.currency) ? version.currency : DEFAULT_CURRENCY,
    exclusions: version?.exclusions ?? "",
    refund: version?.refund_policy ?? "",
    government: version?.government_fee_note || DEFAULT_GOVERNMENT_FEE_NOTE,
  };
}

export type TemplateInput = { kind: SendableKind; name: string; body: string };

/** What the New agreement template dialog sends, or the first thing to fix. */
export function readNewTemplate(fields: { kind?: string | null; name?: string | null; body?: string | null }):
  | { input: TemplateInput }
  | { error: string } {
  const kind = clean(fields.kind);
  const name = clean(fields.name);
  const body = typeof fields.body === "string" ? fields.body.trim() : "";
  if (!isSendableKind(kind)) return { error: "Choose what kind of agreement this is." };
  if (!name) return { error: "Name the template." };
  if (name.length > 200) return { error: "Keep the name to 200 characters." };
  if (!body) return { error: "Add the agreement text." };
  if (body.length > 20000) return { error: "Keep the agreement text to 20,000 characters." };
  return { input: { kind, name, body } };
}

/** Kinds the firm countersigns: the responsible licensed consultant signs last, for the firm. */
export const COUNTERSIGNED_KINDS = ["service", "consultation"] as const;

export function firmCountersigns(kind: string): boolean {
  return (COUNTERSIGNED_KINDS as readonly string[]).includes(kind);
}

export type PersonSigner = { role: "client" | "sponsor"; person_id: string; display_name: string };
export type ConsultantSigner = { role: "consultant"; membership_id: string; display_name: string };
export type AgreementSigner = PersonSigner | ConsultantSigner;

/**
 * The applicant signs first, then the sponsor when the matter has one. Given a countersigner
 * (the matter's responsible licensed consultant), they sign last, for the firm.
 */
export function signersFor(
  participants: readonly { person_id: string | null; role: string }[],
  names: ReadonlyMap<string, string>,
  countersigner?: { membershipId: string; name: string } | null,
): AgreementSigner[] {
  const pick = (role: string) => participants.find((row) => row.role === role && row.person_id && names.get(row.person_id));
  const applicant = pick("applicant");
  const sponsor = pick("sponsor");
  const out: AgreementSigner[] = [];
  // The applicant is the client; without one there is nobody to send to.
  if (!applicant?.person_id) return out;
  out.push({ role: "client", person_id: applicant.person_id, display_name: names.get(applicant.person_id) as string });
  if (sponsor?.person_id && sponsor.person_id !== applicant.person_id) {
    out.push({ role: "sponsor", person_id: sponsor.person_id, display_name: names.get(sponsor.person_id) as string });
  }
  if (countersigner?.membershipId) {
    out.push({ role: "consultant", membership_id: countersigner.membershipId, display_name: countersigner.name.trim() || "Consultant" });
  }
  return out;
}

/**
 * Who countersigns an agreement of this kind on this matter: the responsible consultant, when
 * licensed. `null` when this kind is not countersigned; `{ error }` when it is and nobody can.
 */
export function countersignerFor(
  kind: string,
  consultant: { membershipId: string | null; licensed: boolean; name: string | null } | null,
): { membershipId: string; name: string } | null | { error: string } {
  if (!firmCountersigns(kind)) return null;
  if (!consultant?.membershipId) {
    return { error: "This matter has no responsible consultant to countersign. Assign a licensed consultant to the matter first." };
  }
  if (!consultant.licensed) {
    return { error: "The responsible consultant isn’t licensed, so they can’t countersign. Assign a licensed consultant to the matter first." };
  }
  return { membershipId: consultant.membershipId, name: consultant.name?.trim() || "Consultant" };
}

/** A signer row as the Sheet reads it from public.envelope_signers. */
export type EnvelopeSignerRow = { envelope_id: string; membership_id: string | null; status: string };

/** Whether this staff member is the current signer on the envelope: it is their turn to countersign. */
export function countersignTurn(signers: readonly EnvelopeSignerRow[], envelopeId: string, membershipId: string): boolean {
  return signers.some((row) => row.envelope_id === envelopeId && row.status === "current" && row.membership_id === membershipId);
}

/** The All agreements list's state badge while the signed-in consultant's countersignature is next. */
export const COUNTERSIGN_BADGE: MatterBadge = { tone: "blue", label: "Countersign", detail: "your turn" };

/** `?dlg=countersign&envelope=…` reopens that envelope's sign dialog (after a step-up, or from an email). */
export const COUNTERSIGN_DIALOG = "countersign";

/** The sign dialog's element id for one envelope. */
export function countersignDialogId(envelopeId: string): string {
  return `dlgSign-${envelopeId}`;
}

/** The All agreements page with this envelope's sign dialog open. */
export function countersignHref(envelopeId: string): string {
  return `/sheet/agreements?${new URLSearchParams({ dlg: COUNTERSIGN_DIALOG, envelope: envelopeId })}`;
}

/** The envelope a `?dlg=countersign&envelope=…` URL asks to reopen, or null. */
export function countersignTarget(search: string): string | null {
  const params = new URLSearchParams(search);
  if (params.get("dlg") !== COUNTERSIGN_DIALOG) return null;
  const envelope = params.get("envelope") ?? "";
  return UUID.test(envelope) ? envelope : null;
}

/** What the sign dialog sends, or the first thing to fix. The database checks it again. */
export function readCountersign(fields: { envelopeId?: string | null; consent?: boolean | null }):
  | { input: { envelopeId: string } }
  | { error: string } {
  const envelopeId = clean(fields.envelopeId);
  if (!UUID.test(envelopeId)) return { error: "Choose the agreement to sign." };
  if (fields.consent !== true) return { error: "Confirm that you agree to sign electronically." };
  return { input: { envelopeId } };
}

/** The consent wording when the setting cannot be read: the same text the portal falls back to. */
export const DEFAULT_ESIGN_CONSENT =
  "I agree to sign this document electronically. This electronic signature is my agreement to the locked text and its SHA-256 hash.";

/** The sign dialog for one envelope: what is being signed, and the consent the portal shows. */
export function countersignDialogData(input: {
  organizationId: string;
  envelopeId: string;
  title: string;
  versionNumber: number | null | undefined;
  client: string;
  matter: string;
  contentSha: string | null | undefined;
  signed: number;
  total: number;
  consent: { text: string; version: string };
}): CountersignDialogData {
  const sha = input.contentSha && /^[0-9a-f]{64}$/.test(input.contentSha) ? `${input.contentSha.slice(0, 4)}…${input.contentSha.slice(-4)} (SHA-256)` : "—";
  return {
    organizationId: input.organizationId,
    envelopeId: input.envelopeId,
    dialogId: countersignDialogId(input.envelopeId),
    title: input.title,
    facts: [
      { label: "Client", value: input.client },
      { label: "Matter", value: input.matter },
      { label: "Document", value: input.versionNumber ? `${input.title} v${input.versionNumber}` : input.title },
      { label: "Hash", value: sha },
      { label: "Signed so far", value: `${input.signed} of ${input.total}` },
    ],
    consent: input.consent,
  };
}

/** The configured e-sign consent (product_settings agreements.esign_consent), exactly as the portal shows it. */
export function esignConsent(value: unknown): { text: string; version: string } {
  const record = value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
  return {
    text: typeof record.text === "string" && record.text.trim() ? record.text : DEFAULT_ESIGN_CONSENT,
    version: typeof record.version === "string" && record.version.trim() ? record.version : "esign-consent-2026-10-17",
  };
}

const STEP_UP_ERRORS = new Set([safeAccessError("step-up is required"), safeAccessError("aal2")]);

export function needsStepUp(error: string | null | undefined): boolean {
  return Boolean(error && STEP_UP_ERRORS.has(error));
}

/** User-facing copy for a refused create, approve or send. Never passes a database message through. */
export function agreementStaffError(message: string): string {
  if (/sample mode/i.test(message)) {
    return "This firm is in sample mode, so only sample matters take agreements. Turn sample mode off to send a real client’s agreement.";
  }
  if (/licence blocks/i.test(message)) return "The responsible consultant’s licence blocks new agreements on this matter.";
  if (/approved template is required/i.test(message)) return "Choose an approved template of the same kind.";
  if (/template name and body/i.test(message)) return "Name the template and add its text.";
  if (/agreement template denied/i.test(message)) return "That template can’t be approved. It may already be approved.";
  if (/scope is required/i.test(message)) return "Describe the services this agreement covers.";
  if (/fee cannot be negative/i.test(message)) return "A professional fee can’t be negative.";
  if (/check constraint|violates check/i.test(message)) return "One of the agreement terms is too long or not valid. Check the fee, currency and notes.";
  if (/signer must be a person on the matter/i.test(message)) return "The signer must be a person on this matter.";
  if (/at least one signer/i.test(message)) return "This matter has no applicant to sign.";
  if (/only a draft/i.test(message)) return "This agreement was already sent.";
  if (/consultant signer must be licensed/i.test(message)) {
    return "Only a licensed consultant countersigns. Assign a licensed responsible consultant to the matter.";
  }
  if (/firm signer must be an active staff member/i.test(message)) return "The countersigning consultant must be active staff in this firm.";
  if (/consent/i.test(message)) return "Confirm that you agree to sign electronically.";
  if (/not your turn/i.test(message)) return "Someone else signs before you.";
  if (/identity does not match/i.test(message)) return "This signature is waiting for someone else.";
  if (/envelope expired/i.test(message)) return "This envelope expired. Send a new one.";
  if (/no longer open/i.test(message)) return "This agreement is no longer open for signature.";
  if (/void needs a reason/i.test(message)) return "Say why this envelope is voided.";
  if (/executed envelope cannot be voided/i.test(message)) return "An executed agreement can’t be voided. Send an amendment instead.";
  if (/agreement denied/i.test(message)) return "You can’t create agreements on this matter.";
  if (/staff access denied/i.test(message)) {
    return "Your role can’t do that. A licensed consultant approves templates; an owner, consultant or case manager sends agreements.";
  }
  return safeAccessError(message);
}

/** `?dlg=` values that reopen this page's dialogs after a step-up. */
export const AGREEMENT_DIALOG = "agreement";
export const TEMPLATE_DIALOG = "template";
export const AUTHORITY_DIALOG = "authority";
export const VOID_DIALOG = "void";

/** The Agreements page's tabs, in the Designer's order. */
export const AGREEMENT_TABS = ["list", "quote", "editor", "envelope", "compare", "authority"] as const;
export type AgreementsTabKey = (typeof AGREEMENT_TABS)[number];

export function agreementsTab(raw: string | null | undefined): AgreementsTabKey {
  return (AGREEMENT_TABS as readonly string[]).includes(raw ?? "") ? (raw as AgreementsTabKey) : "list";
}

/** One agreement's own view: its envelope, signers, events and signed copies. */
export function agreementEnvelopeHref(agreementId: string): string {
  return `/sheet/agreements?${new URLSearchParams({ tab: "envelope", view: agreementId })}`;
}

/** The sealed PDF (or completion certificate) of a completed envelope, read through RLS. */
export function agreementPdfHref(envelopeId: string, organizationId: string, which: "executed" | "certificate"): string {
  const params = new URLSearchParams({ organizationId });
  if (which === "certificate") params.set("which", "certificate");
  return `/api/agreements/${envelopeId}/pdf?${params}`;
}

/**
 * The toast after an agreement is sent. A sample matter's people are fictional: nobody is
 * emailed, so the toast never says they are.
 */
export function sentAgreementToast(sample: boolean): { title: string; sub: string } {
  if (sample) {
    return {
      title: "Sample agreement sent for signature",
      sub: "This is a sample matter, so nobody is emailed. Sign it as the sample client in the portal preview, or from the matter.",
    };
  }
  return {
    title: "Agreement sent for signature",
    sub: "The applicant signs in their portal. They get an email that it is ready. When the firm countersigns, the consultant is emailed at their turn.",
  };
}

/** What Void envelope sends, or the first thing to fix. */
export function readVoid(fields: { envelopeId?: string | null; reason?: string | null }): { input: { envelopeId: string; reason: string } } | { error: string } {
  const envelopeId = clean(fields.envelopeId);
  const reason = clean(fields.reason);
  if (!UUID.test(envelopeId)) return { error: "Choose the envelope to void." };
  if (reason.length < 3) return { error: "Say why this envelope is voided. It stays on the record." };
  if (reason.length > 500) return { error: "Keep the reason to 500 characters." };
  return { input: { envelopeId, reason } };
}

/** The Record authority dialog's client choice: which matter and person. */
export function authorityValue(matterId: string, personId: string): string {
  return `${matterId}:${personId}`;
}

export type AuthorityInput = { matterId: string; personId: string; scope: string; evidence: string; effectiveOn: string };

/** What Record representation authority sends, or the first thing to fix. The database checks it again. */
export function readAuthority(fields: { client?: string | null; scope?: string | null; evidence?: string | null; effective?: string | null }):
  | { input: AuthorityInput }
  | { error: string } {
  const [matterId, personId, extra] = clean(fields.client).split(":");
  if (extra !== undefined || !UUID.test(matterId ?? "") || !UUID.test(personId ?? "")) return { error: "Choose the client." };
  const scope = clean(fields.scope);
  if (scope.length < 3) return { error: "Describe what the authority covers, like the application it is for." };
  if (scope.length > 1000) return { error: "Keep the scope to 1,000 characters." };
  const evidence = clean(fields.evidence);
  if (!evidence) return { error: "Say where the signed authority is kept, like the document’s name on the matter." };
  if (evidence.length > 300) return { error: "Keep the evidence to 300 characters." };
  const effectiveOn = clean(fields.effective);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(effectiveOn) || Number.isNaN(Date.parse(`${effectiveOn}T12:00:00Z`))) return { error: "Enter the date the authority takes effect." };
  return { input: { matterId, personId, scope, evidence, effectiveOn } };
}

/** The Representation authority table's state for one row (firm-day dates, YYYY-MM-DD). */
export function authorityBadge(row: { effective_on: string; revoked_at: string | null }, today: string): MatterBadge {
  if (row.revoked_at) return { tone: "gr", label: "Revoked" };
  if (row.effective_on > today) return { tone: "rev", label: "On file", detail: "not in effect yet" };
  return { tone: "ok", label: "On file" };
}

/** A matter with nobody's authority on file, before its submission sign-off. */
export const AUTHORITY_NEEDED: MatterBadge = { tone: "chg", label: "Needed before submission" };

/** Matter stages after which a submission sign-off is no longer ahead. */
const PAST_SUBMISSION = new Set(["submitted", "government_processing", "decision_review", "post_decision", "closed"]);

export function authorityStillNeeded(stage: string): boolean {
  return !PAST_SUBMISSION.has(stage);
}

/** Plain words for a refused authority record. */
export function authorityError(message: string): string {
  if (/scope, evidence, and effective date/i.test(message)) return "Add the scope, where the evidence is kept, and the date it takes effect.";
  if (/representation denied/i.test(message)) return "You can’t record authority for this client on this matter.";
  if (/staff access denied/i.test(message)) return "Only the firm owner or a licensed consultant records representation authority.";
  return safeAccessError(message);
}

/** The step-up screen, coming back to this page with the dialog open again. */
export function agreementStepUpLocation(pathname: string, search: string, dialog: string | null, extra: Record<string, string> = {}): string {
  const params = new URLSearchParams(search);
  if (dialog) params.set("dlg", dialog);
  else params.delete("dlg");
  for (const [key, value] of Object.entries(extra)) {
    if (value) params.set(key, value);
    else params.delete(key);
  }
  const query = params.toString();
  return `/mfa?step=6&next=${encodeURIComponent(`${pathname}${query ? `?${query}` : ""}`)}`;
}

/** The All agreements list for one matter: the search box is filled with the matter's reference. */
export function agreementsHref(reference: string | null | undefined): string {
  const q = clean(reference);
  return q ? `/sheet/agreements?${new URLSearchParams({ q })}` : "/sheet/agreements";
}

/** The New agreement dialog opened for one matter. */
export function newAgreementHref(matterId: string): string {
  return `/sheet/agreements?${new URLSearchParams({ dlg: AGREEMENT_DIALOG, matter: matterId })}`;
}
