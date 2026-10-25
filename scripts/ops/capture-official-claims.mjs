#!/usr/bin/env node
// SRC-01 / SRC-02: captures official IRCC, canada.ca and Justice Laws content for the Source review workbench.
//
// Usage:
//   node scripts/ops/capture-official-claims.mjs [--dir src/modules/content-governance] [--dry-run] [--partial]
//
// For each page a claim needs it fetches the page once (https only, official federal hosts; Node
// fetch with a Chrome User-Agent and 2.5 s between requests, the approach www.canada.ca answers),
// hashes it (SHA-256, see "Hash" below), records the retrieval time and HTTP status, and reads the
// dates the page prints ("Date modified", from `<time property="dateModified">` or canada.ca's
// `<gcds-date-modified>`; Justice Laws "current to" and "last amended on"). Each claim in CLAIMS is
// then read from its page:
//   - `fee`: a row of IRCC's fee list (section anchor + the row's name, amount as printed);
//   - `law`: the opening provision of a Justice Laws section;
//   - `form`: a canada.ca form page's download link and its "Last updated" badge (with the page's
//     "new version" notice when it has one);
//   - `edition`: the form PDF's edition, e.g. "IMM 5476 (11-2025) E" (see "PDF editions");
//   - `checklist`: one numbered item of a document checklist PDF (IMM 5483), word for word;
//   - `section`: a canada.ca program page section, from its heading to the next heading of the same
//     level (or to `untilId`), as published.
// A claim whose page, row, section or item isn't found is left out and reported; nothing is guessed
// or filled in from memory. Processing times are deliberately not captured: staff enter them.
//
// Output: two files of DRAFT claims, written only when every claim of that file was read (or with
// --partial), so a run from a machine that can't reach www.canada.ca keeps the committed captures:
//   - captured-claims.json: IRCC fee list and Justice Laws IRPR/IRPA;
//   - captured-canada-ca.json: canada.ca forms and their PDF editions, the IMM 5483 checklist and
//     program pages.
// Nothing is approved: staff add a claim from them in Templates > Source review > Add claim,
// Casevoya fetches the page again on the server, and a licensed reviewer resolves applicability and
// approves it with a step-up.
//
// Hash: canada.ca's Akamai CDN injects a per-request mPulse/boomerang script into every HTML
// response, so the raw bytes never hash the same twice. The hash is taken over the page with that
// script removed (`hashableBytes` in claim-capture.ts, the same code the server's Add claim fetch
// uses); a page without it, and every PDF, is hashed as received. `sha256Of` says which.
//
// PDF editions: needs poppler's `pdftotext` and `pdfinfo`, and python3 with pypdf for dynamic (XFA)
// forms, through scripts/ops/xfa-text.py (it prints the text an XFA form draws and its version
// fields; read-only). `editionSource` says where the edition was read: "printed text (pdftotext)",
// "XFA template drawn text (formNum)", or "XFA template metadata, not a drawn stamp" (the form's own
// version field; its footer stamp is composed by the form's script when it opens). Without those
// tools the PDF claims are left out and captured-canada-ca.json is kept as it is.
//
// Needs Node 22.18+ (imports TypeScript helpers by type stripping). No secrets.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { federalHost, hashableBytes, lawSectionText, readPageDates, textOf } from "../../src/modules/content-governance/claim-capture.ts";
import { parseIrccFeeList } from "../../src/modules/billing/ircc-fee-list.ts";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";
const DELAY_MS = 2500;

const IRCC = "Immigration, Refugees and Citizenship Canada";
const JUSTICE = "Justice Laws (Department of Justice Canada)";
const FEES = "https://ircc.canada.ca/english/information/fees/fees.asp";
const IRPR = "https://laws-lois.justice.gc.ca/eng/regulations/SOR-2002-227/FullText.html";
const IRPA = "https://laws-lois.justice.gc.ca/eng/acts/I-2.5/FullText.html";
const FORMS = "https://www.canada.ca/en/immigration-refugees-citizenship/services/application/application-forms-guides/";
const SERVICES = "https://www.canada.ca/en/immigration-refugees-citizenship/services/";

export const OUTPUTS = { official: "captured-claims.json", canada: "captured-canada-ca.json" };

// Pages with a fixed title; any other page's title is read from it (a PDF's from its form page).
export const PAGES = [
  { url: FEES, publisher: IRCC, title: "Citizenship and immigration application fees: Fee list" },
  { url: IRPR, publisher: JUSTICE, title: "Immigration and Refugee Protection Regulations (SOR/2002-227)" },
  { url: IRPA, publisher: JUSTICE, title: "Immigration and Refugee Protection Act (S.C. 2001, c. 27)" },
];

/** "imm5476" -> "IMM 5476". */
const formNumber = (id) => id.replace(/^([a-z]+)/, (letters) => `${letters.toUpperCase()} `);

/** A form's two claims: its page's download badge, and the edition printed on (or stored in) its PDF. */
function form(id, program, namedInRepo, category = "form") {
  const base = { out: "canada", category, program, namedInRepo, page: `${FORMS}${id}.html`, formNumber: formNumber(id) };
  return [
    { key: `CA.FORM.${id.toUpperCase()}`, ...base, form: true },
    { key: `CA.FORM.${id.toUpperCase()}.EDITION`, ...base, edition: true },
  ];
}

/** One numbered item of the IMM 5483 checklist PDF ("Forms list" or "Documents list"). */
function checklistItem(list, n) {
  return {
    key: `CA.CHECKLIST.IMM5483.${list === "Forms list" ? "FORM" : "DOC"}_${String(n).padStart(2, "0")}`,
    out: "canada",
    category: "checklist",
    program: "study_permit",
    namedInRepo: true,
    page: `${FORMS}imm5483.html`,
    formNumber: "IMM 5483",
    checklist: { list, n },
  };
}

function program(key, programKey, page, id, extra = {}) {
  return { key, out: "canada", category: "program", program: programKey, namedInRepo: false, page: `${SERVICES}${page}`, section: { id }, ...extra };
}

// What to read. `program` is Casevoya's program key; `claim` (fee and law) says what the value is, in
// the page's words. `namedInRepo`: Casevoya already names this form or page (Sheet markup, portal
// notices, DECISIONS); the others are the core forms and eligibility pages of the supported programs.
export const CLAIMS = [
  { key: "CA.FEES.STUDY_PERMIT", program: "study_permit", page: FEES, fee: { anchor: "temporary", name: "Study permit (including extensions) – per person" }, claim: "IRCC fee: Study permit (including extensions) – per person." },
  { key: "CA.FEES.WORK_PERMIT", program: "work_permit", page: FEES, fee: { anchor: "temporary", name: "Work permit (including extensions) – per person" }, claim: "IRCC fee: Work permit (including extensions) – per person." },
  { key: "CA.FEES.OPEN_WORK_PERMIT_HOLDER", program: "work_permit", page: FEES, fee: { anchor: "temporary", name: "Open work permit holder" }, claim: "IRCC fee: Open work permit holder." },
  { key: "CA.FEES.VISITOR_VISA", program: "visitor_visa", page: FEES, fee: { anchor: "temporary", name: "Visitor visa - per person" }, claim: "IRCC fee: Visitor visa - per person." },
  { key: "CA.FEES.VISITOR_EXTENSION", program: "visitor_visa", page: FEES, fee: { anchor: "temporary", name: "Extend your stay as a visitor – per person" }, claim: "IRCC fee: Extend your stay as a visitor – per person." },
  { key: "CA.FEES.ECONOMIC_PR_APPLICATION", program: "express_entry", page: FEES, fee: { anchor: "permanent", group: "Economic immigration (including Express Entry)", name: "Your application" }, claim: "IRCC fee, Economic immigration (including Express Entry): Your application (the page says this amount includes the processing fee and the right of permanent residence fee)." },
  { key: "CA.FEES.SPOUSE_PARTNER_SPONSORSHIP", program: "spousal_sponsorship", page: FEES, fee: { anchor: "sponsorship", group: "Spouse, partner or children (abroad)", name: "Sponsor your spouse or partner" }, claim: "IRCC fee, Spouse, partner or children (abroad): Sponsor your spouse or partner (the page says this amount includes the sponsorship fee, the processing fee and the right of permanent residence fee)." },
  { key: "CA.FEES.RPRF", program: null, page: FEES, fee: { anchor: "permanent", group: "Right of permanent residence fee", name: "Right of permanent residence fee", link: "rprf" }, claim: "IRCC fee: Right of permanent residence fee." },
  { key: "CA.FEES.CITIZENSHIP_ADULT", program: "citizenship", page: FEES, fee: { anchor: "citizenship", name: "Adult (18 and over)" }, claim: "IRCC fee, Citizenship - application fees: Adult (18 and over) (the page says this amount includes the processing fee and the right of citizenship fee)." },
  { key: "CA.FEES.BIOMETRICS_INDIVIDUAL", program: null, page: FEES, fee: { anchor: "other", name: "Biometrics – per individual" }, claim: "IRCC fee: Biometrics – per individual." },
  { key: "CA.IRPR.S216_STUDY_PERMIT", program: "study_permit", page: IRPR, law: "s-216", claim: "IRPR s. 216(1): when an officer shall issue a study permit." },
  { key: "CA.IRPR.S220_FINANCIAL_RESOURCES", program: "study_permit", page: IRPR, law: "s-220", claim: "IRPR s. 220: financial resources required for a study permit." },
  { key: "CA.IRPR.S300_STUDY_PERMIT_FEE", program: "study_permit", page: IRPR, law: "s-300", claim: "IRPR s. 300(1): the fee payable for processing an application for a study permit." },
  { key: "CA.IRPR.S200_WORK_PERMIT", program: "work_permit", page: IRPR, law: "s-200", claim: "IRPR s. 200(1): when an officer shall issue a work permit." },
  { key: "CA.IRPR.S299_WORK_PERMIT_FEE", program: "work_permit", page: IRPR, law: "s-299", claim: "IRPR s. 299(1): the fee payable for processing an application for a work permit." },
  { key: "CA.IRPR.S179_TEMPORARY_RESIDENT_VISA", program: "visitor_visa", page: IRPR, law: "s-179", claim: "IRPR s. 179: when an officer shall issue a temporary resident visa." },
  { key: "CA.IRPR.S296_TRV_FEE", program: "visitor_visa", page: IRPR, law: "s-296", claim: "IRPR s. 296(1): the fee payable for processing an application for a temporary resident visa." },
  { key: "CA.IRPR.S303_RPRF", program: null, page: IRPR, law: "s-303", noValue: true, claim: "IRPR s. 303(1): the fee payable for the acquisition of permanent resident status (indexed under s. 303(1.1); the current amount is on IRCC's fee list)." },
  { key: "CA.IRPA.S11_VISA_BEFORE_ENTRY", program: null, page: IRPA, law: "s-11", claim: "IRPA s. 11(1): a foreign national must apply for a visa or other document before entering Canada." },
  { key: "CA.IRPA.S30_WORK_STUDY_AUTHORIZATION", program: null, page: IRPA, law: "s-30", claim: "IRPA s. 30(1): a foreign national may not work or study in Canada unless authorized." },

  // canada.ca forms: the form page's "Last updated" badge and the PDF's edition.
  ...form("imm5476", null, true),
  ...form("imm5406", "spousal_sponsorship", true),
  ...form("imm1344", "spousal_sponsorship", true),
  ...form("imm5532", "spousal_sponsorship", true),
  // IMM 5483 document checklist: its form page, PDF edition and the 16 numbered items, word for word.
  ...form("imm5483", "study_permit", true, "checklist"),
  ...[1, 2, 3, 4, 5, 6].map((n) => checklistItem("Forms list", n)),
  ...[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((n) => checklistItem("Documents list", n)),
  ...form("imm1294", "study_permit", false),
  ...form("imm5709", "study_permit", false),
  ...form("imm1295", "work_permit", false),
  ...form("imm5710", "work_permit", false),
  ...form("imm5257", "visitor_visa", false),
  ...form("imm5708", "visitor_visa", false),
  ...form("imm0008", null, false),
  ...form("imm5669", null, false),
  ...form("cit0002", "citizenship", false),

  // canada.ca program pages: one section each, as published.
  program("CA.PROGRAM.STUDY_PERMIT.ELIGIBILITY", "study_permit", "study-canada/study-permit/eligibility.html", "s1"),
  program("CA.PROGRAM.WORK_PERMIT.TYPES", "work_permit", "work-canada.html", "type", { note: "work-canada/permit.html (and permit/temporary*.html) redirect here" }),
  program("CA.PROGRAM.VISITOR_VISA.WHO_CAN_GET", "visitor_visa", "visit-canada/eligibility.html", "who"),
  program("CA.PROGRAM.EXPRESS_ENTRY.PROGRAMS", "express_entry", "immigrate-canada/express-entry/who-can-apply.html", "programs"),
  program("CA.PROGRAM.EXPRESS_ENTRY.PROOF_FUNDS_WHO", "express_entry", "immigrate-canada/express-entry/documents/proof-funds.html", "who", { namedInRepo: true }),
  program("CA.PROGRAM.EXPRESS_ENTRY.PROOF_FUNDS_AMOUNT", "express_entry", "immigrate-canada/express-entry/documents/proof-funds.html", "how-much", { namedInRepo: true }),
  program("CA.PROGRAM.SPOUSAL.WHO_CAN_SPONSOR", "spousal_sponsorship", "immigrate-canada/family-sponsorship/spouse-partner-children/eligibility.html", "who-can-sponsor"),
  program("CA.PROGRAM.SPOUSAL.WHO_CANT_SPONSOR", "spousal_sponsorship", "immigrate-canada/family-sponsorship/spouse-partner-children/eligibility.html", "who-cant-sponsor"),
  program("CA.PROGRAM.CITIZENSHIP.ADULT_ELIGIBILITY", "citizenship", "canadian-citizenship/adult-minor/who.html", "eligibility-adults"),
  program("CA.PROGRAM.CITIZENSHIP.PHYSICAL_PRESENCE", "citizenship", "canadian-citizenship/adult-minor/who.html", "time"),
  program("CA.PROGRAM.REPRESENTATIVE.AUTHORIZED", null, "immigration-citizenship-representative/choose/authorized.html", "wb-cont", {
    namedInRepo: true,
    section: {
      id: "wb-cont",
      untilId: "law-societies",
      startText: "You can check if a person",
      name: "Find out if your representative is authorized (introduction, before “Law societies in each province and territory”)",
    },
  }),
];

const EXCERPT_MAX = 600;

/** The page's words, cut at a word boundary to fit the evidence excerpt (marked with "…"). */
export function excerpt(text) {
  if (text.length <= EXCERPT_MAX) return text;
  const cut = text.slice(0, EXCERPT_MAX - 1);
  return `${cut.slice(0, Math.max(cut.lastIndexOf(" "), EXCERPT_MAX - 60)).trimEnd()}…`;
}

/** The amount as the fee list prints it: "1,590.00". */
function printed(cents) {
  return (cents / 100).toLocaleString("en-CA", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function money(cents) {
  return `$${printed(cents)} CAD`;
}

/** Reads a fee or law claim from its page's HTML. `{ missing }` (with the reason) when the page doesn't have it. */
export function readClaim(spec, html) {
  if (spec.fee) {
    const rows = parseIrccFeeList(html).filter(
      (row) => row.anchor === spec.fee.anchor && row.name.startsWith(spec.fee.name) && (!spec.fee.group || row.group === spec.fee.group),
    );
    const row = rows.find((candidate) => candidate.name === spec.fee.name) ?? rows[0];
    if (!row) return { missing: `no fee row "${spec.fee.name}" under #${spec.fee.anchor}` };
    const value = money(row.amount_cents);
    return {
      sourceUrl: `${spec.page}#${spec.fee.link ?? spec.fee.anchor}`,
      section: [row.section, row.group, row.name].filter(Boolean).join(" > ").slice(0, 300),
      value,
      excerpt: excerpt(`${row.group ? `${row.group}: ` : ""}${row.name}: ${printed(row.amount_cents)} ($CAN)`),
    };
  }
  const text = lawSectionText(html, spec.law);
  if (!text) return { missing: `no section ${spec.law}` };
  // A fee the section states, unless the claim says the section's amount is indexed (s. 303).
  const amount = spec.noValue ? null : (/A fee of (\$[0-9,]+)/.exec(text)?.[1] ?? null);
  return {
    sourceUrl: `${spec.page}#${spec.law}`,
    section: `Section ${spec.law.slice(2)}`,
    value: amount ? `${amount} (as written in the section)` : null,
    excerpt: excerpt(text),
  };
}

/** The page's main heading (canada.ca: `<h1 id="wb-cont">`). */
function pageHeading(html) {
  return textOf(/<h1[^>]*id=["']wb-cont["'][^>]*>([\s\S]*?)<\/h1>/i.exec(html)?.[1] ?? "");
}

/**
 * A canada.ca form page: the PDF link in its download block and the "Last updated" badge under it,
 * with the "new version of this form" notice when the page shows one. The block has no anchor of its
 * own, so the source is the page's heading (#wb-cont) with the section named.
 */
export function readFormPage(spec, html) {
  const title = pageHeading(html);
  const link = /<a href="([^"]+\.pdf)"[^>]*>([\s\S]*?)<\/a>\s*<div[^>]*>\s*<span class="badge">([^<]*)<\/span>/i.exec(html);
  if (!title || !link) return { missing: "no download link with a “Last updated” badge" };
  const pdfUrl = new URL(link[1], spec.page).href;
  const linkText = textOf(link[2]);
  const badge = textOf(link[3]);
  const heading = /Download the checklist/.test(html) ? "Download the checklist" : "Download the form";
  const alert = /<h1[^>]*id=["']wb-cont["'][\s\S]*?<\/h1>[\s\S]{0,800}?<div class="alert alert-warning">([\s\S]*?)<\/div>/i.exec(html)?.[1];
  const versionNotice = alert && /version/i.test(alert) ? textOf(alert) : null;
  return {
    title,
    pdfUrl,
    claim: `IRCC form page for ${title}: the downloadable form is “${linkText}”, marked “${badge}”.`,
    sourceUrl: `${spec.page}#wb-cont`,
    section: `${title} > ${heading}`.slice(0, 300),
    value: badge,
    excerpt: excerpt([versionNotice, `${heading}: ${linkText} ${badge}`].filter(Boolean).join(" ")),
  };
}

/**
 * The edition of a form PDF. `pdf.raw` is pdftotext's text; `pdf.xfa` what xfa-text.py printed for
 * a dynamic (XFA) form: its drawn text, then "@variables.<name>=<value>" / "@desc.<name>=<value>".
 */
export function readEdition(spec, pdf) {
  const code = spec.formNumber;
  const text = `${pdf.raw}\n${pdf.xfa ?? ""}`;
  const stamp = new RegExp(`(?:^|\\n)\\s*(${code.replace(" ", " ?")} \\((\\d{2}-\\d{4})\\) E)`).exec(text);
  if (stamp) {
    return {
      claim: `${code} PDF edition as printed on the form: ${stamp[1]}.`,
      section: "Page footer (edition stamp)",
      value: stamp[2],
      excerpt: stamp[1],
      editionSource: pdf.raw.includes(stamp[1]) ? "printed text (pdftotext)" : "XFA template drawn text (formNum)",
    };
  }
  const meta = /^@variables\.(?:Version|VERSION)=(\d{2}-\d{4})$/m.exec(text) ?? /^@desc\.issued=(\d{2}-\d{4})$/m.exec(text);
  if (meta) {
    return {
      claim: `${code} PDF: the form file's own version field reads ${meta[1]} (the footer stamp is composed by the form's script at open time, so it isn't stored as printed text).`,
      section: "Form template metadata (version field)",
      value: meta[1],
      excerpt: meta[0].replace(/^@/, ""),
      editionSource: "XFA template metadata, not a drawn stamp",
    };
  }
  return { missing: "no edition stamp or version field in the PDF" };
}

/** The numbered items of a document checklist PDF (pdftotext -raw), word for word, per list. */
export function readChecklistItems(raw, code) {
  const stamp = new RegExp(`^${code} \\(\\d{2}-\\d{4}\\) E.*$`);
  const skip = (line) => line === "" || line === "Save Reset Form Print Form" || line === "✔" || /^Page \d+ of \d+$/.test(line) || stamp.test(line);
  const items = [];
  let list = null;
  let item = null;
  for (const raw0 of raw.split(/\r?\n/)) {
    const line = raw0.replace(/^\f/, "").trim();
    if (/^FORMS LIST:/.test(line)) {
      list = { name: "Forms list", heading: line };
      item = null;
      continue;
    }
    if (/^DOCUMENTS LIST( \(CONTINUED\))?:/.test(line)) {
      if (!list || list.name !== "Documents list") list = { name: "Documents list", heading: "DOCUMENTS LIST:" };
      item = null;
      continue;
    }
    if (!list) continue;
    if (/^\d{1,2}$/.test(line)) {
      item = { list: list.name, heading: list.heading, n: Number(line), lines: [] };
      items.push(item);
      continue;
    }
    if (skip(line)) continue;
    if (item) item.lines.push(line);
  }
  return items.map((found) => ({ list: found.list, heading: found.heading, n: found.n, text: found.lines.join(" ").replace(/\s+/g, " ").trim() }));
}

/** HTML of a section: from the element with `id` to the next heading of the same or a higher level (or to `untilId`). */
export function sectionHtml(html, id, untilId) {
  const at = html.search(new RegExp(`id=["']${id}["']`));
  if (at < 0) return null;
  const start = html.lastIndexOf("<", at);
  const tag = /^<(h[1-6])/i.exec(html.slice(start))?.[1]?.toLowerCase();
  const rest = html.slice(start + 1);
  let end = -1;
  if (untilId) {
    const until = rest.search(new RegExp(`id=["']${untilId}["']`));
    end = until < 0 ? -1 : rest.lastIndexOf("<", until);
  } else if (tag) {
    end = rest.search(new RegExp(`<h[1-${tag[1]}][\\s>]`, "i"));
  }
  let chunk = `<${end < 0 ? rest.slice(0, 30_000) : rest.slice(0, end)}`;
  const main = chunk.indexOf("</main>");
  if (main >= 0) chunk = chunk.slice(0, main);
  // Not shown to readers (comments), or not part of the section (the page's date and details footer).
  return chunk
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<gcds-date-modified\b[\s\S]*?<\/gcds-date-modified>/gi, " ")
    .replace(/<section[^>]*class="[^"]*pagedetails[\s\S]*$/i, " ");
}

/** A program page section as published: its heading and full text (`sectionText`), and the excerpt. */
export function readProgramSection(spec, html) {
  const { id, untilId, startText, name } = spec.section;
  const chunk = sectionHtml(html, id, untilId);
  if (!chunk) return { missing: `no #${id}` };
  let text = textOf(chunk);
  if (startText) {
    const at = text.indexOf(startText);
    if (at < 0) return { missing: "start text not found" };
    text = text.slice(at);
  }
  const title = pageHeading(html);
  const heading = name ?? textOf(new RegExp(`<h[1-6][^>]*id=["']${id}["'][^>]*>([\\s\\S]*?)</h[1-6]>`, "i").exec(html)?.[1] ?? id);
  return {
    title,
    claim: `IRCC program page “${title}”, section “${heading}”, as published.`,
    sourceUrl: `${spec.page}#${id}`,
    section: `${title} > ${heading}`.slice(0, 300),
    value: null,
    excerpt: excerpt(text),
    sectionText: text,
  };
}

/** pdftotext's text of a PDF, plus what xfa-text.py reads from a dynamic (XFA) form. Throws without the tools. */
function pdfText(bytes) {
  const dir = mkdtempSync(path.join(os.tmpdir(), "capture-pdf-"));
  try {
    const file = path.join(dir, "form.pdf");
    writeFileSync(file, bytes);
    const raw = execFileSync("pdftotext", ["-raw", file, "-"], { maxBuffer: 64 * 1024 * 1024 }).toString("utf8");
    const xfa = /^Form:\s+XFA/m.test(execFileSync("pdfinfo", [file]).toString("utf8"));
    return {
      raw,
      xfa: xfa ? execFileSync("python3", ["-I", path.join(HERE, "xfa-text.py"), file], { maxBuffer: 64 * 1024 * 1024 }).toString("utf8") : null,
      kind: xfa ? "XFA (edition read from the form template)" : "static (pdftotext)",
    };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function printedDates(dates, retrievedAt) {
  return {
    published: "Unknown",
    modified: dates.modifiedOn ?? "Unknown",
    lastAmended: dates.lastAmendedOn ?? "Unknown",
    effective: "Unknown",
    currentTo: dates.currentTo ?? "Unknown",
    retrieved: retrievedAt,
    reviewed: "Unknown",
  };
}

/** Fetches each page once, `delayMs` apart, and keeps what the claims need from it. */
function pageFetcher(fetcher, now, delayMs) {
  const pages = new Map();
  let fetched = 0;
  return {
    pages,
    async get(url) {
      if (pages.has(url)) return pages.get(url);
      if (fetched > 0 && delayMs > 0) await sleep(delayMs);
      fetched += 1;
      const pdf = url.endsWith(".pdf");
      let page;
      try {
        const response = await fetcher(url, { redirect: "follow", signal: AbortSignal.timeout(60_000), headers: { "user-agent": UA, accept: pdf ? "application/pdf" : "text/html" } });
        const bytes = Buffer.from(await response.arrayBuffer());
        const finalUrl = (response.url || url).split("#")[0];
        if (!response.ok || bytes.length === 0 || !federalHost(finalUrl)) throw new Error(`answered ${response.status}${finalUrl !== url ? ` from ${finalUrl}` : ""}`);
        const contentType = response.headers.get("content-type");
        const isPdf = (contentType ?? "").includes("pdf");
        const retrievedAt = now().toISOString();
        const hashed = hashableBytes(new Uint8Array(bytes), contentType);
        const html = isPdf ? "" : bytes.toString("utf8");
        const dates = isPdf ? { modifiedOn: null, lastAmendedOn: null, currentTo: null } : readPageDates(html);
        const fixed = PAGES.find((candidate) => candidate.url === url);
        page = {
          meta: {
            url,
            publisher: fixed?.publisher ?? IRCC,
            title: fixed?.title ?? (isPdf ? null : textOf(/<title>([\s\S]*?)<\/title>/i.exec(html)?.[1] ?? "") || null),
            finalUrl,
            httpStatus: response.status,
            contentType,
            bytes: bytes.length,
            retrievedAt,
            sha256: createHash("sha256").update(hashed.bytes).digest("hex"),
            sha256Of: hashed.basis,
            ...dates,
            printedDates: printedDates(dates, retrievedAt),
          },
          html,
          bytes: isPdf ? bytes : null,
        };
      } catch (error) {
        page = { error: error instanceof Error ? error.message : String(error) };
      }
      pages.set(url, page);
      return page;
    },
  };
}

/** Reads one claim, fetching what it needs. The claim, or `{ missing }` with the reason. */
async function captureClaim(spec, fetchPage, pdfReader) {
  const page = await fetchPage.get(spec.page);
  if (page.error) return { missing: `${spec.page} ${page.error}` };
  if (page.meta.finalUrl !== spec.page) return { missing: `${spec.page} redirected to ${page.meta.finalUrl}` };
  const base = { key: spec.key, ...(spec.category ? { category: spec.category, namedInRepo: spec.namedInRepo } : {}), program: spec.program, jurisdiction: "CA" };
  if (spec.fee || spec.law) {
    const read = readClaim(spec, page.html);
    return "missing" in read ? read : { ...base, claim: spec.claim, page: spec.page, ...read };
  }
  if (spec.section) {
    const read = readProgramSection(spec, page.html);
    return "missing" in read ? read : { ...base, page: spec.page, formNumber: null, ...read, ...(spec.note ? { note: spec.note } : {}) };
  }
  const formPage = readFormPage(spec, page.html);
  if ("missing" in formPage) return formPage;
  if (spec.form) {
    const { title, pdfUrl, ...read } = formPage;
    return { ...base, page: spec.page, title, formNumber: spec.formNumber, ...read, pdfUrl };
  }
  // The edition and the checklist items come from the form's PDF.
  const pdf = await fetchPage.get(formPage.pdfUrl);
  if (pdf.error) return { missing: `${formPage.pdfUrl} ${pdf.error}` };
  pdf.meta.title ??= `${formPage.title} (PDF)`;
  if (!pdf.text) {
    try {
      pdf.text = pdfReader(pdf.bytes);
      pdf.meta.pdfKind = pdf.text.kind;
    } catch (error) {
      pdf.text = { error: `needs pdftotext/pdfinfo and python3 with pypdf (${error instanceof Error ? error.message : String(error)})` };
    }
  }
  if (pdf.text.error) return { missing: pdf.text.error };
  const pdfBase = { ...base, page: formPage.pdfUrl, title: formPage.title, formNumber: spec.formNumber, sourceUrl: formPage.pdfUrl };
  const edition = readEdition(spec, pdf.text);
  if (spec.edition) return "missing" in edition ? edition : { ...pdfBase, ...edition };
  const item = readChecklistItems(pdf.text.raw, spec.formNumber).find((found) => found.list === spec.checklist.list && found.n === spec.checklist.n);
  if (!item || !item.text) return { missing: `no ${spec.checklist.list} item ${spec.checklist.n}` };
  return {
    ...pdfBase,
    claim: `${spec.formNumber} (${"missing" in edition ? "Unknown" : edition.value}), ${item.list} item ${item.n}: ${item.text.split(/ Note:/)[0]}`,
    section: `${item.list} > item ${item.n}`,
    value: null,
    excerpt: excerpt(item.text),
    checklistHeading: item.heading,
  };
}

export async function capture({ fetcher = fetch, now = () => new Date(), log = console.error, delayMs = DELAY_MS, pdfReader = pdfText } = {}) {
  const fetchPage = pageFetcher(fetcher, now, delayMs);
  const results = Object.fromEntries(Object.keys(OUTPUTS).map((out) => [out, { claims: [], pages: new Set(), missing: [] }]));
  for (const spec of CLAIMS) {
    const result = results[spec.out ?? "official"];
    const read = await captureClaim(spec, fetchPage, pdfReader);
    if ("missing" in read) {
      log(`Left out ${spec.key}: ${read.missing}`);
      result.missing.push(spec.key);
      continue;
    }
    result.claims.push(read);
    result.pages.add(read.page);
  }
  // A checklist item the PDF has that CLAIMS doesn't list: say so, so it is added on purpose.
  for (const [url, page] of fetchPage.pages) {
    if (!page.text?.raw || !url.includes("/imm5483")) continue;
    for (const item of readChecklistItems(page.text.raw, "IMM 5483")) {
      if (!CLAIMS.some((spec) => spec.checklist?.list === item.list && spec.checklist.n === item.n)) log(`Not in CLAIMS: IMM 5483 ${item.list} item ${item.n}`);
    }
  }
  const capturedAt = now().toISOString();
  return Object.fromEntries(
    Object.entries(results).map(([out, result]) => [
      out,
      {
        complete: result.missing.length === 0,
        missing: result.missing,
        data: {
          capturedAt,
          pages: [...result.pages].map((url) => fetchPage.pages.get(url).meta),
          claims: result.claims,
        },
      },
    ]),
  );
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isMain) {
  const args = process.argv.slice(2);
  const dirAt = args.indexOf("--dir");
  const root = path.resolve(HERE, "..", "..");
  const dir = dirAt >= 0 ? path.resolve(args[dirAt + 1]) : path.join(root, "src", "modules", "content-governance");
  const results = await capture();
  for (const [out, result] of Object.entries(results)) {
    const file = path.join(dir, OUTPUTS[out]);
    const wanted = CLAIMS.filter((spec) => (spec.out ?? "official") === out).length;
    console.log(`${OUTPUTS[out]}: ${result.data.claims.length} of ${wanted} claims from ${result.data.pages.length} pages.`);
    for (const page of result.data.pages) {
      console.log(`  ${page.url} ${page.sha256} (${page.sha256Of}) modified ${page.modifiedOn ?? "Unknown"} current to ${page.currentTo ?? "Unknown"} last amended ${page.lastAmendedOn ?? "Unknown"}`);
    }
    if (args.includes("--dry-run")) continue;
    if (!result.complete && !args.includes("--partial")) {
      console.log(`  Kept ${path.relative(root, file)} as it is: ${result.missing.length} claims weren't read (--partial writes what was).`);
      continue;
    }
    writeFileSync(file, `${JSON.stringify(result.data, null, 2)}\n`);
    console.log(`  Wrote ${path.relative(root, file)}`);
  }
}
