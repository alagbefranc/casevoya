import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AgreementsMarkup } from "@/components/sheet/markup/agreements";
import {
  NewQuoteDialog,
  QuoteConvertDialog,
  QuoteEditDialog,
  QuotePreviewDialog,
  SheetAgreementQuote,
  SheetAgreementsPick,
  type QuoteViewData,
} from "@/components/sheet/designer/agreements-quote";
import { ClauseDialog, SheetAgreementEditor, type EditorViewData } from "@/components/sheet/designer/agreements-editor";
import { SheetAgreementCompare, type CompareViewData } from "@/components/sheet/designer/agreements-compare";
import { withoutRequirementCodes } from "./helpers/designer-copy";

/**
 * Quote builder, Agreement editor and Compare versions (branch agreements-quote-editor-compare):
 * the data-driven components, given the Designer's own sample values, produce exactly the
 * captured tab content. The sample values live only in this test. Live-only additions are
 * stripped before comparing (LIVE_ONLY); the Designer's toast and fake-run attributes that the
 * live wiring replaces are put back (WIRING). Requirement codes in copy are removed from the
 * capture the way other Records pages do.
 */
function content(variant: string): string {
  const html = renderToStaticMarkup(createElement(AgreementsMarkup, { variant }));
  const start = html.indexOf('<div id="content">') + '<div id="content">'.length;
  const end = html.indexOf("</main>", start) - "</div></div>".length;
  return withoutRequirementCodes(html.slice(start, end));
}

const LIVE_ONLY = [/<button class="btn sm" data-dlg="dlgQEdit">Edit quote<\/button>/g, / aria-disabled="true"/g, / title="[^"]*"/g];

const WIRING: [RegExp, string][] = [
  [/ data-agreement-act="quote-send" data-org="[^"]*"/, ' data-run="ok" data-done="Quote sent to Tomás" data-sub="He can accept it in his portal. Accepting doesn’t sign anything." data-fpr="1"'],
  [/ data-dlg="dlgQPrev"/, ' data-toast="Client preview" data-sub="Shows the quote exactly as Tomás will see it." data-fpb="1"'],
  [/ href="\?tab=editor&amp;view=[^"]*" data-dlg="dlgQConv"/, ' href="?tab=editor"'],
  [/ data-dlg="dlgClause-[^"]*"/g, ' data-toast="Clause opened for editing" data-sub="Edits create a new draft version."'],
  [/<button class="btn sm" disabled=""><span class="lab">/, '<button class="btn sm" data-run="ok" data-done="Reminder sent to Kofi" data-sub="" data-fpr="1"><span class="lab">'],
];

function live(html: string): string {
  let out = LIVE_ONLY.reduce((text, pattern) => text.replace(pattern, ""), html);
  for (const [pattern, designer] of WIRING) out = out.replace(pattern, designer);
  return out;
}

function same(got: string, expected: string) {
  if (got !== expected) {
    let i = 0;
    while (i < got.length && got[i] === expected[i]) i++;
    console.log("DIFF@" + i + "\nEXP " + expected.slice(i - 200, i + 240) + "\nGOT " + got.slice(i - 200, i + 240));
  }
  expect(got).toBe(expected);
}

const SAMPLE_PEOPLE = /Northline|Amara|Priya|Kofi|Tomás|Hamid|Sofia|Mei Tanaka|NL-2026|S-05|Q-0044/;

const ORG = "33333333-3333-4333-8333-333333333333";
const AGREEMENT = "44444444-4444-4444-8444-444444444444";

const DESIGNER_QUOTE: QuoteViewData = {
  title: "Quote Q-0044",
  client: "Tomás Duarte",
  intro: "Permanent residence, family class. A quote proposes a defined service; the client signs a service agreement after accepting it.",
  facts: {
    scope: "Prepare and submit one family-class PR application for Tomás Duarte and spouse; respond to IRCC requests until decision",
    services: ["Eligibility review", "document checklist", "forms", "submission package", "two rounds of client review"],
    exclusions: "Appeals, judicial review, other applications, translations beyond 10 pages",
    deliverables: ["Submission package with manifest", "status updates", "decision explanation"],
    feeStructure: "Milestones (flat per stage)",
    expiry: { date: "31 Oct 2026", note: "after that the quote needs a new version" },
  },
  currency: "CAD",
  lines: [
    { category: "Professional fee", description: ["Milestone 1", "engagement and eligibility review"], amount: "1,600.00" },
    { category: "Professional fee", description: ["Milestone 2", "package ready and released"], amount: "1,600.00" },
    { category: "Professional fee", description: ["Milestone 3", "decision follow-up"], amount: "1,000.00" },
    { category: "Tax", description: ["HST 13% on professional fees (effective-dated rate, approved by the firm)"], amount: "546.00" },
    { category: "Disbursement", description: ["Translations and courier, estimated"], amount: "454.00" },
  ],
  total: { label: "Total to Northline", amount: "5,200.00" },
  government: {
    title: "Government fees are separate",
    copy: "CAD 1,525.00 per adult applicant, entered by hand from the IRCC fee list on 12 Oct 2026 (Amara Osei). Paid by the client to IRCC, never through Northline. Recheck before sending.",
  },
  instalments: [
    { when: "On signing", amount: "1,808.00", paidAs: ["Advance", "client account"] },
    { when: "Package released", amount: "1,808.00", paidAs: ["Invoice after delivery"] },
    { when: "Decision recorded", amount: "1,584.00", paidAs: ["Invoice after delivery"] },
  ],
  instalmentsNote: "Money paid before work is done is an advance. It sits in the client account until Northline invoices delivered work.",
  refund: "Unearned advances are refunded in full within 10 business days of a written request. Earned milestones aren’t refundable. Taken from template S-05 §9, reviewed by Amara Osei on 2 Sep 2026.",
  actions: {
    edit: { label: "Edit quote" },
    send: { attrs: { "data-agreement-act": "quote-send", "data-org": ORG } },
    preview: { attrs: { "data-dlg": "dlgQPrev" } },
    convert: { href: `?tab=editor&view=${AGREEMENT}`, dialog: "dlgQConv" },
  },
};

const MANDATORY = (num: string, title: string, summary: string[]) => ({ num, title, summary, mandatory: true });

const DESIGNER_EDITOR: EditorViewData = {
  title: "Service agreement",
  client: "Kofi Mensah",
  intro: "Generated from template S-05 v2 (approved 2 Sep 2026). Mandatory clauses are owned by your professional reviewer and can’t be edited here.",
  clauses: [
    MANDATORY("1", "Parties and consultant identity", ["Amara Osei, RCIC-IRB R712345", "Kofi Mensah"]),
    { num: "2", title: "Scope of services", summary: ["Express Entry profile and PR application"], mandatory: false, dialog: "dlgClause-2" },
    MANDATORY("3", "Responsibilities of each party", ["Client gives true, complete information on time"]),
    { num: "4", title: "Communication", summary: ["Portal messages; replies within 2 business days"], mandatory: false, dialog: "dlgClause-4" },
    MANDATORY("5", "Fees and disbursements", ["Professional fees, HST and disbursements shown separately; government fees paid by the client to IRCC"]),
    MANDATORY("6", "Client account and advances", ["Advances held in the client account until earned"]),
    MANDATORY("7", "Complaints", ["How to complain to Northline and to the College"]),
    MANDATORY("8", "Termination", ["Either party, in writing; unearned advances refunded"]),
    MANDATORY("9", "Signatures", ["Client then consultant"]),
  ],
  signing: {
    facts: [
      { term: "Version", parts: [{ text: "S-05 v2" }, { text: "draft 3" }, { text: "hash ", num: "a41e…9c02" }] },
      { term: "Signers, in order", parts: [{ text: "1. Kofi Mensah" }, { text: "2. Amara Osei" }] },
      { term: "Signer check", parts: [{ text: "Email code, then name typed" }] },
      { term: "E-sign consent", parts: [{ text: "Asked before the document opens" }] },
      { term: "Sent", parts: [{ text: "", num: "14 Oct 2026, 11:20" }, { text: "not opened yet" }] },
      { term: "Expires", parts: [{ text: "", num: "28 Oct 2026" }] },
    ],
    reminder: { attrs: {}, disabled: "No approved email design for a signing reminder yet" },
    void: true,
  },
};

const DESIGNER_COMPARE: CompareViewData = {
  client: "Hamid Rahimi",
  intro: "S-05 v1 was voided on 6 Oct after the fee changed while one person had signed. v2 needs fresh signatures from everyone.",
  sections: [
    {
      label: "Section 5",
      name: "Fees",
      badges: [
        { tone: "gr", label: "v1 voided" },
        { tone: "rev", label: "v2 sent" },
      ],
      paragraphs: [
        [
          { kind: "same", text: "Professional fee for the work permit application: " },
          { kind: "del", text: "CAD 2,600.00" },
          { kind: "ins", text: "CAD 2,900.00" },
          { kind: "same", text: ", plus HST." },
        ],
        [
          { kind: "same", text: "Paid as " },
          { kind: "del", text: "one invoice after submission" },
          { kind: "ins", text: "two milestones: package released and decision recorded" },
          { kind: "same", text: "." },
        ],
      ],
    },
  ],
  history: [
    { version: "v1", state: { tone: "gr", label: "Voided" }, signed: "Hamid, 5 Oct", event: ["Fee changed after one signature", "envelope voided 6 Oct"] },
    { version: "v2", state: { tone: "rev", label: "Sent" }, signed: "—", event: ["Sent 6 Oct", "reminder 13 Oct"] },
  ],
};

describe("Designer fidelity: Agreements tabs", () => {
  it("renders the Quote builder tab exactly as the captured Designer markup", () => {
    same(live(renderToStaticMarkup(createElement(SheetAgreementQuote, { data: DESIGNER_QUOTE }))), content("tab-quote"));
  });

  it("renders the Agreement editor tab exactly as the captured Designer markup", () => {
    same(live(renderToStaticMarkup(createElement(SheetAgreementEditor, { data: DESIGNER_EDITOR }))), content("tab-editor"));
  });

  it("renders the Compare versions tab exactly as the captured Designer markup", () => {
    same(live(renderToStaticMarkup(createElement(SheetAgreementCompare, { data: DESIGNER_COMPARE }))), content("tab-compare"));
  });

  it("wires the quote actions and dialogs by data attributes, never the Designer's toasts", () => {
    const quote = renderToStaticMarkup(createElement(SheetAgreementQuote, { data: DESIGNER_QUOTE }));
    expect(quote).toContain(`data-agreement-act="quote-send" data-org="${ORG}"`);
    expect(quote).toContain('data-dlg="dlgQEdit">Edit quote');
    expect(quote).toContain('data-dlg="dlgQPrev">Preview as client');
    expect(quote).toContain(`href="?tab=editor&amp;view=${AGREEMENT}" data-dlg="dlgQConv"`);
    expect(quote).not.toContain("data-run");
    expect(quote).not.toContain("data-toast");

    const dialogs = renderToStaticMarkup(
      createElement(
        "div",
        null,
        createElement(QuoteEditDialog, {
          data: {
            organizationId: ORG,
            agreementId: AGREEMENT,
            currency: "CAD",
            fields: { scope: "Scope", services: "A\nB", exclusions: "", deliverables: "", feeStructure: "Flat", refund: "", expiry: "2026-11-18", government: "" },
            today: "2026-10-19",
            lines: [{ category: "professional_fee", description: "Flat fee", amount: "1500.00", taxRate: "", sourceNote: "" }],
            instalments: [{ label: "On signing", amount: "1500.00", paidAs: "advance" }],
            revises: true,
            sample: false,
          },
        }),
        createElement(QuotePreviewDialog, {
          data: {
            firmName: "Maple Immigration",
            title: "Quote",
            status: "Not sent yet.",
            facts: [{ term: "Scope", value: "Scope" }],
            lines: [{ category: "Professional fee", description: ["Flat fee"], amount: "1,500.00" }],
            total: { label: "Total to Maple Immigration", amount: "1,500.00" },
            currency: "CAD",
            instalments: [],
            government: "Government fees are paid to IRCC.",
            refund: "No refund policy stated.",
            accept: "Accepting a quote is not signing an agreement.",
          },
        }),
        createElement(QuoteConvertDialog, { data: { organizationId: ORG, agreementId: AGREEMENT, templates: [{ value: "55555555-5555-4555-8555-555555555555", label: "Service" }], blocked: null } }),
        createElement(NewQuoteDialog, { data: { organizationId: ORG, matters: [{ value: "11111111-1111-4111-8111-111111111111", label: "Dana Lee · CV-2026-0001" }], templates: [], blocked: null, sampleMode: false } }),
        createElement(ClauseDialog, { data: { organizationId: ORG, agreementId: AGREEMENT, clauseId: "66666666-6666-4666-8666-666666666666", dialogId: "dlgClause-2", num: "2", title: "Scope", body: "Text", revises: false, signedCount: 0 } }),
      ),
    );
    expect(dialogs).toContain(`data-agreement-act="quote-save" data-agreement="${AGREEMENT}" data-org="${ORG}"`);
    expect(dialogs).toContain(`data-agreement-act="quote-convert" data-agreement="${AGREEMENT}" data-org="${ORG}"`);
    expect(dialogs).toContain(`data-agreement-act="quote-new" data-org="${ORG}"`);
    expect(dialogs).toContain(`data-agreement-act="clause-save" data-agreement="${AGREEMENT}" data-clause="66666666-6666-4666-8666-666666666666" data-org="${ORG}"`);
    expect(dialogs).toContain('<dialog class="dlg" id="dlgNewQ"');
    expect(dialogs).toContain('<dialog class="dlg wide" id="dlgQEdit"');
    expect(dialogs).toContain('<tr data-quote-line="1">');
    expect(dialogs).toContain('<template id="qeLineRow">');
    expect(dialogs).toContain("This quote was already sent");
    expect(dialogs).not.toContain("data-goto-tab");
    expect(dialogs).not.toMatch(SAMPLE_PEOPLE);
  });

  it("shows an honest pick list, and an empty state with no sample people, when a tab has no agreement", () => {
    const list = renderToStaticMarkup(
      createElement(SheetAgreementsPick, {
        data: {
          title: "Quote builder",
          intro: "Choose a quote.",
          rows: [{ key: "a", href: `/sheet/agreements?tab=quote&view=${AGREEMENT}`, title: "Quote", note: ["Dana Lee", "CV-2026-0001"], state: { tone: "gr", label: "Draft" } }],
          empty: { title: "No quotes yet", copy: "Make one.", action: { label: "New quote", dialog: "dlgNewQ" } },
        },
      }),
    );
    expect(list).toContain(`<a class="btn sm" href="/sheet/agreements?tab=quote&amp;view=${AGREEMENT}">Open</a>`);
    expect(list).toContain('<div class="li">');
    const empty = renderToStaticMarkup(
      createElement(SheetAgreementsPick, { data: { title: "Quote builder", intro: "Choose a quote.", rows: [], empty: { title: "No quotes yet", copy: "Make one.", action: { label: "New quote", dialog: "dlgNewQ" } } } }),
    );
    expect(empty).toContain('class="emp"');
    expect(empty).toContain('data-dlg="dlgNewQ"');
    expect(empty).not.toMatch(SAMPLE_PEOPLE);
    const editor = renderToStaticMarkup(
      createElement(SheetAgreementEditor, {
        data: {
          title: "Service agreement",
          client: "Dana Lee",
          intro: "Executed on 4 Oct 2026. The executed original can’t be edited.",
          clauses: [{ num: "1", title: "Scope", summary: ["All of it"], mandatory: false, locked: ["Executed", "can’t be edited"] }],
          signing: { facts: [{ term: "Version", parts: [{ text: "v1" }] }], reminder: { attrs: {}, disabled: "No approved email design for a signing reminder yet" }, void: false },
        },
      }),
    );
    expect(editor).not.toContain(">Edit</button>");
    expect(editor).toContain("Executed <span class=\"sep\"");
    expect(editor).toContain('disabled="" title="No approved email design for a signing reminder yet"');
    expect(editor).not.toContain("Void envelope");
  });
});
