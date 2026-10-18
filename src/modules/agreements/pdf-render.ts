/**
 * Renders the sealed agreement PDF and its completion certificate with pdf-lib (pure
 * JavaScript, no native code, no file system: runs in Node and on Cloudflare Workers).
 *
 * Fonts are the PDF standard Helvetica/Courier families (WinAnsi), so nothing is embedded but
 * an optional firm logo. Text goes through pdfSafeText first; see pdf-text.ts.
 *
 * Rendering refuses to run when the canonical text does not hash to the envelope's content
 * SHA-256: the PDF can only show the exact text that was signed.
 */
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFImage, type PDFPage, type RGB } from "pdf-lib";
import { formatInZone, formatMoney, formatUtc, paragraphs, pdfSafeText, wrapText } from "@/modules/agreements/pdf-text";
import { agreementTerms, sha256Hex, type SealSource, type SealSigner } from "@/modules/agreements/seal-source";

/** Stored on signature_envelopes.sealed_renderer. Change it when the layout changes. */
export const SEAL_RENDERER = "casevoya-layout-1";

export const FOOTER_NOTICE = "In-house electronic signature. Not a government form signature.";

const PAGE_WIDTH = 612;
const PAGE_HEIGHT = 792;
const MARGIN_X = 56;
const MARGIN_TOP = 56;
const MARGIN_BOTTOM = 72;
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN_X * 2;

const INK = rgb(0.11, 0.12, 0.15);
const MUTED = rgb(0.38, 0.4, 0.45);
const HAIRLINE = rgb(0.82, 0.83, 0.86);
const PANEL = rgb(0.965, 0.968, 0.975);
const DEFAULT_ACCENT = rgb(0.13, 0.22, 0.4);

const KIND_LABEL: Record<string, string> = {
  quote: "Quote",
  consultation: "Consultation agreement",
  service: "Service agreement",
  amendment: "Amendment",
  consent: "Consent",
};

const ROLE_LABEL: Record<string, string> = {
  client: "Client",
  consultant: "Consultant (for the firm)",
  sponsor: "Sponsor",
  dependant: "Dependant",
  guardian: "Guardian",
  firm: "Firm representative",
};

const EVENT_LABEL: Record<string, string> = {
  sent: "Sent for signature",
  signed: "Signed",
  declined: "Declined",
  voided: "Voided",
  expired: "Expired",
  completed: "Completed",
  superseded: "Superseded",
  replayed: "Replayed request",
};

export function kindLabel(kind: string): string {
  return KIND_LABEL[kind] ?? "Agreement";
}

export function roleLabel(role: string): string {
  return ROLE_LABEL[role] ?? role;
}

export type FirmLogo = { bytes: Uint8Array; type: "image/png" | "image/jpeg" };

type Fonts = { regular: PDFFont; bold: PDFFont; italic: PDFFont; mono: PDFFont };

type Style = { font?: keyof Fonts; size?: number; color?: RGB; lineGap?: number; indent?: number; width?: number };

function accentColor(hex: string | null): RGB {
  if (!hex || !/^#[0-9A-Fa-f]{6}$/.test(hex)) return DEFAULT_ACCENT;
  const value = Number.parseInt(hex.slice(1), 16);
  const r = (value >> 16) / 255;
  const g = ((value >> 8) & 0xff) / 255;
  const b = (value & 0xff) / 255;
  // Too light to read as a rule on white: fall back.
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.75 ? DEFAULT_ACCENT : rgb(r, g, b);
}

/** A top-to-bottom flow of text across as many pages as it needs. */
class Flow {
  readonly pages: PDFPage[] = [];
  page!: PDFPage;
  y = 0;

  constructor(
    readonly doc: PDFDocument,
    readonly fonts: Fonts,
    readonly accent: RGB,
    private readonly runningHeader: string,
  ) {
    this.newPage();
  }

  newPage() {
    this.page = this.doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
    this.pages.push(this.page);
    this.y = PAGE_HEIGHT - MARGIN_TOP;
    if (this.pages.length > 1) {
      const text = this.fit(pdfSafeText(this.runningHeader), this.fonts.regular, 8, CONTENT_WIDTH);
      this.page.drawText(text, { x: MARGIN_X, y: this.y, size: 8, font: this.fonts.regular, color: MUTED });
      this.y -= 8;
      this.page.drawLine({
        start: { x: MARGIN_X, y: this.y },
        end: { x: PAGE_WIDTH - MARGIN_X, y: this.y },
        thickness: 0.5,
        color: HAIRLINE,
      });
      this.y -= 18;
    }
  }

  ensure(height: number) {
    if (this.y - height < MARGIN_BOTTOM) this.newPage();
  }

  space(points: number) {
    this.y -= points;
  }

  fit(text: string, font: PDFFont, size: number, width: number): string {
    if (font.widthOfTextAtSize(text, size) <= width) return text;
    let out = text;
    while (out.length > 1 && font.widthOfTextAtSize(`${out}…`, size) > width) out = out.slice(0, -1);
    return `${out}…`;
  }

  /** Wrapped lines of one logical line, measured in the given style. */
  lines(text: string, style: Style = {}): string[] {
    const font = this.fonts[style.font ?? "regular"];
    const size = style.size ?? 10;
    const width = (style.width ?? CONTENT_WIDTH) - (style.indent ?? 0);
    return wrapText(pdfSafeText(text), width, (value) => font.widthOfTextAtSize(value, size));
  }

  /** Draws text, wrapping and breaking pages line by line. */
  text(text: string, style: Style = {}, x = MARGIN_X) {
    const font = this.fonts[style.font ?? "regular"];
    const size = style.size ?? 10;
    const leading = size * 1.38 + (style.lineGap ?? 0);
    for (const line of this.lines(text, style)) {
      this.ensure(leading);
      this.y -= size;
      this.page.drawText(line, { x: x + (style.indent ?? 0), y: this.y, size, font, color: style.color ?? INK });
      this.y -= leading - size;
    }
  }

  /** A paragraph block: blank-line separated paragraphs, line breaks kept, bullets indented. */
  prose(value: string | null | undefined, style: Style = {}) {
    for (const block of paragraphs(value)) {
      for (const raw of block) {
        const bullet = /^\s*(?:[-*•]|\d+[.)])\s+/.exec(raw);
        const heading = /^\s*#{1,6}\s+(.*)$/.exec(raw);
        if (heading) {
          this.ensure(30);
          this.space(4);
          this.text(heading[1], { ...style, font: "bold", size: 10.5 });
        } else if (bullet) {
          const marker = bullet[0].trim();
          const label = /^[-*]$/.test(marker) ? "•" : marker;
          const size = style.size ?? 10;
          const lines = this.lines(raw.slice(bullet[0].length), { ...style, indent: 16 });
          const leading = size * 1.38;
          lines.forEach((line, index) => {
            this.ensure(leading);
            this.y -= size;
            if (index === 0) {
              this.page.drawText(pdfSafeText(label), { x: MARGIN_X + 4, y: this.y, size, font: this.fonts.regular, color: INK });
            }
            this.page.drawText(line, { x: MARGIN_X + 16, y: this.y, size, font: this.fonts[style.font ?? "regular"], color: style.color ?? INK });
            this.y -= leading - size;
          });
        } else {
          this.text(raw, style);
        }
      }
      this.space(6);
    }
  }

  heading(text: string) {
    this.ensure(48);
    this.space(10);
    this.y -= 11;
    this.page.drawText(pdfSafeText(text).toUpperCase(), {
      x: MARGIN_X,
      y: this.y,
      size: 9,
      font: this.fonts.bold,
      color: this.accent,
    });
    this.y -= 5;
    this.page.drawLine({
      start: { x: MARGIN_X, y: this.y },
      end: { x: PAGE_WIDTH - MARGIN_X, y: this.y },
      thickness: 0.6,
      color: HAIRLINE,
    });
    this.y -= 9;
  }

  /** Label / value rows; the value wraps in its own column. */
  rows(items: Array<[string, string, (keyof Fonts)?]>, labelWidth = 128) {
    for (const [label, value, font] of items) {
      const valueStyle: Style = { font: font ?? "regular", size: font === "mono" ? 8.5 : 9.5, width: CONTENT_WIDTH - labelWidth };
      const lines = this.lines(value, valueStyle);
      const size = valueStyle.size ?? 9.5;
      const leading = size * 1.4;
      this.ensure(leading * Math.min(lines.length, 3));
      lines.forEach((line, index) => {
        this.ensure(leading);
        this.y -= size;
        if (index === 0) {
          this.page.drawText(pdfSafeText(label), { x: MARGIN_X, y: this.y, size: 8.5, font: this.fonts.regular, color: MUTED });
        }
        this.page.drawText(line, { x: MARGIN_X + labelWidth, y: this.y, size, font: this.fonts[valueStyle.font ?? "regular"], color: INK });
        this.y -= leading - size;
      });
      this.space(2);
    }
  }

  /** A shaded card that is kept on one page. Lines are measured first. */
  card(entries: Array<{ text: string; style?: Style }>) {
    const pad = 10;
    const width = CONTENT_WIDTH - pad * 2 - 4;
    const measured = entries.map((entry) => {
      const style = { ...entry.style, width };
      const size = style.size ?? 9.5;
      return { style, size, leading: size * 1.38, lines: this.lines(entry.text, style) };
    });
    const height = measured.reduce((sum, item) => sum + item.leading * item.lines.length, 0) + pad * 2;
    this.ensure(height + 8);
    const top = this.y;
    this.page.drawRectangle({
      x: MARGIN_X,
      y: top - height,
      width: CONTENT_WIDTH,
      height,
      color: PANEL,
      borderColor: HAIRLINE,
      borderWidth: 0.6,
    });
    this.page.drawRectangle({ x: MARGIN_X, y: top - height, width: 2.5, height, color: this.accent });
    this.y = top - pad;
    for (const item of measured) {
      for (const line of item.lines) {
        this.y -= item.size;
        this.page.drawText(line, {
          x: MARGIN_X + pad + 4,
          y: this.y,
          size: item.size,
          font: this.fonts[item.style.font ?? "regular"],
          color: item.style.color ?? INK,
        });
        this.y -= item.leading - item.size;
      }
    }
    this.y = top - height - 8;
  }

  /** A simple table with wrapped cells; the header repeats on a new page. */
  table(columns: Array<{ label: string; width: number; font?: keyof Fonts }>, rows: string[][]) {
    const size = 8;
    const leading = size * 1.35;
    const drawHeader = () => {
      this.ensure(leading * 3);
      this.y -= size;
      let x = MARGIN_X;
      for (const column of columns) {
        this.page.drawText(pdfSafeText(column.label), { x, y: this.y, size, font: this.fonts.bold, color: MUTED });
        x += column.width;
      }
      this.y -= 4;
      this.page.drawLine({ start: { x: MARGIN_X, y: this.y }, end: { x: PAGE_WIDTH - MARGIN_X, y: this.y }, thickness: 0.5, color: HAIRLINE });
      this.y -= 4;
    };
    drawHeader();
    for (const row of rows) {
      const cells = columns.map((column, index) => {
        const font = this.fonts[column.font ?? "regular"];
        return wrapText(pdfSafeText(row[index] ?? ""), column.width - 8, (value) => font.widthOfTextAtSize(value, size));
      });
      const height = Math.max(...cells.map((cell) => cell.length)) * leading + 4;
      if (this.y - height < MARGIN_BOTTOM) {
        this.newPage();
        drawHeader();
      }
      const top = this.y;
      let x = MARGIN_X;
      cells.forEach((cell, index) => {
        let y = top;
        for (const line of cell) {
          y -= size;
          this.page.drawText(line, { x, y, size, font: this.fonts[columns[index].font ?? "regular"], color: INK });
          y -= leading - size;
        }
        x += columns[index].width;
      });
      this.y = top - height;
      this.page.drawLine({ start: { x: MARGIN_X, y: this.y + 2 }, end: { x: PAGE_WIDTH - MARGIN_X, y: this.y + 2 }, thickness: 0.3, color: HAIRLINE });
    }
  }

  /** Footer on every page: the notice, the content hash and "Page n of N". */
  footers(contentSha256: string, extra?: string) {
    const total = this.pages.length;
    this.pages.forEach((page, index) => {
      const base = MARGIN_BOTTOM - 30;
      page.drawLine({ start: { x: MARGIN_X, y: base + 22 }, end: { x: PAGE_WIDTH - MARGIN_X, y: base + 22 }, thickness: 0.5, color: HAIRLINE });
      page.drawText(FOOTER_NOTICE, { x: MARGIN_X, y: base + 11, size: 7.5, font: this.fonts.regular, color: MUTED });
      const pageLabel = `Page ${index + 1} of ${total}`;
      const pageWidth = this.fonts.regular.widthOfTextAtSize(pageLabel, 7.5);
      page.drawText(pageLabel, { x: PAGE_WIDTH - MARGIN_X - pageWidth, y: base + 11, size: 7.5, font: this.fonts.regular, color: MUTED });
      page.drawText(`Content SHA-256 ${contentSha256}`, { x: MARGIN_X, y: base, size: 6.5, font: this.fonts.mono, color: MUTED });
      if (extra) {
        const text = this.fit(pdfSafeText(extra), this.fonts.regular, 6.8, 180);
        const width = this.fonts.regular.widthOfTextAtSize(text, 6.8);
        page.drawText(text, { x: PAGE_WIDTH - MARGIN_X - width, y: base, size: 6.8, font: this.fonts.regular, color: MUTED });
      }
    });
  }
}

async function newDocument(source: SealSource, title: string, subject: string) {
  const doc = await PDFDocument.create({ updateMetadata: false });
  const when = new Date(source.envelope.completedAt ?? source.envelope.sentAt);
  doc.setTitle(pdfSafeText(title), { showInWindowTitleBar: true });
  doc.setAuthor(pdfSafeText(source.organization.legalName));
  doc.setSubject(subject);
  doc.setCreator("Casevoya in-house electronic signature");
  doc.setProducer(`Casevoya ${SEAL_RENDERER}`);
  doc.setKeywords([`envelope:${source.envelope.id}`, `content-sha256:${source.envelope.contentSha256}`]);
  doc.setLanguage("en-CA");
  doc.setCreationDate(when);
  doc.setModificationDate(when);
  const fonts: Fonts = {
    regular: await doc.embedFont(StandardFonts.Helvetica),
    bold: await doc.embedFont(StandardFonts.HelveticaBold),
    italic: await doc.embedFont(StandardFonts.HelveticaOblique),
    mono: await doc.embedFont(StandardFonts.Courier),
  };
  return { doc, fonts };
}

async function embedLogo(doc: PDFDocument, logo: FirmLogo | null | undefined): Promise<PDFImage | null> {
  if (!logo) return null;
  try {
    return logo.type === "image/png" ? await doc.embedPng(logo.bytes) : await doc.embedJpg(logo.bytes);
  } catch {
    return null;
  }
}

/** The firm block at the top of the first page: logo (if any), names, and a document label. */
function masthead(flow: Flow, source: SealSource, logo: PDFImage | null, label: string) {
  const { page, fonts } = flow;
  const top = PAGE_HEIGHT - MARGIN_TOP;
  let textX = MARGIN_X;
  let blockHeight = 34;
  if (logo) {
    const scale = Math.min(150 / logo.width, 44 / logo.height, 1);
    const width = logo.width * scale;
    const height = logo.height * scale;
    page.drawImage(logo, { x: MARGIN_X, y: top - height, width, height });
    textX = MARGIN_X + width + 14;
    blockHeight = Math.max(blockHeight, height);
  }
  const labelText = pdfSafeText(label).toUpperCase();
  const labelWidth = fonts.bold.widthOfTextAtSize(labelText, 8);
  const nameWidth = PAGE_WIDTH - MARGIN_X - labelWidth - 16 - textX;
  const display = flow.fit(pdfSafeText(source.organization.displayName), fonts.bold, 14, nameWidth);
  page.drawText(display, { x: textX, y: top - 14, size: 14, font: fonts.bold, color: INK });
  if (source.organization.legalName && source.organization.legalName !== source.organization.displayName) {
    const legal = flow.fit(pdfSafeText(source.organization.legalName), fonts.regular, 9, nameWidth);
    page.drawText(legal, { x: textX, y: top - 28, size: 9, font: fonts.regular, color: MUTED });
  }
  page.drawText(labelText, { x: PAGE_WIDTH - MARGIN_X - labelWidth, y: top - 12, size: 8, font: fonts.bold, color: flow.accent });
  flow.y = top - blockHeight - 10;
  page.drawRectangle({ x: MARGIN_X, y: flow.y - 2, width: CONTENT_WIDTH, height: 2, color: flow.accent });
  flow.y -= 22;
}

/** The consultant's licence under their name, when the firm countersigned. */
function licenceLine(signer: SealSigner, size: number) {
  const licence = signer.licence?.trim();
  return licence ? [{ text: `CICC licence ${licence}`, style: { size } }] : [];
}

function signedLine(signer: SealSigner, timezone: string): string {
  if (!signer.signedAt) return `Status: ${signer.status}`;
  return `Signed electronically ${formatInZone(signer.signedAt, timezone)} (${formatUtc(signer.signedAt)})`;
}

async function assertSignedText(source: SealSource) {
  const actual = await sha256Hex(source.version.canonicalBody);
  if (actual !== source.envelope.contentSha256) {
    throw new Error("the agreement text does not match the signed content hash");
  }
}

/** The sealed agreement: firm, parties, scope, fees, terms, signatures, integrity. */
export async function renderAgreementPdf(source: SealSource, logo?: FirmLogo | null): Promise<Uint8Array> {
  await assertSignedText(source);
  const { organization, agreement, version, envelope, matter } = source;
  const tz = organization.timezone;
  const { doc, fonts } = await newDocument(source, agreement.title, `${kindLabel(agreement.kind)}, version ${version.versionNumber}`);
  const image = await embedLogo(doc, logo);
  const accent = accentColor(organization.accent);
  const flow = new Flow(doc, fonts, accent, `${organization.displayName} · ${agreement.title} · Version ${version.versionNumber}`);

  masthead(flow, source, image, "Signed agreement");
  flow.text(agreement.title, { font: "bold", size: 20, lineGap: 2 });
  flow.space(4);
  const subtitle = [kindLabel(agreement.kind), `Version ${version.versionNumber}`, matter.reference ? `Matter ${matter.reference}` : null]
    .filter(Boolean)
    .join("  ·  ");
  flow.text(subtitle, { size: 10, color: MUTED });
  flow.space(10);
  flow.rows([
    ["Matter", [matter.reference, matter.title].filter(Boolean).join(" · ") || "—"],
    ["Sent for signature", formatInZone(envelope.sentAt, tz)],
    ["Fully signed", envelope.completedAt ? `${formatInZone(envelope.completedAt, tz)} (${formatUtc(envelope.completedAt)})` : "—"],
    ["Envelope", envelope.id, "mono"],
    ["Content SHA-256", envelope.contentSha256, "mono"],
  ]);

  flow.heading("Parties");
  const firmName = organization.legalName === organization.displayName
    ? organization.legalName
    : `${organization.legalName} (${organization.displayName})`;
  flow.rows([
    ["Firm", firmName],
    ...source.signers.map((signer): [string, string] => [roleLabel(signer.role), signer.displayName]),
  ]);

  flow.heading("Scope of services");
  flow.prose(version.scopeSummary);
  if (version.exclusions?.trim()) {
    flow.heading("Not included");
    flow.prose(version.exclusions);
  }

  flow.heading("Fees");
  const fee = formatMoney(version.feeCents, version.currency);
  flow.rows([
    ["Professional fee", fee ?? "No professional fee is stated in this agreement."],
    ["Currency", version.currency],
    ...(version.governmentFeeNote?.trim() ? [["Government fees", version.governmentFeeNote] as [string, string]] : []),
  ]);
  if (version.refundPolicy?.trim()) {
    flow.heading("Refund policy");
    flow.prose(version.refundPolicy);
  }
  if (version.comparisonNote?.trim()) {
    flow.heading("Changes from the previous version");
    flow.prose(version.comparisonNote);
  }

  const { terms, exact } = agreementTerms(source);
  flow.heading(exact ? "Terms of the agreement" : "Agreement text");
  flow.prose(terms.trim() ? terms : "—");

  flow.heading("Signatures");
  for (const signer of source.signers) {
    flow.card([
      { text: signer.displayName, style: { font: "bold", size: 11 } },
      { text: `${roleLabel(signer.role)} · Signer ${signer.signingOrder} of ${source.signers.length}`, style: { size: 9, color: MUTED } },
      ...licenceLine(signer, 9),
      { text: signedLine(signer, tz), style: { size: 9.5 } },
      { text: `Electronic signature consent: ${signer.consentVersion ?? "—"}`, style: { size: 8.5, color: MUTED } },
    ]);
  }
  const consents = new Map<string, string>();
  for (const signer of source.signers) {
    if (signer.consentVersion && signer.consentText) consents.set(signer.consentVersion, signer.consentText);
  }
  for (const [consentVersion, text] of consents) {
    flow.space(2);
    flow.text(`Consent ${consentVersion}, accepted by each signer before signing:`, { size: 8.5, color: MUTED });
    flow.text(`“${text}”`, { font: "italic", size: 9 });
  }

  flow.heading("Integrity");
  flow.prose(
    [
      `The content SHA-256 printed on every page is the hash of the canonical text of version ${version.versionNumber}: the agreement kind, title, scope, exclusions, refund policy, professional fee in minor units, currency, government fee note, comparison note and terms, joined by line breaks in that order. The text was locked when it was sent and every signer signed that exact text.`,
      `This PDF was sealed when the last party signed and is stored unchanged by ${organization.legalName.replace(/\.+$/, "")}. Its own SHA-256 is recorded with the envelope and printed on the completion certificate.`,
      "Signed with Casevoya's in-house electronic signature. This is not a signature on a government form and does not by itself authorize representation before a government body.",
    ].join("\n\n"),
    { size: 8.5, color: MUTED },
  );

  flow.footers(envelope.contentSha256, `Envelope ${envelope.id}`);
  return doc.save({ useObjectStreams: false });
}

/** The completion certificate: hashes, signers with evidence, consent, event history. */
export async function renderCertificatePdf(
  source: SealSource,
  sealedSha256: string,
  logo?: FirmLogo | null,
): Promise<Uint8Array> {
  if (!/^[0-9a-f]{64}$/.test(sealedSha256)) throw new Error("sealed PDF hash is malformed");
  await assertSignedText(source);
  const { organization, agreement, version, envelope, matter } = source;
  const tz = organization.timezone;
  const { doc, fonts } = await newDocument(source, `Completion certificate · ${agreement.title}`, "Completion certificate");
  const image = await embedLogo(doc, logo);
  const accent = accentColor(organization.accent);
  const flow = new Flow(doc, fonts, accent, `${organization.displayName} · Completion certificate · Envelope ${envelope.id}`);

  masthead(flow, source, image, "Completion certificate");
  flow.text("Completion certificate", { font: "bold", size: 20, lineGap: 2 });
  flow.space(4);
  flow.text(`${agreement.title} · ${kindLabel(agreement.kind)} · Version ${version.versionNumber}`, { size: 10, color: MUTED });
  flow.space(10);

  flow.heading("Envelope");
  flow.rows([
    ["Envelope ID", envelope.id, "mono"],
    ["Matter", [matter.reference, matter.title].filter(Boolean).join(" · ") || "—"],
    ["Signature method", "In-house electronic signature (Casevoya). No third-party signing service."],
    ["Sent", `${formatInZone(envelope.sentAt, tz)} (${formatUtc(envelope.sentAt)})`],
    ["Completed", envelope.completedAt ? `${formatInZone(envelope.completedAt, tz)} (${formatUtc(envelope.completedAt)})` : "—"],
    ["Firm time zone", tz],
  ]);

  flow.heading("Hashes");
  flow.rows([
    ["Content SHA-256", envelope.contentSha256, "mono"],
    ["Sealed PDF SHA-256", sealedSha256, "mono"],
  ]);
  flow.text(
    "The content hash covers the exact canonical agreement text each signer signed. The sealed PDF hash covers the bytes of the executed agreement PDF issued with this certificate; recompute it with any SHA-256 tool to check the copy you hold.",
    { size: 8.5, color: MUTED },
  );

  flow.heading("Signers");
  for (const signer of source.signers) {
    flow.card([
      { text: `${signer.signingOrder}. ${signer.displayName}`, style: { font: "bold", size: 10.5 } },
      { text: `${roleLabel(signer.role)} · ${signer.status === "signed" ? "Signed" : signer.status}`, style: { size: 9, color: MUTED } },
      ...licenceLine(signer, 9),
      { text: `Signed: ${formatInZone(signer.signedAt, tz)} (${formatUtc(signer.signedAt)})`, style: { size: 9 } },
      { text: `IP address: ${signer.ip ?? "not recorded"}`, style: { size: 9, font: "regular" } },
      { text: `User agent: ${signer.userAgent ?? "not recorded"}`, style: { size: 8, font: "mono" } },
      { text: `Consent: ${signer.consentVersion ?? "—"}`, style: { size: 9 } },
    ]);
  }
  const consents = new Map<string, string>();
  for (const signer of source.signers) {
    if (signer.consentVersion && signer.consentText) consents.set(signer.consentVersion, signer.consentText);
  }
  for (const [consentVersion, text] of consents) {
    flow.text(`Consent text ${consentVersion}:`, { size: 8.5, color: MUTED });
    flow.text(`“${text}”`, { font: "italic", size: 9 });
    flow.space(4);
  }

  flow.heading("Event history");
  const byOrder = new Map(source.signers.map((signer) => [signer.signingOrder, signer]));
  flow.table(
    [
      { label: "Time (UTC)", width: 102 },
      { label: `Time (${tz})`, width: 118 },
      { label: "Event", width: 100 },
      { label: "Signer", width: 108 },
      { label: "IP", width: CONTENT_WIDTH - 428 },
    ],
    source.events.map((event) => {
      const signer = event.signingOrder == null ? null : byOrder.get(event.signingOrder);
      return [
        formatUtc(event.occurredAt),
        formatInZone(event.occurredAt, tz),
        EVENT_LABEL[event.kind] ?? event.kind,
        signer ? `${signer.signingOrder}. ${signer.displayName}` : "—",
        event.ip ?? "—",
      ];
    }),
  );
  flow.space(10);
  flow.text(
    "Events are append-only records kept by the firm's Casevoya workspace. IP address and user agent are as received by the server when each signer signed.",
    { size: 8.5, color: MUTED },
  );

  flow.footers(envelope.contentSha256, `Sealed PDF ${sealedSha256.slice(0, 16)}…`);
  return doc.save({ useObjectStreams: false });
}
