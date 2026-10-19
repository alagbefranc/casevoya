/**
 * WhatsApp message templates and the payloads Casevoya sends through Zernio (pure).
 *
 * Decided by Francis 2026-10-19: no sensitive content in WhatsApp. A notice says only that the
 * firm has something for the client in the secure portal, with the portal link. Its one variable
 * is the firm's display name: never case facts, document names, UCI, amounts, dates or the
 * client's name. assertSafeTemplateParams enforces that before anything leaves the server.
 *
 * Templates are UTILITY (Meta's category for transactional notices) in English ("en"). Meta must
 * approve each one before it can be sent; scripts/ops/zernio-whatsapp.mjs creates them through
 * POST /v1/whatsapp/templates (docs "Templates > Step 1", read 2026-10-19). Meta refuses a body
 * that starts or ends with a variable, so each body opens with "Hello." and ends with the link.
 */

export const TEMPLATE_LANGUAGE = "en";

export type TemplateName = "casevoya_portal_notice" | "casevoya_portal_reminder";

export type TemplateDefinition = {
  name: TemplateName;
  category: "UTILITY";
  language: typeof TEMPLATE_LANGUAGE;
  /** Body text with {{1}} = the firm's display name; {portal} is the portal link at creation. */
  body: string;
  /** What it is used for. */
  use: string;
};

export const WHATSAPP_TEMPLATES: Record<TemplateName, TemplateDefinition> = {
  casevoya_portal_notice: {
    name: "casevoya_portal_notice",
    category: "UTILITY",
    language: TEMPLATE_LANGUAGE,
    body: "Hello. {{1}} has a new item for you in your secure portal. Sign in to see it: {portal}",
    use: "Document requested, invoice issued, payment problem, agreement to sign, new staff message (outside the 24-hour window)",
  },
  casevoya_portal_reminder: {
    name: "casevoya_portal_reminder",
    category: "UTILITY",
    language: TEMPLATE_LANGUAGE,
    body: "Hello. {{1}} has a reminder for you in your secure portal. Sign in to see it: {portal}",
    use: "Deadline reminders, consultation booked, moved or cancelled",
  },
};

/** An example firm name for Meta's reviewers (fictional). */
export const TEMPLATE_EXAMPLE_FIRM = "Northline Immigration";

/** The portal sign-in link the template bodies carry. */
export function portalLink(origin: string): string {
  return `${origin.replace(/\/+$/, "")}/portal`;
}

/** The body as Meta stores it, with the portal link filled in. */
export function templateBody(name: TemplateName, origin: string): string {
  return WHATSAPP_TEMPLATES[name].body.replace("{portal}", portalLink(origin));
}

/** What POST /v1/whatsapp/templates takes for one template (Zernio "Create template"). */
export function templateCreateRequest(name: TemplateName, accountId: string, origin: string) {
  const template = WHATSAPP_TEMPLATES[name];
  return {
    accountId,
    name: template.name,
    category: template.category,
    language: template.language,
    components: [{ type: "body", text: templateBody(name, origin), example: { body_text: [[TEMPLATE_EXAMPLE_FIRM]] } }],
  };
}

/** The outbox template a notice email used decides which WhatsApp template goes. */
export function noticeTemplateFor(emailTemplate: string): TemplateName {
  return ["reminder", "consultation_booked", "consultation_rescheduled", "consultation_cancelled"].includes(emailTemplate)
    ? "casevoya_portal_reminder"
    : "casevoya_portal_notice";
}

export function isTemplateName(value: unknown): value is TemplateName {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(WHATSAPP_TEMPLATES, value);
}

export class SensitiveContentError extends Error {}

/** Longest firm name a template carries (the database trims it to 60 too). */
export const MAX_FIRM_NAME = 60;

/**
 * The no-sensitive-content guard. A template's variables must be exactly the firm's display name,
 * and that name must not look like anything else: no long digit runs (a UCI, an application or
 * invoice number), no money, no email address or link, no line breaks.
 */
export function assertSafeTemplateParams(params: readonly unknown[], firmName: string): void {
  if (params.length !== 1 || params[0] !== firmName) {
    throw new SensitiveContentError("A WhatsApp notice carries the firm name only.");
  }
  const name = firmName;
  if (!name.trim() || name.length > MAX_FIRM_NAME) throw new SensitiveContentError("The firm name is missing or too long.");
  if (/\d{5,}/.test(name.replace(/[\s-]/g, ""))) throw new SensitiveContentError("The firm name looks like a number.");
  if (/[$€£¥]|\b(?:CAD|USD)\b/i.test(name)) throw new SensitiveContentError("The firm name looks like an amount.");
  if (/@|https?:|www\./i.test(name)) throw new SensitiveContentError("The firm name looks like an address or link.");
  if (/[\r\n\t]/.test(name)) throw new SensitiveContentError("The firm name has line breaks.");
}

/** What prepare_whatsapp_delivery hands the worker for one send. */
export type PreparedWhatsApp = {
  delivery_id: string;
  account_id: string;
  /** Digits, country code included, no "+". */
  to: string;
  kind: "template" | "text";
  template_name: string | null;
  template_language: string | null;
  firm_name: string;
  /** A staff reply's own text (kind text only). */
  body: string | null;
  conversation_id: string | null;
  /** Zernio's shared sandbox number (testing): only its locked `sandbox_start` template can go. */
  sandbox?: boolean;
};

/** The sandbox's one template (docs "Sandbox": locked, no variables). */
export const SANDBOX_TEMPLATE = "sandbox_start";

/** POST /v1/inbox/conversations: open (or continue) the conversation with an approved template. */
export function buildTemplateSend(prepared: PreparedWhatsApp) {
  if (!/^[1-9][0-9]{7,14}$/.test(prepared.to)) throw new Error("The recipient is not a phone number.");
  if (prepared.sandbox && prepared.kind === "template" && prepared.template_name === SANDBOX_TEMPLATE) {
    return { accountId: prepared.account_id, participantId: prepared.to, templateName: SANDBOX_TEMPLATE, templateLanguage: TEMPLATE_LANGUAGE, templateParams: [] as string[] };
  }
  if (prepared.kind !== "template" || !isTemplateName(prepared.template_name)) {
    throw new SensitiveContentError("Only an approved Casevoya template can open a WhatsApp conversation.");
  }
  const templateParams = [prepared.firm_name];
  assertSafeTemplateParams(templateParams, prepared.firm_name);
  return {
    accountId: prepared.account_id,
    participantId: prepared.to,
    templateName: prepared.template_name,
    templateLanguage: prepared.template_language ?? TEMPLATE_LANGUAGE,
    templateParams,
  };
}

/** POST /v1/inbox/conversations/{conversationId}/messages: a staff reply inside the 24-hour window. */
export function buildTextReply(prepared: PreparedWhatsApp) {
  if (prepared.kind !== "text" || !prepared.conversation_id) throw new Error("A reply needs an open conversation.");
  const message = String(prepared.body ?? "").trim();
  if (!message || message.length > 4000) throw new Error("A reply needs its text (up to 4,000 characters).");
  return { conversationId: prepared.conversation_id, body: { accountId: prepared.account_id, message } };
}
