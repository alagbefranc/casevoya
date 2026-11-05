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

/** The large hero illustration at the top of the card (public/assets/email/illustrations). */
export type Hero =
  | "invite"
  | "documents"
  | "deadline"
  | "agreement"
  | "payment"
  | "decision"
  | "consultation"
  | "security"
  | "billing"
  | "export";

const HERO_FOR_SPOT: Record<Spot, Hero> = {
  agreement: "agreement",
  "client-invite": "invite",
  "document-requested": "documents",
  invoice: "payment",
  receipt: "payment",
  reminder: "deadline",
  "sign-in-code": "security",
  "staff-invite": "invite",
  verify: "security",
};

/** What one email says. Plain text everywhere: the renderer escapes it. */
export type EmailCopy = {
  subject: string;
  preheader: string;
  heading: string;
  body: string;
  cta: Cta | null;
  spot: Spot;
  /** The hero illustration; defaults from the spot. */
  hero?: Hero;
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

const TILE = "#035CFA"; // Casevoya logo blue (same as BUTTON)

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

/** Hidden inbox preview text, padded so clients do not pull body text into the preview. */
function preheader(text: string): string {
  const pad = "&#847;&zwnj;&nbsp;".repeat(40);
  return `<div style="display:none;font-size:1px;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;mso-hide:all;color:#EDEDED">${escapeHtml(text)}${pad}</div>`;
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
 * Visual style (Nov 2026): the layout of Francis's Figma email set (file sOMPHnfjFmGNrB4D4afNAT,
 * frames 1:2607, 1:7655, 1:10804), applied to Casevoya's own copy and brand. Measurements are the
 * Figma frame (784px card, 702px content, 60px top/bottom, 24px between blocks) scaled to 600px.
 * No header (as in Figma 1:7655): hero illustration, the tagline as a small eyebrow, heading,
 * paragraph, button (no mint box: the payment, reset and reminder frames have none).
 * Footer: rule, brand mark, the five social icons, footer line. The Figma fonts (Larken, Faktum)
 * are commercial and not shipped: headings use Erode (hosted on casevoya.ca) then web-safe serifs.
 */
const CANVAS = "#EDEDED"; // Figma: rgba(0,0,0,0.05) over white
const INK = "#131313"; // Colors/Neutral/900
const MUTED = "#767676";
const BUTTON = "#035CFA"; // Casevoya logo blue (public/assets/brand/casevoya-wordmark.svg)
const RULE = "#DDE0E1"; // Grey Scale/300
const SERIF = "Erode,Georgia,'Times New Roman',serif";
const SANS = "'Helvetica Neue',Helvetica,Arial,sans-serif";

/**
 * Casevoya's public social profiles, in the Figma footer's order. Every icon is always drawn; a
 * network without its own profile URL yet links to the Casevoya site. Setting a profile is a
 * one-line change here. No profile URLs are known yet (Nov 2026).
 */
const SOCIAL_FALLBACK = "https://casevoya.ca";
export const CASEVOYA_SOCIAL_LINKS: ReadonlyArray<{ network: "linkedin" | "x" | "instagram" | "facebook" | "youtube"; label: string; href: string | null }> = [
  { network: "linkedin", label: "LinkedIn", href: null },
  { network: "x", label: "X", href: null },
  { network: "instagram", label: "Instagram", href: null },
  { network: "facebook", label: "Facebook", href: null },
  { network: "youtube", label: "YouTube", href: null },
];

/**
 * Gmail iOS (mobile web) drops align/text-align on rows after a fragile nested footer table and
 * will separate a side-by-side logo+name pair, leaving an orphaned mark. Every footer band is a
 * full-width outer cell with text-align:center wrapping an auto-margined inner table — the usual
 * email-safe centering pattern — so the brand row, social row and "Sent by" row stay centered and
 * on one baseline.
 */
function centerBand(padding: string, inner: string): string {
  return `<tr><td align="center" style="padding:${padding};text-align:center">${inner}</td></tr>`;
}

function centerTable(innerRows: string): string {
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" align="center" style="margin:0 auto;border-collapse:collapse"><tr>${innerRows}</tr></table>`;
}

function socialRow(origin: string): string {
  const cells = CASEVOYA_SOCIAL_LINKS.map((s) => {
    const href = safeUrl(s.href ?? SOCIAL_FALLBACK) ?? SOCIAL_FALLBACK;
    const icon = img(origin, `social-${s.network}.png`, `width="33" height="33" alt="${escapeHtml(s.label)}" style="display:block;border:0;height:33px;width:33px"`);
    return `<td align="center" valign="middle" style="padding:0 6px"><a href="${escapeHtml(href)}" style="text-decoration:none;border:0;display:block;line-height:0">${icon}</a></td>`;
  });
  return `<!--social-->${centerBand("16px 30px 0", centerTable(cells.join("")))}<!--/social-->`;
}

/** The firm's mark for the footer: its logo or initial tile, and its name, on one baseline. */
function firmMark(firmName: string, look: FirmHeaderLook): string {
  const name = escapeHtml(firmName);
  const logo = look.logoUrl ? safeUrl(look.logoUrl) : null;
  const accent = hexColour(look.accent);
  const colour = accent ?? TILE;
  const tile = logo
    ? `<td width="52" height="52" align="center" valign="middle" style="width:52px;height:52px;background:#ffffff;border:1px solid #e6e2db;border-radius:10px;text-align:center"><img src="${escapeHtml(logo)}" width="40" height="40" alt="${name}" style="display:block;margin:0 auto;width:40px;height:40px;object-fit:contain;border:0"></td>`
    : `<td width="52" height="52" align="center" valign="middle" style="width:52px;height:52px;background:${colour};border-radius:10px;color:${accent ? accentInk(accent) : "#ffffff"};font-family:${SERIF};font-size:26px;font-weight:500;line-height:52px;text-align:center">${escapeHtml(firmInitial(firmName))}</td>`;
  // Nested table keeps the coloured tile and the name in one shrink-wrapped unit Gmail cannot split.
  const tileWrap = `<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>${tile}</tr></table>`;
  return centerTable(
    `<td valign="middle" width="52" style="width:52px;padding:0">${tileWrap}</td>` +
      `<td valign="middle" style="padding:0 0 0 12px;font-family:${SERIF};font-size:20px;font-weight:700;line-height:52px;color:${INK};white-space:nowrap;vertical-align:middle">${name}</td>`,
  );
}

/** Small Casevoya mark + "Sent by {firm} via Casevoya", vertically aligned on one baseline. */
function sentByRow(origin: string, firmName: string, shell: ShellText): string {
  const mark = img(origin, "via-casevoya.png", 'width="16" height="16" alt="" style="display:block;border:0;height:16px;width:16px"');
  const label = escapeHtml(firmLine(shell, firmName));
  const inner = centerTable(
    `<td valign="middle" width="16" style="width:16px;padding:0;line-height:16px">${mark}</td>` +
      `<td valign="middle" style="padding:0 0 0 8px;font-family:${SANS};font-size:12px;line-height:16px;color:${MUTED};text-align:left;vertical-align:middle">${label}</td>`,
  );
  return centerBand("16px 30px 0", inner);
}

function footer(origin: string, brand: Brand, shell: ShellText): string {
  const rule = `<tr><td style="padding:24px 30px 0"><div style="height:1px;line-height:1px;font-size:1px;background:${RULE}">&nbsp;</div></td></tr>`;
  if (brand.kind === "firm") {
    return `${rule}${centerBand("24px 30px 0", firmMark(brand.firmName, brand))}${socialRow(origin)}${sentByRow(origin, brand.firmName, shell)}`;
  }
  const wordmark = img(origin, "logo.png", 'width="112" height="18" alt="Casevoya" style="display:block;border:0;height:18px;width:112px"');
  const platform = `<table role="presentation" cellpadding="0" cellspacing="0" border="0" align="center" style="margin:0 auto;border-collapse:collapse"><tr><td align="center" style="font-family:${SANS};font-size:12px;line-height:1.5;color:${MUTED};text-align:center">${escapeHtml(shell.footerPlatform)}</td></tr></table>`;
  return `${rule}${centerBand("24px 30px 0", wordmark)}${socialRow(origin)}${centerBand("16px 30px 0", platform)}`;
}

export function renderHtml(copy: EmailCopy, origin: string = DEFAULT_EMAIL_ORIGIN): string {
  const lang = copy.lang ?? "en";
  const shell = shellFor(copy);
  const href = copy.cta ? safeUrl(copy.cta.href) : null;
  const tagline = copy.shell ? shell.tagline : (copy.tagline ?? shell.tagline);
  const button =
    copy.cta && href
      ? `<tr><td style="padding:24px 30px 0"><table role="presentation" cellpadding="0" cellspacing="0"><tr><td bgcolor="${BUTTON}" style="background:${BUTTON};border-radius:8px"><a href="${escapeHtml(href)}" style="display:inline-block;background:${BUTTON};color:#ffffff;text-decoration:none;font-family:${SANS};font-size:16px;font-weight:400;line-height:20px;padding:16px 40px;border-radius:8px">${escapeHtml(copy.cta.label)}</a></td></tr></table></td></tr>`
      : "";
  const hero = copy.hero ?? HERO_FOR_SPOT[copy.spot];
  const heroRow = `<tr><td align="center" style="padding:48px 30px 8px">${img(origin, `illustrations/${hero}.png`, 'class="hero" width="300" height="200" alt="" style="display:block;margin:0 auto;width:300px;max-width:100%;height:auto;border:0"')}</td></tr>`;
  const eyebrow = `<tr><td style="padding:16px 30px 0;font-family:${SANS};font-size:12px;font-weight:700;letter-spacing:0.06em;text-transform:uppercase;line-height:1.3;color:${MUTED}">${escapeHtml(tagline)}</td></tr>`;
  const info = button;
  return (
    `<!doctype html>\n` +
    `<html lang="${lang}" xmlns="http://www.w3.org/1999/xhtml"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="X-UA-Compatible" content="IE=edge"><meta name="x-apple-disable-message-reformatting"><meta name="color-scheme" content="light"><meta name="supported-color-schemes" content="light"><title>${escapeHtml(copy.subject)}</title>\n` +
    `<style>${fontFaces()}\n` +
    `body{margin:0;padding:0;background:${CANVAS}}table{border-collapse:collapse}img{border:0;outline:none;text-decoration:none}\n` +
    `@media (max-width:620px){.mail{width:100%!important}}</style></head>\n` +
    `<body style="margin:0;padding:0;background:${CANVAS}">\n` +
    `${preheader(copy.preheader)}\n` +
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" bgcolor="${CANVAS}" style="background:${CANVAS}"><tr><td align="center" style="padding:16px 0">\n` +
    `<table role="presentation" width="600" cellpadding="0" cellspacing="0" class="mail" align="center" bgcolor="#ffffff" style="width:600px;max-width:600px;background:#ffffff;font-family:${SANS};color:${INK}">\n` +
    `${heroRow}${eyebrow}\n` +
    `<tr><td style="padding:8px 30px 0"><h1 style="margin:0;font-family:${SERIF};font-weight:700;font-size:32px;line-height:48px;color:${INK}">${escapeHtml(copy.heading)}</h1></td></tr>\n` +
    `<tr><td style="padding:20px 30px 0;font-family:${SANS};font-size:16px;line-height:1.5;color:${INK}">${bodyHtml(copy)}</td></tr>\n` +
    `${info}\n` +
    `${footer(origin, copy.brand, shell)}<tr><td style="height:60px;line-height:60px;font-size:1px">&nbsp;</td></tr></table>\n` +
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
