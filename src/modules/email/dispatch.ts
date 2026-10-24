import { renderEmail } from "@/modules/email/templates";
import type { OutboundEmail, SendOutcome } from "@/modules/email/cloudflare";
import { DEFAULT_EMAIL_ORIGIN, emailOrigin } from "@/modules/email/designs/layout";
import { firmLogoPublicPath, ownFirmLogoKey } from "@/modules/firm-onboarding/firm-logo";

export type MailDelivery = {
  delivery_id: string;
  to: string;
  from_address: string;
  from_name: string;
  reply_to_address: string;
  reply_to_name: string;
  template: string;
  context: Record<string, unknown>;
  /** A staff email (template staff_message): the staff member's text and subject, outside the context. */
  body?: string | null;
  subject?: string | null;
  /** Threading headers of a reply (In-Reply-To, References). Anything else is dropped. */
  headers?: Record<string, unknown> | null;
};

export type PreparedMail = {
  action: string;
  event_id?: string;
  messages?: MailDelivery[];
};

export type ClaimedMail = { id: string };

export type DispatchDeps = {
  claim: (worker: string, limit: number) => Promise<ClaimedMail[]>;
  prepare: (eventId: string, worker: string, domain: string, fromAddress: string) => Promise<PreparedMail>;
  send: (email: OutboundEmail) => Promise<SendOutcome>;
  finish: (
    deliveryId: string,
    worker: string,
    outcome: "sent" | "queued" | "bounced" | "suppressed" | "retry" | "terminal_failure",
    providerMessageId: string | null,
    error: string | null,
  ) => Promise<void>;
  /** Opens a sealed invitation link (context.sealed_link) for that invitation. Null when it cannot. */
  openLink?: (sealed: string, invitationId: string) => Promise<string | null>;
  /** Opens a sealed signing code (context.sealed_code) for that code id. Null when it cannot. */
  openCode?: (sealed: string, codeId: string) => Promise<string | null>;
  /**
   * Each delivery's recipient locale ('en-CA' | 'fr-CA'), from public.email_delivery_locales.
   * Optional; a failure or a missing entry means English. Even 'fr-CA' sends French only for a
   * template whose French is approved (designs/french.ts).
   */
  locales?: (deliveryIds: string[]) => Promise<Record<string, string>>;
  /**
   * Each delivery's firm look (ORG-01), from public.email_delivery_brands: the firm id, its stored
   * logo locator and colour. Optional; a failure or a missing entry means the initial tile.
   */
  brands?: (deliveryIds: string[]) => Promise<Record<string, FirmLook>>;
};

export type FirmLook = { organization_id?: unknown; logo_locator?: unknown; accent?: unknown };

async function deliveryBrands(deps: DispatchDeps, messages: MailDelivery[]): Promise<Record<string, FirmLook>> {
  if (!deps.brands || messages.length === 0) return {};
  try {
    return await deps.brands(messages.map((message) => message.delivery_id));
  } catch {
    return {};
  }
}

/**
 * The public logo link (/api/firm/logo/<firm>/<file>) and colour for a firm email's header, only
 * for the firm's own stored logo; the renderer takes nothing else from here.
 */
export function firmLookContext(look: FirmLook | undefined, appOrigin: string | undefined): { firm_logo_url?: string; firm_accent?: string } {
  if (!look) return {};
  const out: { firm_logo_url?: string; firm_accent?: string } = {};
  const organizationId = typeof look.organization_id === "string" ? look.organization_id : "";
  const key = typeof look.logo_locator === "string" ? ownFirmLogoKey(look.logo_locator, organizationId) : null;
  if (key) out.firm_logo_url = `${emailOrigin(appOrigin ?? DEFAULT_EMAIL_ORIGIN)}${firmLogoPublicPath(key)}`;
  if (typeof look.accent === "string" && /^#[0-9A-Fa-f]{6}$/.test(look.accent.trim())) out.firm_accent = look.accent.trim();
  return out;
}

async function recipientLocales(deps: DispatchDeps, messages: MailDelivery[]): Promise<Record<string, string>> {
  if (!deps.locales || messages.length === 0) return {};
  try {
    return await deps.locales(messages.map((message) => message.delivery_id));
  } catch {
    return {};
  }
}

/** The signing code, opened from its sealed form, or null (no key, tampered, or not a code). */
async function openSealedCode(deps: DispatchDeps, sealed: unknown, codeId: unknown): Promise<string | null> {
  if (!deps.openCode || typeof sealed !== "string" || typeof codeId !== "string" || !sealed || !codeId) return null;
  try {
    return await deps.openCode(sealed, codeId);
  } catch {
    return null;
  }
}

/**
 * The invitation link, opened from its sealed form, or null. Any failure (no key, tampered or
 * foreign ciphertext, a throw) means the linkless invitation is sent instead.
 */
async function openSealedLink(deps: DispatchDeps, sealed: unknown, invitationId: unknown): Promise<string | null> {
  if (!deps.openLink || typeof sealed !== "string" || typeof invitationId !== "string" || !sealed || !invitationId) {
    return null;
  }
  try {
    return await deps.openLink(sealed, invitationId);
  } catch {
    return null;
  }
}

/** A Message-ID as a mail header carries it: one <id>, no spaces or angle brackets inside. */
const MESSAGE_ID = /^<[^<>\s]{1,498}>$/;

/** Only the threading headers, and only well-formed. */
export function threadingHeaders(value: unknown): Record<string, string> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  const out: Record<string, string> = {};
  for (const key of ["In-Reply-To", "References"]) {
    const header = record[key];
    if (typeof header === "string" && MESSAGE_ID.test(header.trim())) out[key] = header.trim();
  }
  return Object.keys(out).length ? out : undefined;
}

function includesAddress(list: string[], email: string): boolean {
  const target = email.toLowerCase();
  return list.some((item) => item.toLowerCase() === target);
}

export async function dispatchOutbound(
  deps: DispatchDeps,
  options: { worker: string; limit: number; inboundDomain: string; fromAddress: string; appOrigin?: string },
): Promise<{ processed: number; sent: number }> {
  const events = await deps.claim(options.worker, options.limit);
  let sent = 0;
  for (const event of events) {
    const prepared = await deps.prepare(event.id, options.worker, options.inboundDomain, options.fromAddress);
    if (prepared.action !== "send" || !prepared.messages) continue;
    const locales = await recipientLocales(deps, prepared.messages);
    const brands = await deliveryBrands(deps, prepared.messages);
    for (const message of prepared.messages) {
      // Only a link this worker opened reaches the template; never the sealed form. Every other
      // button (portal, Sheet) is a fixed path the renderer joins to the app origin; nothing from
      // the database is a link.
      const context: Record<string, unknown> = { ...message.context };
      const sealed = context.sealed_link;
      const sealedCode = context.sealed_code;
      delete context.sealed_link;
      delete context.sealed_code;
      delete context.code;
      delete context.link;
      delete context.locale;
      delete context.body;
      delete context.subject;
      delete context.firm_logo_url;
      delete context.firm_accent;
      Object.assign(context, firmLookContext(brands[message.delivery_id], options.appOrigin));
      // A staff email's own words and subject (EX15) come with the message, never the context.
      if (message.template === "staff_message") {
        if (typeof message.body === "string") context.body = message.body;
        if (typeof message.subject === "string") context.subject = message.subject;
      }
      const headers = message.template === "staff_message" ? threadingHeaders(message.headers) : undefined;
      const locale = locales[message.delivery_id];
      if (locale === "fr-CA") context.locale = locale;
      const link = await openSealedLink(deps, sealed, context.invitation_id);
      // A signing code (EX16) reaches the template only after this worker opened it.
      if (message.template === "signing_code") {
        const code = await openSealedCode(deps, sealedCode, context.code_id);
        if (code) context.code = code;
      }
      const rendered = renderEmail(
        { ...context, template: message.template, ...(link ? { link } : {}) },
        { origin: options.appOrigin },
      );
      const outcome = await deps.send({
        to: message.to,
        fromAddress: message.from_address,
        fromName: message.from_name,
        replyToAddress: message.reply_to_address,
        replyToName: message.reply_to_name,
        subject: rendered.subject,
        html: rendered.html,
        text: rendered.text,
        ...(headers ? { headers } : {}),
      });
      if (!outcome.ok) {
        await deps.finish(
          message.delivery_id,
          options.worker,
          outcome.retry ? "retry" : "terminal_failure",
          null,
          outcome.error,
        );
        if (outcome.retry) break;
        continue;
      }
      const kind = includesAddress(outcome.permanentBounces, message.to)
        ? "bounced"
        : includesAddress(outcome.suppressed, message.to)
          ? "suppressed"
          : includesAddress(outcome.queued, message.to)
            ? "queued"
            : "sent";
      await deps.finish(message.delivery_id, options.worker, kind, outcome.messageId, null);
      if (kind === "sent" || kind === "queued") sent += 1;
    }
  }
  return { processed: events.length, sent };
}
