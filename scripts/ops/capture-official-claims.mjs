#!/usr/bin/env node
// SRC-01 / SRC-02: captures official IRCC and Justice Laws content for the Source review workbench.
//
// Usage:
//   node scripts/ops/capture-official-claims.mjs [--out src/modules/content-governance/captured-claims.json] [--dry-run]
//
// For each page in PAGES it fetches the page once (https only, official federal hosts), hashes the
// bytes (SHA-256), records the retrieval time and HTTP status, and reads the dates the page prints
// ("Date modified"; Justice Laws "current to" and "last amended on"). Each claim in CLAIMS is then
// read from that page: a fee row from IRCC's fee list (section anchor + the row's name, amount as
// printed) or the opening provision of a Justice Laws section. A claim whose row or section isn't
// found is left out and reported; nothing is guessed or filled in from memory.
//
// The output is a list of DRAFT claims. Nothing is approved: staff add a claim from it in
// Templates > Source review > Add claim, Casevoya fetches the page again on the server, and a
// licensed reviewer resolves applicability and approves it with a step-up.
//
// Pages on www.canada.ca (forms and guides, program pages, processing times) are not in PAGES:
// they did not answer from the capture machine on 2026-10-25. Add them here when they can be read.
// Needs Node 22.18+ (imports TypeScript helpers by type stripping). No secrets.
import { createHash } from "node:crypto";
import { writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { lawSectionText, readPageDates } from "../../src/modules/content-governance/claim-capture.ts";
import { parseIrccFeeList } from "../../src/modules/billing/ircc-fee-list.ts";

const FEES = "https://ircc.canada.ca/english/information/fees/fees.asp";
const IRPR = "https://laws-lois.justice.gc.ca/eng/regulations/SOR-2002-227/FullText.html";
const IRPA = "https://laws-lois.justice.gc.ca/eng/acts/I-2.5/FullText.html";

export const PAGES = [
  { url: FEES, publisher: "Immigration, Refugees and Citizenship Canada", title: "Citizenship and immigration application fees: Fee list" },
  { url: IRPR, publisher: "Justice Laws (Department of Justice Canada)", title: "Immigration and Refugee Protection Regulations (SOR/2002-227)" },
  { url: IRPA, publisher: "Justice Laws (Department of Justice Canada)", title: "Immigration and Refugee Protection Act (S.C. 2001, c. 27)" },
];

// What to read. `fee`: the fee list section anchor and the row's exact name. `law`: the section id.
// `program` is Casevoya's program key; `claim` says what the value is, in the page's words.
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

/** Reads one claim from its page's HTML. Null (with the reason) when the page doesn't have it. */
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

async function capturePage(page, fetcher, now) {
  const response = await fetcher(page.url, { redirect: "follow", signal: AbortSignal.timeout(30_000), headers: { accept: "text/html" } });
  const bytes = Buffer.from(await response.arrayBuffer());
  if (!response.ok || bytes.length === 0) throw new Error(`${page.url} answered ${response.status}`);
  const html = bytes.toString("utf8");
  return {
    ...page,
    finalUrl: (response.url || page.url).split("#")[0],
    httpStatus: response.status,
    retrievedAt: now().toISOString(),
    sha256: createHash("sha256").update(bytes).digest("hex"),
    ...readPageDates(html),
    html,
  };
}

export async function capture({ fetcher = fetch, now = () => new Date(), log = console.error } = {}) {
  const pages = [];
  for (const page of PAGES) {
    try {
      pages.push(await capturePage(page, fetcher, now));
    } catch (error) {
      log(`Not captured: ${page.url} (${error instanceof Error ? error.message : String(error)})`);
    }
  }
  const claims = [];
  for (const spec of CLAIMS) {
    const page = pages.find((candidate) => candidate.url === spec.page);
    if (!page) continue;
    const read = readClaim(spec, page.html);
    if ("missing" in read) {
      log(`Left out ${spec.key}: ${read.missing}`);
      continue;
    }
    claims.push({ key: spec.key, program: spec.program, jurisdiction: "CA", claim: spec.claim, page: spec.page, ...read });
  }
  return {
    capturedAt: now().toISOString(),
    pages: pages.map((page) => {
      const rest = { ...page };
      delete rest.html;
      return rest;
    }),
    claims,
  };
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isMain) {
  const args = process.argv.slice(2);
  const outAt = args.indexOf("--out");
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
  const out = outAt >= 0 ? path.resolve(args[outAt + 1]) : path.join(root, "src", "modules", "content-governance", "captured-claims.json");
  const result = await capture();
  console.log(`Captured ${result.pages.length} of ${PAGES.length} pages and ${result.claims.length} of ${CLAIMS.length} claims.`);
  for (const page of result.pages) {
    console.log(`  ${page.url} ${page.sha256} modified ${page.modifiedOn ?? "Unknown"} current to ${page.currentTo ?? "Unknown"} last amended ${page.lastAmendedOn ?? "Unknown"}`);
  }
  if (args.includes("--dry-run")) process.exit(0);
  writeFileSync(out, `${JSON.stringify(result, null, 2)}\n`);
  console.log(`Wrote ${path.relative(root, out)}`);
}
