import { createHash } from "node:crypto";
import { deflateSync } from "node:zlib";
import type { FirmLogo } from "@/modules/agreements/pdf-render";
import type { SealSource } from "@/modules/agreements/seal-source";

/** Fictional data only. Mirrors app.agreement_canonical so the content hash checks out. */
export function canonical(fields: {
  kind: string;
  title: string;
  scope: string;
  exclusions: string | null;
  refund: string | null;
  feeCents: string | null;
  currency: string;
  governmentFeeNote: string | null;
  comparison: string | null;
  body: string;
}): string {
  return [
    fields.kind,
    fields.title,
    fields.scope,
    fields.exclusions ?? "",
    fields.refund ?? "",
    fields.feeCents ?? "",
    fields.currency,
    fields.governmentFeeNote ?? "",
    fields.comparison ?? "",
    fields.body,
  ].join("\n");
}

export const SAMPLE_BODY = [
  "# 1. Services",
  "The firm will prepare and submit a spousal sponsorship application (family class, inland) for the client and the sponsor, using the information and documents they provide.",
  "",
  "# 2. Responsibilities of the client and sponsor",
  "- Provide complete, truthful and current information, including any change of address, marital status or employment.",
  "- Provide documents within 14 days of a request. Documents in a language other than English or French need a certified translation.",
  "- Review every form before it is submitted and tell the firm about any error.",
  "",
  "# 3. Communication",
  "The firm will reply to messages in the client portal within two business days. Urgent government requests are answered the same business day when possible.",
  "Les communications peuvent se faire en français ou en anglais, au choix du client. Les décisions importantes seront confirmées par écrit, « noir sur blanc ».",
  "",
  "# 4. Outcome",
  "The firm cannot guarantee the outcome of any application. Decisions are made by Immigration, Refugees and Citizenship Canada (IRCC). Processing times are set by IRCC and can change.",
  "",
  "# 5. Confidentiality",
  "The firm keeps the client's information confidential and uses it only for this matter, except where the law requires disclosure. Records are kept for the period the firm's retention policy states.",
  "",
  "# 6. Termination",
  "Either party may end this agreement by written notice. Fees for work already completed remain payable; any unearned amount is refunded as the refund policy sets out.",
].join("\n");

export function sampleSource(overrides: { body?: string; signers?: number } = {}): SealSource {
  const fields = {
    kind: "service",
    title: "Service agreement — spousal sponsorship",
    scope: "Prepare and submit one inland spousal sponsorship application (sponsor and principal applicant), respond to IRCC requests for information until a final decision, and advise on next steps.",
    exclusions: "Appeals, judicial review, and applications for other family members are not included.\nTranslation and medical examination costs are paid by the client directly.",
    refund: "If the agreement ends before the application is submitted, unearned fees are refunded within 30 days, less work already completed at CAD 150.00 per hour.\nNo refund is due after submission.",
    feeCents: "350000",
    currency: "CAD",
    governmentFeeNote: "IRCC fees (sponsorship, principal applicant processing, right of permanent residence and biometrics) are paid by the client directly to IRCC. Amounts are those on the IRCC fee list on the day of payment.",
    comparison: null,
    body: overrides.body ?? SAMPLE_BODY,
  };
  const text = canonical(fields);
  const hash = createHash("sha256").update(text, "utf8").digest("hex");
  const people = [
    { role: "client", name: "Amélie Dubois-Lefèvre", ip: "203.0.113.24", ua: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Mobile/15E148 Safari/604.1", at: "2026-10-17T15:02:11.482Z" },
    { role: "sponsor", name: "Chinedu Okafor", ip: "198.51.100.77", ua: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36", at: "2026-10-17T21:45:03.019Z" },
    { role: "consultant", name: "Josée Tremblay, RCIC R512345", ip: "192.0.2.15", ua: "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Safari/605.1.15", at: "2026-10-18T13:10:45.731Z" },
  ].slice(0, overrides.signers ?? 3);
  const consent = "I agree to sign this document electronically. This electronic signature is my agreement to the locked text and its SHA-256 hash.";
  const sentAt = "2026-10-17T14:30:00.000Z";
  const completedAt = people[people.length - 1].at;
  return {
    organization: {
      id: "00000000-0000-4000-8000-000000000001",
      displayName: "Maple & Rivière Immigration",
      legalName: "Maple & Rivière Immigration Conseil Inc.",
      timezone: "America/Toronto",
      logoLocator: null,
      accent: "#1F4E79",
    },
    matter: { reference: "MRI-2026-0042", title: "Spousal sponsorship — Dubois-Lefèvre / Okafor" },
    agreement: { id: "00000000-0000-4000-8000-000000000002", kind: fields.kind, title: fields.title },
    version: {
      versionNumber: 1,
      canonicalBody: text,
      scopeSummary: fields.scope,
      exclusions: fields.exclusions,
      refundPolicy: fields.refund,
      feeCents: fields.feeCents,
      currency: fields.currency,
      governmentFeeNote: fields.governmentFeeNote,
      comparisonNote: fields.comparison,
      lockedAt: sentAt,
    },
    envelope: {
      id: "5d1c2b9e-7a43-4f0e-9c61-2e8b4f7a1c03",
      status: "completed",
      contentSha256: hash,
      sentAt,
      completedAt,
      sealed: false,
    },
    signers: people.map((person, index) => ({
      signingOrder: index + 1,
      role: person.role,
      displayName: person.name,
      status: "signed",
      signedAt: person.at,
      ip: person.ip,
      userAgent: person.ua,
      consentVersion: "esign-consent-2026-10-17",
      consentText: consent,
    })),
    events: [
      { kind: "sent", occurredAt: sentAt, signingOrder: null, ip: null, consentVersion: null },
      ...people.map((person, index) => ({
        kind: "signed",
        occurredAt: person.at,
        signingOrder: index + 1,
        ip: person.ip,
        consentVersion: "esign-consent-2026-10-17",
      })),
      { kind: "completed", occurredAt: completedAt, signingOrder: null, ip: null, consentVersion: null },
    ],
  };
}

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Uint8Array): Buffer {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0);
  head.write(type, 4, "ascii");
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([Buffer.from(type, "ascii"), data])), 0);
  return Buffer.concat([head, data, crc]);
}

/** A small fictional logo: a maple-red square and a river-blue wave band. PNG, RGB. */
export function sampleLogo(): FirmLogo {
  const width = 96;
  const height = 96;
  const raw = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y += 1) {
    raw[y * (width * 3 + 1)] = 0;
    for (let x = 0; x < width; x += 1) {
      const wave = 62 + Math.round(8 * Math.sin((x / width) * Math.PI * 2));
      const inSquare = x >= 10 && x < 86 && y >= 10 && y < 86;
      const [r, g, b] = !inSquare ? [255, 255, 255] : y > wave ? [31, 78, 121] : [196, 48, 43];
      const offset = y * (width * 3 + 1) + 1 + x * 3;
      raw[offset] = r;
      raw[offset + 1] = g;
      raw[offset + 2] = b;
    }
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 2;
  const png = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", new Uint8Array(0)),
  ]);
  return { bytes: new Uint8Array(png), type: "image/png" };
}
