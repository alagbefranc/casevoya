/**
 * Pure helpers for the Sheet's Agreements page: the words for each agreement state, the
 * filter-chip tokens, what the New agreement and New template dialogs send, how database
 * refusals read, and where a step-up goes. The database decides every create, approve and send.
 */
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
  if (status === "sent" || status === "partially_signed") flags.push("waiting");
  if (status === "completed") flags.push("executed");
  if (kind === "quote") flags.push("quote");
  if (["declined", "voided", "expired", "superseded"].includes(status)) flags.push("closed");
  return flags;
}

export type AgreementInput = { matterId: string; templateId: string; scope: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function clean(value: string | null | undefined): string {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
}

/** What the New agreement dialog sends, or the first thing to fix. The database checks it again. */
export function readNewAgreement(fields: { matter?: string | null; template?: string | null; scope?: string | null }):
  | { input: AgreementInput }
  | { error: string } {
  const matterId = clean(fields.matter);
  const templateId = clean(fields.template);
  const scope = clean(fields.scope);
  if (!UUID.test(matterId)) return { error: "Choose the matter." };
  if (!UUID.test(templateId)) return { error: "Choose an approved agreement template." };
  if (scope.length < 3) return { error: "Describe the services this agreement covers." };
  if (scope.length > 2000) return { error: "Keep the scope to 2,000 characters." };
  return { input: { matterId, templateId, scope } };
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

/** The applicant signs first, then the sponsor when the matter has one. */
export function signersFor(
  participants: readonly { person_id: string | null; role: string }[],
  names: ReadonlyMap<string, string>,
): { role: "client" | "sponsor"; person_id: string; display_name: string }[] {
  const pick = (role: string) => participants.find((row) => row.role === role && row.person_id && names.get(row.person_id));
  const applicant = pick("applicant");
  const sponsor = pick("sponsor");
  const out: { role: "client" | "sponsor"; person_id: string; display_name: string }[] = [];
  // The applicant is the client; without one there is nobody to send to.
  if (!applicant?.person_id) return out;
  out.push({ role: "client", person_id: applicant.person_id, display_name: names.get(applicant.person_id) as string });
  if (sponsor?.person_id && sponsor.person_id !== applicant.person_id) {
    out.push({ role: "sponsor", person_id: sponsor.person_id, display_name: names.get(sponsor.person_id) as string });
  }
  return out;
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
  if (/signer must be a person on the matter/i.test(message)) return "The signer must be a person on this matter.";
  if (/at least one signer/i.test(message)) return "This matter has no applicant to sign.";
  if (/only a draft/i.test(message)) return "This agreement was already sent.";
  if (/agreement denied/i.test(message)) return "You can’t create agreements on this matter.";
  if (/staff access denied/i.test(message)) {
    return "Your role can’t do that. A licensed consultant approves templates; an owner, consultant or case manager sends agreements.";
  }
  return safeAccessError(message);
}

/** `?dlg=` values that reopen this page's dialogs after a step-up. */
export const AGREEMENT_DIALOG = "agreement";
export const TEMPLATE_DIALOG = "template";

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
