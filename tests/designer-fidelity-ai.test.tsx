import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { SheetFrame } from "@/components/sheet/designer/frame";
import type { SidebarData } from "@/components/sheet/designer/sidebar";
import { DraftsHeader, DraftsRbar, SheetDrafts, type DraftsData } from "@/components/sheet/designer/drafts";
import { AiHeader, SheetAi, type AiData, type AiTab } from "@/components/sheet/designer/ai";
import { DraftsMarkup } from "@/components/sheet/markup/drafts";
import { AiMarkup } from "@/components/sheet/markup/ai";
import { withoutRequirementCodes } from "./helpers/designer-copy";

/**
 * Vo drafts and Vo and AI: the data-driven components must produce the same HTML as the captured
 * Designer markup when given the Designer's own sample values. The sample values live only in this
 * test; the app never renders them. Live-only attributes (data-vo-*, data-nav, data-org, data-f,
 * disabled on switches that aren't built) are passed only by the live presenters.
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

function sidebar(active: string): SidebarData {
  return {
    active,
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
}

const STATUSBAR = {
  timezone: "America/Toronto",
  queue: { label: "Reminder queue healthy", detail: "0 retries" },
  sample: { label: "Demo data", detail: "fictional firm “Northline Immigration”" },
};

const NO = {};

const DESIGNER_DRAFTS: DraftsData = {
  heading: "Vo drafted three things for you.",
  intro: "Vo prepares drafts from your firm’s own records. Nothing is sent, signed or changed until a person accepts it.",
  loading: { label: "Vo is checking 12 sources", clock: "0.8s" },
  cards: [
    {
      id: "a",
      meta: ["Drafted by Vo", "needs your review", "Administrative reply"],
      title: "Reply to Sofia Reyes",
      sub: { left: "Lead", right: "Spousal sponsorship" },
      body: "“Hi Sofia, I can meet Tuesday 11:00 or Wednesday 15:00. Here is the booking link.”",
      timeline: {
        id: "tlzhyt1",
        summary: "firm calendar, template T-04 · run logged · 0.4s",
        done: true,
        said: "Checked 3 sources in 0.3s",
        clock: "",
        items: ["Firm calendar", "Template T-04", "Run logged"],
      },
      accept: NO,
      edit: NO,
      reject: NO,
    },
    {
      id: "b",
      meta: ["Drafted by Vo", "needs your review", "Document request"],
      title: "Ask Rafael for photo dates",
      sub: { left: "Priya Sharma", right: "NL-2026-0142" },
      body: "“Could you add the date and place for each photo? A short note per photo is enough.”",
      timeline: {
        id: "tljfp4x",
        summary: "request DR-12, checklist v3 · run logged · 0.6s",
        done: true,
        said: "Checked 3 sources in 0.6s",
        clock: "",
        items: ["Request DR-12", "Checklist v3", "Run logged"],
      },
      accept: NO,
      edit: NO,
      reject: NO,
    },
    {
      id: "c",
      meta: ["Drafted by Vo", "needs your review", "First draft", "needs consultant"],
      title: "Proposal outline for Tomás Duarte",
      sub: { left: "Lead", right: "PR, family" },
      body: "Scope, exclusions and fee lines drafted from consultation notes. Fee amounts left blank for you.",
      timeline: {
        id: "tlk8f7r",
        summary: "notes 14 Oct, fee schedule v2 · run logged · 1.1s",
        done: false,
        said: "",
        clock: "0.8s",
        items: ["Notes 14 Oct", "Fee schedule v2", "Run logged"],
      },
      accept: NO,
      edit: NO,
      reject: NO,
    },
  ],
  running: { started: "09:12", text: "Call notes for Daniel: Kofi Mensah, bounced deadline notice. Usually ready in under a minute. You can leave this page." },
  abstain: {
    meta: { left: "Vo didn’t draft this one", right: "sent to Amara" },
    title: "Kofi Mensah asked: “Can I keep working while my application is processed?”",
    copy: "No approved source in Northline’s library covers this, so Vo won’t guess. It’s in Amara’s queue to answer.",
  },
  empty: null,
  lock: "Vo can’t sign, submit, move money, change bank details, give legal advice or record a decision. Those always need a person with the right role.",
  switches: [
    { id: "swhw2rz", label: "Document classification", on: true, attrs: NO },
    { id: "sw7p9kd", label: "OCR field suggestions", on: true, attrs: NO },
    { id: "sw365n3", label: "Missing-field and inconsistency flags", on: true, attrs: NO },
    { id: "sw8gubn", label: "Matter summaries", on: true, attrs: NO },
    { id: "sw03v0q", label: "Administrative replies", on: true, attrs: NO },
    { id: "swif89n", label: "First drafts of letters from approved facts", on: false, attrs: NO },
  ],
  week: ["18 drafts", "14 accepted", "3 edited", "1 rejected"],
  weekNote: "Every run records the model version, the allowed sources and who reviewed it.",
};

describe("Designer fidelity: Vo drafts", () => {
  it("renders the Vo drafts page exactly as the captured Designer markup", () => {
    const captured = withoutPreloads(renderToStaticMarkup(createElement(DraftsMarkup)));
    const live = withoutPreloads(
      renderToStaticMarkup(
        createElement(
          SheetFrame,
          {
            sidebar: sidebar("/sheet/drafts"),
            header: createElement(DraftsHeader, {
              data: {
                pills: ["3 waiting", "AI on for this firm", "Drafts only"],
                ask: { "data-toast": "Ask Vo", "data-toast-sub": "Vo answers from this firm’s records and approved sources only." },
                settings: {},
              },
            }),
            aside: createElement(DraftsRbar, { data: DESIGNER_DRAFTS }),
            statusbar: STATUSBAR,
          },
          createElement(SheetDrafts, { data: DESIGNER_DRAFTS }),
        ),
      ),
    );
    sameMarkup(live, captured);
  });
});

const T = { "data-toast": "Thanks, noted for the prompt review", "data-fpb": "1" };
const F = { "data-toast": "Noted. Tell us why in the review", "data-fpb": "1" };
const sw = (id: string, label: string, on: boolean, small?: string, sr = label) => ({ id, label, small, sr, on, attrs: {} });

const DESIGNER_AI: Omit<AiData, "tab"> = {
  pills: ["Vo on", "0 unauthorised actions"],
  settings: {
    intro: "Turn Vo off for the whole firm, for one capability or for a sensitive kind of document. Switched off, every workflow still works by hand (AI-01, AI-06).",
    firm: [
      sw("swalyan", "Vo for Northline Immigration", true, "Drafts only. People accept, edit or reject everything."),
      sw("sw1zrd6", "Document classification", true),
      sw("swieib6", "OCR normalisation (names, dates, numbers)", true),
      sw("sw3njmf", "Missing-field detection", true),
      sw("swor4yk", "Inconsistency flags (not fraud findings)", true),
      sw("swc0vwc", "Matter summaries for staff", true),
      sw("swiwrh9", "Administrative reply drafts", true),
      sw("sw2e53h", "First drafts of letters from approved facts", false),
    ],
    categories: [
      sw("swdzfhq", "Identity documents", true, "Passports, birth certificates", "Vo may read Identity documents"),
      sw("swhr1ku", "Relationship evidence", true, "Photos, certificates", "Vo may read Relationship evidence"),
      sw("swts207", "Financial documents", true, "Income, bank statements", "Vo may read Financial documents"),
      sw("swzseaf", "Medical records", false, "Always reviewed by people", "Vo may read Medical records"),
      sw("swc4yr0", "Criminal history", false, "Police certificates, court records", "Vo may read Criminal history"),
      sw("swl2snl", "Narratives and letters", false, "Personal statements", "Vo may read Narratives and letters"),
      sw("swqsr1x", "Client messages", true, "Portal messages", "Vo may read Client messages"),
    ],
    dataUse: [
      { term: "Training on your files", value: "Never, by default" },
      { term: "Vendor retention", value: "Reviewed in the AI vendor contract (subprocessors page)" },
      { term: "What Vo can read", value: "Only the matter, person and audience you’re working in" },
      { term: "Documents’ own instructions", value: "Ignored. Text inside an upload can’t change Vo’s rules (AI-05)" },
    ],
  },
  runs: {
    intro: "Every Vo run, with its model, prompt version, the sources it was allowed to use and who reviewed it. Protected like the case file (AI-02).",
    chips: ["All", "Accepted", "Edited", "Rejected", "Abstained"],
    rows: [
      { when: "17 Oct 08:44", matter: "NL-2026-0142", task: "Reply draft to Rafael", model: { left: "vo-draft-2", right: "cfg 14" }, prompt: "reply v6", sources: "DR-12, checklist v3", actor: "Daniel Ruiz", cost: "0.4¢", review: { tone: "rev", label: "Waiting" }, useful: { up: false, down: false, upAttrs: T, downAttrs: F } },
      { when: "17 Oct 08:13", matter: "NL-2026-0142", task: "OCR: marriage certificate", model: { left: "vo-ocr-1", right: "cfg 9" }, prompt: "ocr v3", sources: "doc 8812 p.1", actor: "Daniel Ruiz", cost: "0.2¢", review: { tone: "ok", label: "Accepted, 3 fields confirmed" }, useful: { up: true, down: false, upAttrs: T, downAttrs: F } },
      { when: "16 Oct 16:20", matter: "NL-2026-0131", task: "Proof of funds question", model: { left: "vo-draft-2", right: "cfg 14" }, prompt: "ask v2", sources: "S-071 (stale)", actor: "Amara Osei", cost: "0.1¢", review: { tone: "chg", label: "Abstained", detail: "sent to consultant" }, useful: { up: false, down: false, upAttrs: T, downAttrs: F } },
      { when: "16 Oct 11:02", matter: "NL-2026-0142", task: "Summary for staff", model: { left: "vo-sum-1", right: "cfg 4" }, prompt: "sum v5", sources: "matter events", actor: "Amara Osei", cost: "0.6¢", review: { tone: "ok", label: "Edited" }, useful: { up: true, down: false, upAttrs: T, downAttrs: F } },
      { when: "15 Oct 10:30", matter: "NL-2026-0129", task: "Reply draft to Ana", model: { left: "vo-draft-2", right: "cfg 13" }, prompt: "reply v6", sources: "INV-0214", actor: "Lena Park", cost: "0.3¢", review: { tone: "bad", label: "Rejected", detail: "wrong tone" }, useful: null },
    ],
    note: "Prompts are trimmed to what each task needs; identity numbers are redacted from the log.",
    empty: null,
  },
  sources: {
    intro: "The approved, jurisdiction-specific sources Vo may cite. A legal answer needs one of these; if the source is missing or stale, Vo hands the question to a consultant (AI-04).",
    rows: [
      { source: "Spousal sponsorship guide", publisher: "IRCC", effective: "2 Sep 2026", review: "12 Nov 2026", owner: "Amara Osei", state: { tone: "ok", label: "Approved" } },
      { source: "Express Entry proof of funds", publisher: "IRCC", effective: "7 Jul 2026", review: { left: "1 Oct 2026", right: "overdue" }, owner: "Amara Osei", state: { tone: "chg", label: "Stale", detail: "Vo won’t cite" } },
      { source: "Police certificates by country", publisher: "IRCC", effective: "1 Jan 2026", review: "12 Oct 2026", owner: "Grace Lin", state: { tone: "rev", label: "In review" } },
      { source: "Settlement funds table 2025", publisher: "IRCC", effective: "2025", review: "—", owner: "—", state: { tone: "gr", label: "Superseded" } },
    ],
    detail: {
      publisher: "Immigration, Refugees and Citizenship Canada",
      state: { tone: "ok", label: "Checked" },
      rows: [
        { term: "Publisher", value: "Immigration, Refugees and Citizenship Canada" },
        { term: "Link", value: "Sponsor your spouse, partner or children", href: "https://www.canada.ca/en/immigration-refugees-citizenship/services/immigrate-canada/family-sponsorship/spouse-partner-children.html" },
        { term: "Applies to", value: "Who can sponsor, who you can sponsor, documents" },
        { term: "Version", value: "Page as captured 12 Oct 2026" },
        { term: "Checked", value: "12 Oct 2026", time: true },
        { term: "Reviewer", value: "Amara Osei" },
      ],
    },
    empty: null,
  },
  states: {
    abstain: {
      title: { left: "No approved source", right: "Vo abstains" },
      quote: "“I can’t answer how much money Kofi needs to show. The source I’m allowed to use is out of date. I’ve sent the question to Amara Osei.”",
      badge: { tone: "chg", label: "Sent to consultant" },
      tag: { left: "Source S-071", right: "last checked 1 Jul 2026" },
      note: "Vo doesn’t guess, and it doesn’t show a made-up figure as a placeholder (SRC-09).",
    },
    cite: {
      quote: "“The sponsor must show they can support Priya and Olena. Source: IRCC spousal sponsorship guide, checked 12 Oct 2026.”",
      timeline: { done: false, clock: "0.7s", said: "", items: ["IRCC spousal sponsorship guide", "Checklist v3", "Intake answers, 3 Oct"] },
    },
    offline: {
      lead: "Vo is offline right now.",
      text: " Draft by hand; everything else works as usual. Pending drafts wait and are marked “not started”.",
      actions: [
        { label: "Write it myself", primary: true, attrs: { "data-toast": "Opened a blank reply", "data-sub": "", "data-fpb": "1" } },
        { label: "Try Vo again", attrs: { "data-toast": "Still offline", "data-sub": "We’ll retry in 5 minutes.", "data-fpb": "1" } },
      ],
    },
    uncertain:
      "When Vo is unsure it says so in the draft (“I’m not certain the 2019 address dates are right; Priya answered ‘approximately’.”) and marks the draft for consultant review.",
  },
  rules: {
    approvals: [
      ["Legal advice and client explanations", "Responsible consultant"],
      ["Refunds", "Finance user plus owner"],
      ["New or changed bank destination", "Owner, with two-step sign-in"],
      ["Recording a final outcome", "Consultant, with official evidence"],
      ["Releasing a submission package", "Licensed consultant"],
      ["Earned-fee transfer", "Two approvers"],
    ],
    never: ["Sign anything", "Submit to a government", "Change bank details", "Issue a refund", "Decide or infer an official decision", "Change an approved fact without review"],
    gates: [
      { term: "High-confidence identity fields", value: "98% precision target before use" },
      { term: "Source anchors", value: "Every extracted fact has one" },
      { term: "Unauthorised tool actions", value: "Zero in tests" },
      { term: "Cross-firm retrieval", value: "Zero in tests" },
    ],
  },
  audit: {
    rows: [
      { draft: "Reply to Rafael about photo dates", matter: "NL-2026-0142", result: { tone: "rev", label: "Waiting" }, by: "—", when: "—", change: "—" },
      { draft: "Request: police certificate (India)", matter: "NL-2026-0142", result: { tone: "ok", label: "Accepted" }, by: "Daniel Ruiz", when: "14 Oct", change: "None" },
      { draft: "Matter summary", matter: "NL-2026-0142", result: { tone: "ok", label: "Edited" }, by: "Amara Osei", when: "16 Oct", change: { left: "2 sentences changed", right: "diff kept" } },
      { draft: "Reply to Ana about her card", matter: "NL-2026-0129", result: { tone: "bad", label: "Rejected" }, by: "Lena Park", when: "15 Oct", change: "Reason: wrong tone" },
    ],
    empty: null,
  },
};

const VARIANT: Record<AiTab, string> = {
  settings: "tab-settings",
  runs: "tab-runs",
  sources: "tab-sources",
  states: "tab-states",
  rules: "tab-rules",
  audit: "tab-audit",
};

describe("Designer fidelity: Vo and AI", () => {
  for (const tab of Object.keys(VARIANT) as AiTab[]) {
    it(`renders the ${tab} tab exactly as the captured Designer markup`, () => {
      const captured = withoutRequirementCodes(withoutPreloads(renderToStaticMarkup(createElement(AiMarkup, { variant: VARIANT[tab] }))));
      const data: AiData = { ...DESIGNER_AI, tab };
      const live = withoutPreloads(
        renderToStaticMarkup(
          createElement(
            SheetFrame,
            { sidebar: sidebar("/sheet/ai"), header: createElement(AiHeader, { data }), statusbar: STATUSBAR },
            createElement(SheetAi, { data }),
          ),
        ),
      )
        // Live only: the run log's "No runs match" panel, shown by the filter when nothing matches.
        .replace(/<div class="fp-fe rv" hidden="" style="--i:2">[\s\S]*?<\/b><small>Try another filter or clear the search\.<\/small><\/div><\/div>/, "");
      // The Designer's sample values (test-only) carry the capture's requirement codes too.
      sameMarkup(withoutRequirementCodes(live), captured);
    });
  }
});
