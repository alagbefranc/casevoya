import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { SheetFrame } from "@/components/sheet/designer/frame";
import type { SidebarData } from "@/components/sheet/designer/sidebar";
import { PrivacyDialogs, PrivacyHeader, SheetPrivacy, type PrivacyData } from "@/components/sheet/designer/privacy";
import { ComplaintDialog, ComplaintsDialogs, ComplaintsHeader, SheetComplaints, type ComplaintsData } from "@/components/sheet/designer/complaints";
import { PrivacyMarkup } from "@/components/sheet/markup/privacy";
import { ComplaintsMarkup } from "@/components/sheet/markup/complaints";

/**
 * Compliance > Privacy requests and Complaints: the data-driven components must produce the same
 * HTML as the captured Designer markup when given the Designer's own sample values. The sample
 * values live only in this test; the app never renders them.
 */

const SIGN_OUT = /<form [^>]*action="\/sign-out"[^>]*>[\s\S]*?<\/form>/g;

function withoutPreloads(html: string): string {
  return html.replace(/<link rel="preload"[^>]*\/>/g, "").replace(SIGN_OUT, "");
}

function sameMarkup(live: string, captured: string) {
  if (live !== captured) {
    let i = 0;
    while (i < live.length && live[i] === captured[i]) i++;
    console.log("DIFF@" + i + "\nEXP " + captured.slice(i - 160, i + 200) + "\nGOT " + live.slice(i - 160, i + 200));
  }
  expect(live).toBe(captured);
}

const SIDEBAR: SidebarData = {
  active: "/sheet/privacy",
  counts: { notifications: 5, drafts: 3, tasks: 7, inbox: 4, finance: 2, pipeline: 10, sourcesReview: 2 },
  pinned: [
    { href: "/sheet/matters/priya", name: "Priya Sharma", avatarUrl: "/assets/av-priya-applicant.png" },
    { href: "/sheet/matters?q=Kofi", name: "Kofi Mensah", avatarUrl: "/assets/av-kofi-client.png" },
  ],
  me: { name: "Amara Osei", role: "Licensed consultant", avatarUrl: "/assets/av-amara-consultant.png" },
  tiles: { documents: "/sheet/matters/priya?tab=documents", invoices: "/sheet/matters/priya?tab=billing" },
  newMatter: { href: "#", toast: "New matter", toastSub: "Starts from a versioned program template (prototype)." },
  createBoard: { href: "#", toast: "Create board", toastSub: "Saves the current filters as a board (prototype)." },
};

const STATUSBAR = {
  timezone: "America/Toronto",
  queue: { label: "Reminder queue healthy", detail: "0 retries" },
  sample: { label: "Demo data", detail: "fictional firm “Northline Immigration”" },
};

const DESIGNER_PRIVACY: PrivacyData = {
  rows: [
    { ref: "PR-007", person: "Rafael Sharma", type: "Access to his records", received: "12 Oct", due: "11 Nov 2026", state: { tone: "blue", label: "Redacting" } },
    { ref: "PR-006", person: "Ana Ferreira", type: ["Correction", "address"], received: "20 Sep", due: null, state: { tone: "ok", label: "Done 24 Sep" } },
    { ref: "PR-005", person: "Yusuf Demir", type: "Withdraw marketing consent", received: "2 Sep", due: null, state: { tone: "ok", label: "Done", detail: "service messages continue" } },
  ],
  selected: {
    title: ["PR-007", "Rafael Sharma"],
    steps: [
      { state: "done", title: "Identity verified", small: "Two-step sign-in plus a video call, 13 Oct" },
      { state: "done", title: "Scope searched", small: "NL-2026-0142: 41 records about Rafael" },
      { state: "now", title: "Third-party information redacted", small: ["Priya’s and Olena’s private details removed", "6 of 9 done"] },
      { state: "", title: "Reviewed", small: "Amara Osei" },
      { state: "", title: "Exported and delivered", small: "Portal download with delivery proof" },
    ],
    notes: ["Withdrawing consent starts an impact review. It doesn’t delete records the firm must keep, or any under a legal hold."],
    worklist: {
      icon: "eye",
      title: ["Redaction worklist", "PR-007"],
      label: "Redactions",
      columns: ["Record", "Third party", "What’s removed", "By", "State"],
      rows: [
        { cells: [{ text: "Intake questionnaire p.4" }, { text: "Priya Sharma" }, { text: "Her previous address history" }, { text: "Amara Osei" }, { badge: { tone: "ok", label: "Redacted" } }] },
        { cells: [{ text: "Message 14 Oct" }, { text: "Olena Sharma" }, { text: "Her phone number and school" }, { text: "Amara Osei" }, { badge: { tone: "ok", label: "Redacted" } }] },
        { cells: [{ text: "Police certificate (Priya)" }, { text: "Priya Sharma" }, { text: ["Whole record", "not about Rafael"] }, { text: "System rule" }, { badge: { tone: "ok", label: "Excluded" } }] },
        { cells: [{ text: "Relationship letter" }, { text: "Priya Sharma" }, { text: ["Nothing", "joint statement"] }, { text: "Amara Osei" }, { badge: { tone: "blue", label: "Kept, reviewed" } }] },
        { cells: [{ text: "Call note 3 Oct" }, { text: "Olena Sharma" }, { text: "Health detail" }, { text: "—" }, { badge: { tone: "chg", label: "To do" } }] },
      ],
    },
    deadline: {
      rows: [
        { term: "Legal deadline", value: ["30 days from receipt", "11 Nov 2026"] },
        { term: "Extension", value: ["Not used", "would need a written reason"] },
        { term: "Delivery", value: "Portal download, link valid 7 days" },
        { term: "Proof", value: "Download time and IP recorded in the audit trail" },
        { term: "Fee", value: "None charged" },
      ],
      actions: [
        { label: "Send for review", primary: true, attrs: { "data-toast": "Sent to Amara Osei for review", "data-sub": "3 redactions still to do.", "data-fpb": "1" } },
        { label: "Preview package", attrs: { "data-toast": "Preview opens with redactions shown", "data-sub": "", "data-fpb": "1" } },
      ],
    },
  },
};

const DESIGNER_COMPLAINTS: ComplaintsData = {
  firmName: "Northline",
  rows: [
    { ref: "CP-004", complainant: "Sofia Reyes", matter: "Lead L3", issue: "Fees explained late", received: "9 Oct", owner: "Amara Osei", next: "Response due 23 Oct", state: { tone: "chg", label: "Acknowledged 10 Oct" } },
    { ref: "CP-003", complainant: "Yusuf Demir", matter: "—", issue: "Missed call-back", received: "2 Sep", owner: "Amara Osei", next: "—", state: { tone: "ok", label: "Resolved 16 Sep" } },
  ],
  selected: {
    title: ["CP-004", "Sofia Reyes"],
    steps: [
      { state: "done", title: "Received", small: "9 Oct, by email" },
      { state: "done", title: "Acknowledged", small: ["10 Oct", "within 2 business days"] },
      { state: "now", title: "Reviewed", small: ["Amara Osei", "evidence: quote Q-0039, emails"] },
      { state: "", title: "Response sent", small: "Due 23 Oct" },
      { state: "", title: "Resolution recorded" },
    ],
    rows: [
      { term: "Evidence", value: ["Quote Q-0039", "2 emails", "call note"] },
      { term: "Hold", value: "Related records kept until resolved" },
      { term: "Routes to", value: "Northline (professional service)" },
      { term: "Not", value: "A Casevoya software support ticket" },
    ],
    actions: [],
  },
};

describe("Designer fidelity: Compliance", () => {
  it("renders the Privacy requests page exactly as the captured Designer markup", () => {
    const captured = withoutPreloads(renderToStaticMarkup(createElement(PrivacyMarkup)));
    const live = withoutPreloads(
      renderToStaticMarkup(
        createElement(
          SheetFrame,
          {
            sidebar: SIDEBAR,
            header: createElement(PrivacyHeader, {
              data: {
                pills: ["1 open", "Privacy contact: Amara Osei"],
                actions: [{ label: "Record a request", primary: true, attrs: { "data-toast": "New request", "data-sub": "Starts with identity verification.", "data-fpb": "1" } }],
              },
            }),
            statusbar: STATUSBAR,
          },
          createElement(SheetPrivacy, { data: DESIGNER_PRIVACY }),
        ),
      ),
    );
    sameMarkup(live, captured);
  });

  it("renders the Complaints page and its Record a complaint dialog exactly as the captured Designer markup", () => {
    const captured = withoutPreloads(renderToStaticMarkup(createElement(ComplaintsMarkup)));
    const live = withoutPreloads(
      renderToStaticMarkup(
        createElement(
          SheetFrame,
          {
            sidebar: { ...SIDEBAR, active: "/sheet/complaints" },
            header: createElement(ComplaintsHeader, {
              data: { pills: ["Visible to: Amara Osei, Lena Park"], actions: [{ label: "Record a complaint", primary: true, attrs: { "data-dlg": "dlgC", "data-fpd": "1" } }] },
            }),
            statusbar: STATUSBAR,
            after: createElement(ComplaintDialog, {
              data: {
                about: [
                  ["", "Northline’s professional service"],
                  ["", "The Casevoya software (sends to Casevoya support)"],
                ],
                received: "17/10/2026",
                save: { "data-close": "dlgC", "data-toast": "Complaint recorded", "data-toast-sub": "Acknowledgement task due in 2 business days.", "data-toast-kind": "ok" },
              },
            }),
          },
          createElement(SheetComplaints, { data: DESIGNER_COMPLAINTS }),
        ),
      ),
    );
    sameMarkup(live, captured);
  });

  it("shows a firm without records honest empty states, with no sample people", () => {
    const privacy = renderToStaticMarkup(createElement(SheetPrivacy, { data: { rows: [], selected: null } }));
    const complaints = renderToStaticMarkup(createElement(SheetComplaints, { data: { firmName: "Maple Immigration", rows: [], selected: null } }));
    for (const html of [privacy, complaints]) {
      expect(html).toContain('class="emp"');
      expect(html).not.toMatch(/Northline|Rafael|Priya|Olena|Sofia|Yusuf|Amara|PR-00|CP-00/);
    }
    expect(complaints).toContain("Complaints about Maple Immigration’s professional service.");
    // Staff outside the register see why, not rows.
    expect(renderToStaticMarkup(createElement(SheetComplaints, { data: { firmName: "Maple", rows: null, selected: null } }))).toContain("You don’t have access to Complaints");
    expect(renderToStaticMarkup(createElement(SheetPrivacy, { data: { rows: null, selected: null } }))).toContain("You don’t have access to Privacy requests");
  });

  it("wires live rows, buttons and dialogs by data attributes, with no Designer toast", () => {
    const org = "33333333-3333-4333-8333-333333333333";
    const html = renderToStaticMarkup(
      createElement(
        "div",
        null,
        createElement(PrivacyHeader, { data: { pills: ["1 open"], actions: [{ label: "Record a request", primary: true, attrs: { "data-dlg": "dlgPR" } }] } }),
        createElement(SheetPrivacy, {
          data: {
            rows: [{ ref: "PR-001", person: "Dana Lee", type: "Correction", received: "2 Oct", due: null, state: { tone: "rev", label: "Identity to check" }, href: "/sheet/privacy?view=r1" }],
            selected: {
              title: ["PR-001", "Dana Lee"],
              steps: [{ state: "now", title: "Identity verified", small: "Not yet" }],
              notes: ["Asked to fix an address."],
              worklist: null,
              deadline: { rows: [{ term: "Firm target", value: "Not set" }], actions: [{ label: "Record identity check", primary: true, attrs: { "data-dlg": "dlgPStep" } }] },
            },
          },
        }),
        createElement(PrivacyDialogs, {
          data: {
            organizationId: org,
            record: { today: "17/10/2026", people: [["p1", "Dana Lee"]], matters: [], handlers: [["m1", "Me"]], me: "m1" },
            step: { requestId: "r1", step: "identity", title: "Identity verified", label: "How you checked", hint: "x" },
            redaction: null,
            close: null,
            settings: null,
          },
        }),
        createElement(ComplaintsDialogs, {
          data: {
            organizationId: org,
            record: { about: [["service", "Maple’s professional service"], ["software", "The Casevoya software (sends to Casevoya support)"]], received: "17/10/2026", save: { "data-complaint-new": "1", "data-org": org } },
            step: null,
            settings: null,
          },
        }),
      ),
    );
    expect(html).toContain('<tr data-href="/sheet/privacy?view=r1"><td>PR-001</td>');
    expect(html).toContain('<button class="btn p sm" data-dlg="dlgPR">');
    expect(html).toContain(`data-privacy-new="1" data-org="${org}"`);
    expect(html).toContain(`data-privacy-step="identity" data-request="r1" data-org="${org}"`);
    expect(html).toContain(`<button class="btn p" data-complaint-new="1" data-org="${org}">Save</button>`);
    expect(html).not.toContain("data-toast");
    expect(html).not.toMatch(/Northline|Rafael|Sofia/);
  });
});
