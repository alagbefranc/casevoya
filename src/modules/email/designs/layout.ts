/**
 * The approved Casevoya email shell (Designer export of 18 Oct 2026, html-hosted/*.html), as a
 * renderer. One 600px card on the warm canvas: header, spot illustration, heading, one paragraph,
 * an optional button, footer. Markup, inline styles, spacing, fonts and colours are kept as the
 * Designer wrote them. Pure string code: no fs, no DOM, so it runs on Cloudflare Workers.
 *
 * Every value that reaches the HTML goes through escapeHtml; every link goes through safeUrl and
 * is dropped (with its button) when it is not an absolute http(s) URL without credentials.
 * Images load from the app's own origin (public/assets/email); fonts from casevoya.ca (see FONT_BASE),
 * passed in as `origin`.
 */

import { accentInk } from "@/modules/firm-onboarding/firm-logo";

export const DEFAULT_EMAIL_ORIGIN = "https://app.casevoya.ca";

export type Spot =
  | "agreement"
  | "client-invite"
  | "document-requested"
  | "invoice"
  | "receipt"
  | "reminder"
  | "sign-in-code"
  | "staff-invite"
  | "verify";

/** Platform emails carry the Casevoya header image; firm emails an HTML header with the firm's name. */
/**
 * A firm email's header: the firm's name, and (ORG-01) its logo as a public image link and its
 * colour for the initial tile, when the firm has set them.
 */
export type Brand = { kind: "platform" } | { kind: "firm"; firmName: string; logoUrl?: string | null; accent?: string | null };

export type Cta = { label: string; href: string };

/** What one email says. Plain text everywhere: the renderer escapes it. */
export type EmailCopy = {
  subject: string;
  preheader: string;
  heading: string;
  body: string;
  cta: Cta | null;
  spot: Spot;
  brand: Brand;
  lang?: "en" | "fr";
  /**
   * The body is a person's own words (EX15): its line breaks are kept (as <br> in HTML). Every
   * other design's body is one plain paragraph.
   */
  verbatim?: boolean;
  /**
   * The shell's own words in this email's language (header tagline, footer lines), set by the
   * French builders (localized.ts). Only the text changes; markup and styles stay the Designer's.
   * Absent: the English shell (and, for lang "fr", the earlier hand-drafted French footer).
   */
  shell?: ShellText;
  /**
   * The English header tagline for this template (catalog.ts TAGLINES), in place of the shell's.
   * Ignored when a French shell is set: French keeps its approved shared tagline.
   */
  tagline?: string;
};

/** footerFirm carries {firm_name}. */
export type ShellText = { tagline: string; footerFirm: string; footerPlatform: string };

const SHELL_EN: ShellText = {
  tagline: "Your immigration file",
  footerFirm: "Sent by {firm_name} via Casevoya",
  footerPlatform: "Case management for immigration consultants · casevoya.ca",
};

function shellFor(copy: EmailCopy): ShellText {
  if (copy.shell) return copy.shell;
  return copy.lang === "fr" ? { ...SHELL_EN, footerFirm: "Envoyé par {firm_name} au moyen de Casevoya" } : SHELL_EN;
}

function firmLine(shell: ShellText, firmName: string): string {
  return shell.footerFirm.replace("{firm_name}", () => firmName);
}

export type RenderedEmail = { subject: string; preheader: string; html: string; text: string };

const MAX_URL_LENGTH = 1000;

export function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

/** An absolute http(s) URL with no user or password, normalized; otherwise null. */
export function safeUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const text = value.trim();
  if (!text || text.length > MAX_URL_LENGTH) return null;
  try {
    const url = new URL(text);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    if (url.username || url.password) return null;
    return url.href;
  } catch {
    return null;
  }
}

/** The origin of an http(s) URL (no path), or the production app. */
export function emailOrigin(value: unknown): string {
  const url = safeUrl(value);
  return url ? new URL(url).origin : DEFAULT_EMAIL_ORIGIN;
}

/** An absolute link to a fixed app path on the given origin, or null. */
export function appLink(origin: string, path: string): string | null {
  if (!path.startsWith("/") || path.startsWith("//")) return null;
  try {
    return safeUrl(new URL(path, emailOrigin(origin)).href);
  } catch {
    return null;
  }
}

/** Collapses whitespace and control characters so a merge value stays one plain line. */
export function cleanText(value: unknown, max = 120): string {
  if (typeof value !== "string") return "";
  return value.replace(/[\u0000-\u001f\u007f\s]+/g, " ").trim().slice(0, max).trim();
}

function asset(origin: string, name: string): string {
  return `${emailOrigin(origin)}/assets/email/${name}`;
}

function img(origin: string, name: string, attrs: string): string {
  const base = name.replace(/\.png$/, "");
  return `<img src="${escapeHtml(asset(origin, `${base}.png`))}" srcset="${escapeHtml(asset(origin, `${base}@2x.png`))} 2x" ${attrs}>`;
}

/** The firm's initial for the logo tile: its first letter or digit, or a neutral mark. */
export function firmInitial(firmName: string): string {
  const match = firmName.match(/[\p{L}\p{N}]/u);
  return match ? match[0].toLocaleUpperCase("en-CA") : "•";
}

const TILE = "#0A4B93";

function hexColour(value: string | null | undefined): string | null {
  return typeof value === "string" && /^#[0-9A-Fa-f]{6}$/.test(value.trim()) ? value.trim() : null;
}

export type FirmHeaderLook = { logoUrl?: string | null; accent?: string | null };

/**
 * header-firm.png has the Designer's example firm baked in, so firm emails draw the same header in
 * HTML: a 52px rounded tile, the firm's display name, the right-aligned tagline, and a 1px rule,
 * 120px tall in all, like the image. The tile is the firm's logo (served from /api/firm/logo, on
 * white) when it has one, otherwise its initial on the firm colour (or the shell's blue).
 */
function firmHeader(firmName: string, tagline: string = SHELL_EN.tagline, look: FirmHeaderLook = {}): string {
  const name = escapeHtml(firmName);
  const initial = escapeHtml(firmInitial(firmName));
  const logo = look.logoUrl ? safeUrl(look.logoUrl) : null;
  const accent = hexColour(look.accent);
  const tile = logo
    ? `<td width="52" height="52" align="center" valign="middle" style="width:52px;height:52px;background:#ffffff;border:1px solid #e6e2db;border-radius:10px;text-align:center"><img src="${escapeHtml(logo)}" width="40" height="40" alt="${name}" style="display:block;margin:0 auto;width:40px;height:40px;object-fit:contain;border:0"></td>`
    : `<td width="52" height="52" align="center" valign="middle" style="width:52px;height:52px;background:${accent ?? TILE};border-radius:10px;color:${accent ? accentInk(accent) : "#ffffff"};font-family:Erode,Georgia,serif;font-size:26px;font-weight:500;line-height:52px;text-align:center">${initial}</td>`;
  return (
    `<tr><td style="padding:34px 40px 0">` +
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>` +
    `<td width="52" valign="middle" style="width:52px"><table role="presentation" cellpadding="0" cellspacing="0"><tr>` +
    tile +
    `</tr></table></td>` +
    `<td valign="middle" style="padding:0 16px 0 12px;font-family:Erode,Georgia,'Times New Roman',serif;font-size:22px;font-weight:500;line-height:1.2;color:#131313">${name}</td>` +
    `<td align="right" valign="middle" style="font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;font-size:12px;line-height:1.3;color:#767676;white-space:nowrap;text-align:right">${escapeHtml(tagline)}</td>` +
    `</tr></table></td></tr>` +
    `<tr><td style="padding:33px 40px 0"><div style="height:1px;line-height:1px;font-size:1px;background:#DDE0E1">&nbsp;</div></td></tr>`
  );
}

/** The firm email header exactly as firm emails draw it, in its own table (Settings > Branding preview). */
export function firmHeaderPreviewHtml(firmName: string, look: FirmHeaderLook & { tagline?: string } = {}): string {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#ffffff;font-family:Erode,Georgia,serif;border-collapse:collapse">${firmHeader(firmName, look.tagline, look)}<tr><td style="height:16px"></td></tr></table>`;
}

function platformHeader(origin: string): string {
  return `<tr><td>${img(origin, "header-platform.png", 'width="600" height="120" alt="Casevoya" style="display:block;width:100%;height:auto;border:0"')}</td></tr>`;
}

function footer(origin: string, brand: Brand, shell: ShellText): string {
  const rule = `<tr><td style="padding:8px 40px 0"><div style="height:1px;line-height:1px;font-size:1px;background:#DDE0E1">&nbsp;</div></td></tr>`;
  const style = `padding:20px 40px 28px;font-family:${SANS};font-size:12px;line-height:1.5;color:${MUTED};text-align:center`;
  if (brand.kind === "firm") {
    const line = firmLine(shell, brand.firmName);
    return `${rule}<tr><td align="center" style="${style}">${img(origin, "via-casevoya.png", 'width="16" height="16" alt="" style="vertical-align:-3px;border:0"')} ${escapeHtml(line)}</td></tr>`;
  }
  return `${rule}<tr><td align="center" style="${style}">${img(origin, "logo.png", 'width="100" height="16" alt="Casevoya" style="display:block;border:0;margin:0 auto 10px"')}${escapeHtml(shell.footerPlatform)}</td></tr>`;
}

/** Hidden inbox preview text, padded so clients do not pull body text into the preview. */
function preheader(text: string): string {
  const pad = "&#847;&zwnj;&nbsp;".repeat(40);
  return `<div style="display:none;font-size:1px;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;mso-hide:all;color:#F1F3F4">${escapeHtml(text)}${pad}</div>`;
}

/**
 * The approved export loads Erode from the marketing site, which serves fonts with
 * Access-Control-Allow-Origin: * (the app origin does not), so mail clients that honour CORS can use it.
 */
const FONT_BASE = "https://casevoya.ca/fonts";

function fontFaces(): string {
  const base = FONT_BASE;
  return (
    `@font-face{font-family:Erode;src:url(${base}/Erode-Regular.woff2) format('woff2');font-weight:400;font-style:normal}` +
    `@font-face{font-family:Erode;src:url(${base}/Erode-Medium.woff2) format('woff2');font-weight:500;font-style:normal}`
  );
}

/** The body paragraph's HTML: escaped, and for a verbatim body each line break kept as <br>. */
function bodyHtml(copy: EmailCopy): string {
  const text = escapeHtml(copy.body);
  return copy.verbatim ? text.replace(/\r\n?|\n/g, "<br>") : text;
}

/**
 * Visual style (Nov 2026): the look of Francis's Figma email set (file sOMPHnfjFmGNrB4D4afNAT),
 * applied to Casevoya's own copy and brand. White card on a grey canvas, bold serif heading, sans
 * body, the button in a mint box with a green border, a centred footer with the Casevoya logo.
 * The Figma fonts (Larken, Faktum) are commercial and not shipped: headings use Erode (hosted on
 * casevoya.ca) then web-safe serifs; body uses web-safe sans.
 */
const CANVAS = "#F1F3F4";
const INK = "#131313";
const BODY_INK = "#202124";
const MUTED = "#767676";
const BUTTON = "#2F124F";
const INFO_BG = "#EFFCF5";
const INFO_BORDER = "#58A55C";
const SERIF = "Erode,Georgia,'Times New Roman',serif";
const SANS = "'Helvetica Neue',Helvetica,Arial,sans-serif";

export function renderHtml(copy: EmailCopy, origin: string = DEFAULT_EMAIL_ORIGIN): string {
  const lang = copy.lang ?? "en";
  const shell = shellFor(copy);
  const href = copy.cta ? safeUrl(copy.cta.href) : null;
  const tagline = copy.shell ? shell.tagline : (copy.tagline ?? shell.tagline);
  const header = copy.brand.kind === "firm" ? firmHeader(copy.brand.firmName, tagline, copy.brand) : platformHeader(origin);
  const button =
    copy.cta && href
      ? `<tr><td style="padding:8px 40px 28px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" bgcolor="${INFO_BG}" style="background:${INFO_BG};border:1px solid ${INFO_BORDER};border-radius:8px"><tr><td style="padding:20px"><table role="presentation" cellpadding="0" cellspacing="0"><tr><td bgcolor="${BUTTON}" style="background:${BUTTON};border-radius:6px"><a href="${escapeHtml(href)}" style="display:inline-block;background:${BUTTON};color:#ffffff;text-decoration:none;font-family:${SANS};font-size:14px;font-weight:600;line-height:20px;padding:12px 20px;border-radius:6px">${escapeHtml(copy.cta.label)}</a></td></tr></table></td></tr></table></td></tr>`
      : "";
  return (
    `<!doctype html>\n` +
    `<html lang="${lang}" xmlns="http://www.w3.org/1999/xhtml"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="X-UA-Compatible" content="IE=edge"><meta name="x-apple-disable-message-reformatting"><meta name="color-scheme" content="light"><meta name="supported-color-schemes" content="light"><title>${escapeHtml(copy.subject)}</title>\n` +
    `<style>${fontFaces()}\n` +
    `body{margin:0;padding:0;background:${CANVAS}}table{border-collapse:collapse}img{border:0;outline:none;text-decoration:none}\n` +
    `@media (max-width:620px){.mail{width:100%!important}}</style></head>\n` +
    `<body style="margin:0;padding:0;background:${CANVAS}">\n` +
    `${preheader(copy.preheader)}\n` +
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" bgcolor="${CANVAS}" style="background:${CANVAS}"><tr><td align="center" style="padding:32px 0">\n` +
    `<table role="presentation" width="600" cellpadding="0" cellspacing="0" class="mail" align="center" bgcolor="#ffffff" style="width:600px;max-width:600px;background:#ffffff;border-radius:4px;overflow:hidden;font-family:${SANS};color:${BODY_INK}">${header}\n` +
    `<tr><td style="padding:28px 40px 4px">${img(origin, `spot-${copy.spot}.png`, 'class="spot" width="56" height="56" alt="" style="display:block;border:0"')}</td></tr>\n` +
    `<tr><td style="padding:12px 40px 0"><h1 style="margin:0;font-family:${SERIF};font-weight:700;font-size:30px;line-height:1.25;color:${INK}">${escapeHtml(copy.heading)}</h1></td></tr>\n` +
    `<tr><td style="padding:14px 40px 16px;font-family:${SANS};font-size:15px;line-height:1.6;color:${BODY_INK}">${bodyHtml(copy)}</td></tr>${button}\n` +
    `${footer(origin, copy.brand, shell)}</table>\n` +
    `</td></tr></table>\n` +
    `</body></html>\n`
  );
}

/** The plain-text alternative: heading, paragraph, the button as "label: url", and the footer line. */
export function renderText(copy: EmailCopy): string {
  const shell = shellFor(copy);
  const href = copy.cta ? safeUrl(copy.cta.href) : null;
  const lines = [copy.heading, "", copy.body];
  if (copy.cta && href) lines.push("", `${copy.cta.label}: ${href}`);
  lines.push("", "--");
  if (copy.brand.kind === "firm") {
    lines.push(firmLine(shell, copy.brand.firmName));
  } else {
    lines.push(`Casevoya · ${shell.footerPlatform}`);
  }
  return `${lines.join("\n")}\n`;
}

export function renderCopy(copy: EmailCopy, origin: string = DEFAULT_EMAIL_ORIGIN): RenderedEmail {
  return { subject: copy.subject, preheader: copy.preheader, html: renderHtml(copy, origin), text: renderText(copy) };
}
