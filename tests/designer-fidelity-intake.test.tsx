import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { MatterIntake, type MatterIntakeData } from "@/components/sheet/designer/matter-intake";
import { MatterMarkup } from "@/components/sheet/markup/matter";
import { IntakeMarkup } from "@/components/portal/markup/portal-intake";
import { CorrectionMarkup } from "@/components/portal/markup/portal-correction";
import { TasksMarkup } from "@/components/portal/markup/portal-tasks";
import { ChoiceField, CollapsedEntry, CorrectionFlow, CorrectionPick, DateField, IntakeTop, ReviewPanel, SectionNav, Stepper } from "@/components/portal/intake-live";
import { TaskCardView, TasksLive } from "@/components/portal/tasks-live";
import type { PortalViewer } from "@/modules/portal/load";
import type { PortalIntakeForm } from "@/modules/intake/portal-load";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => undefined, replace: () => undefined }) }));

/**
 * Designer fidelity for intake delivery: the matter's Intake tab (`markup/matter.tsx`, variant
 * tab-intake), the portal "Background questions" page (`markup/portal-intake.tsx`), "Request a
 * correction" (`markup/portal-correction.tsx`) and the Tasks page (`markup/portal-tasks.tsx`), each
 * rendered live with the Designer's own sample data and compared with the capture.
 *
 * Live-only additions, documented in the components and stripped here: on the Intake tab, the
 * "Send a form" and "Freeze snapshot" buttons, the Send a form dialog and the `data-intake-*` /
 * `data-org` attributes; on the portal form, a month select listing every month, the inputs'
 * `inputmode`, `maxlength`, `accept` and controlled `value`.
 */

const html = (element: ReactElement) => renderToStaticMarkup(element);

function region(source: string, open: string, close: string, from = 0): string {
  const start = source.indexOf(open, from);
  expect(start, `missing ${open}`).toBeGreaterThanOrEqual(0);
  const end = source.indexOf(close, start + open.length);
  expect(end, `missing ${close}`).toBeGreaterThanOrEqual(0);
  return source.slice(start, end + close.length);
}

function expectSame(live: string, captured: string) {
  if (live !== captured) {
    let at = 0;
    while (at < live.length && live[at] === captured[at]) at++;
    console.log(`DIFF@${at}\nEXP ${captured.slice(Math.max(0, at - 160), at + 200)}\nGOT ${live.slice(Math.max(0, at - 160), at + 200)}`);
  }
  expect(live).toBe(captured);
}

/** Attributes a live control carries and the static capture does not. */
function controls(source: string): string {
  return source
    .replace(/ inputmode="[^"]*"/gi, "")
    .replace(/ maxlength="[^"]*"/gi, "")
    .replace(/ accept="[^"]*"/g, "")
    .replace(/ value="[^"]*"/g, "")
    .replace(/<select class="sel" aria-label="Month">[\s\S]*?<\/select>/g, '<select class="sel" aria-label="Month"></select>');
}

const VIEWER = {
  organizationId: "00000000-0000-4000-8000-00000000000a",
  organizationName: "Amara",
  timezone: "Asia/Kolkata",
  role: "client",
  person: { id: "00000000-0000-4000-8000-0000000000p1", displayName: "Priya Sharma", email: null, phone: null, isMinor: false, role: "applicant" },
  matters: [],
  people: [],
  grants: [],
  shares: [],
  prefs: null,
  sections: [],
} satisfies PortalViewer;

describe("Designer fidelity: matter Intake tab", () => {
  const captured = html(createElement(MatterMarkup, { variant: "tab-intake" }));
  const content = region(captured, '<div class="panel rv" style="--i:0"><h2><svg class="ic" aria-hidden="true"><use href="/assets/icons-coreui/sprite.svg#i-task">', "search doesn’t index them.</p>");
  const row = (question: string, answer: string, source: string[], tone: "rev" | "chg" | "ok", label: string, n: number) => ({
    key: `r${n}`,
    question,
    answer,
    source,
    badge: { tone, label },
    answerId: `00000000-0000-4000-8000-00000000a00${n}`,
    reviewed: false,
  });
  const DESIGNER: MatterIntakeData = {
    organizationId: VIEWER.organizationId,
    reviewer: true,
    send: { organizationId: VIEWER.organizationId, matterId: "00000000-0000-4000-8000-0000000000m1", forms: [{ id: "f1", label: "Spousal sponsorship · v3" }], people: [{ id: "p1", label: "Priya Sharma · Applicant" }], today: "2026-10-19", sampleMode: false },
    note: "Background answers are restricted. Finance and assistants don’t see them, and search doesn’t index them.",
    panels: [
      {
        responseId: "00000000-0000-4000-8000-0000000000r1",
        title: ["Intake questionnaire", "spousal sponsorship v3"],
        badge: { tone: "rev", label: "Submitted, awaiting review" },
        answered: 42,
        total: 46,
        percent: 91,
        by: ["answered by Priya", "4 marked “I don’t know”"],
        sections: [
          { label: "About you", badge: { tone: "ok", label: "Reviewed" } },
          { label: "Relationship history", badge: { tone: "rev", label: "In review" } },
          { label: "Travel and addresses, 10 years", badge: { tone: "chg", label: "2 gaps" } },
          { label: "Background questions", badge: { tone: "rev", label: "Restricted" } },
        ],
        versions: "Every edit makes a new fact version. Reviewed answers that change send the dependent package back to Preparation.",
        rows: [
          row("Date you first met Rafael", "March 2021 (partial date)", ["Priya", "v2"], "rev", "Awaiting review", 1),
          row("Addresses, Jun 2019 to Jan 2020", "“I don’t know”, will check lease", ["Priya", "v1"], "chg", "Gap", 2),
          row("Previous refusals, any country", "No", ["Priya", "v1"], "ok", "Reviewed", 3),
          row("Rafael’s marital history", "Never married", ["Rafael", "shared field"], "rev", "Awaiting review", 4),
        ],
        submitted: true,
        frozen: false,
      },
    ],
  };

  function liveOnly(source: string): string {
    return source
      .replace(/<button class="btn s sm" data-open="dIntakeSend">[\s\S]*?<\/button>/g, "")
      .replace(/<button class="btn s sm" data-intake-freeze="[^"]*" data-org="[^"]*">[\s\S]*?<\/button>/g, "")
      .replace(/<dialog class="dlg wide" id="dIntakeSend"[\s\S]*?<\/dialog>/g, "")
      .replace(/ data-intake-review="[^"]*" data-org="[^"]*"/g, "");
  }

  it("renders the questionnaire panel, Needs your review and the note exactly as captured", () => {
    const live = liveOnly(html(createElement(MatterIntake, { data: DESIGNER })));
    expectSame(live, content);
  });

  it("adds only the documented live parts", () => {
    const raw = html(createElement(MatterIntake, { data: DESIGNER }));
    expect(raw).toContain('data-open="dIntakeSend"');
    expect(raw).toContain("data-intake-freeze=");
    expect(raw).toContain('id="dIntakeSend"');
    expect(raw).toContain("data-intake-review=");
    expect(liveOnly(raw)).not.toMatch(/dIntakeSend|data-intake|data-org/);
  });

  it("shows a reviewed answer's fuse settled, and a matter without forms an honest empty state with no sample people", () => {
    const reviewed = { ...DESIGNER, panels: [{ ...DESIGNER.panels[0], rows: [{ ...DESIGNER.panels[0].rows[2], reviewed: true }] }] };
    const raw = html(createElement(MatterIntake, { data: reviewed }));
    expect(raw).toContain('data-phase="settled"');
    expect(raw).not.toContain("data-intake-review=");
    const empty = html(createElement(MatterIntake, { data: { ...DESIGNER, panels: [] } })).split("<dialog")[0];
    expect(empty).toContain("No intake form sent yet");
    expect(empty).not.toMatch(/Priya|Rafael|Amara/);
  });
});

describe("Designer fidelity: portal Background questions", () => {
  const captured = controls(html(createElement(IntakeMarkup)));

  it("renders the heading, progress and saved time exactly as captured", () => {
    const open = '<div class="ph pp-h rv" style="--i:0">';
    const close = "</time></span></div>";
    const live = html(createElement(IntakeTop, { title: "Background questions", lead: "Six short sections. Your answers save as you type, so you can stop any time and come back.", step: "Section 4 of 6", percent: 62, saved: "09:41" }));
    expectSame(region(live, open, close), region(captured, open, close));
  });

  it("renders the sections nav exactly as captured", () => {
    const items = [
      { label: "1. About you", href: "#", state: "done" as const },
      { label: "2. Your relationship", href: "#", state: "done" as const },
      { label: "3. Family", href: "#", state: "done" as const },
      { label: "4. Travel history", href: "#", state: "on" as const },
      { label: "5. Work and study", href: "#", state: "todo" as const },
      { label: "6. Background", href: "#", state: "todo" as const },
      { label: "Review and send", href: "#rv", state: "review" as const },
      { label: "Fix a reviewed answer", href: "/portal/correction", state: "fix" as const },
    ];
    expectSame(html(createElement(SectionNav, { items })), region(captured, '<nav aria-label="Sections">', "</nav>"));
  });

  it("renders a folded history entry, a partial date with its error and sureness switch, and a radio question exactly as captured", () => {
    expectSame(
      html(createElement(CollapsedEntry, { title: "Trip 1", parts: ["Canada", "2 Jun 2024 to 30 Jun 2024", "Visiting Rafael"] })),
      region(captured, '<div class="panel"><h2>Trip 1', "</div></div>"),
    );
    const left = controls(
      html(
        createElement(DateField, {
          id: "from",
          legend: "Date you left",
          required: true,
          hint: "Day is optional. Choose “approximate” if you’re not sure.",
          value: { day: "", month: "12", year: "", sure: "approximate" },
          error: "Add at least the year you left.",
          sure: [
            { key: "exact", text: "Exact" },
            { key: "approximate", text: "Approximate" },
            { key: "unknown", text: "I don’t know" },
          ],
        }),
      ),
    );
    expectSame(left, region(captured, '<fieldset class="fld err" id="from">', "</fieldset>"));
    const back = controls(html(createElement(DateField, { legend: "Date you came back", required: false, value: { day: "", month: "1", year: "2020", sure: "exact" } })));
    expectSame(back, region(captured, '<fieldset class="fld"><legend>Date you came back', "</fieldset>"));
    const purpose = html(
      createElement(ChoiceField, {
        label: "Why did you go?",
        aria: "Purpose",
        name: "pu",
        options: [
          { key: "family", text: "Tourism or family" },
          { key: "work", text: "Work" },
          { key: "not_applicable", text: "Not applicable" },
        ],
        value: "family",
      }),
    );
    expectSame(purpose, region(captured, '<div class="fld" role="radiogroup" aria-label="Purpose">', "</label></div>"));
  });

  it("renders Review and send, with its missing-answer lock, exactly as captured", () => {
    const rows = [
      { key: "a", label: "Full name", text: "Priya Sharma", missing: false, href: "#", link: "Change" },
      { key: "b", label: "Date of birth", text: "9 March 1984", missing: false, href: "#", link: "Change", num: true },
      { key: "c", label: "Date of marriage", text: "14 Feb 2024", missing: false, href: "#", link: "Change", num: true },
      { key: "d", label: "Lived together", text: "Not yet. Answer: “Not applicable”", missing: false, href: "#", link: "Change" },
      { key: "e", label: "Trip 2, left", text: "December, year unknown", missing: true, href: "#from", link: "Fix" },
    ];
    const live = html(createElement(ReviewPanel, { firm: "Amara", rows, rightLabel: "Nothing goes to Amara until you send", send: { missing: 1, busy: false, onSend: () => undefined } }));
    expectSame(live, region(captured, '<section id="rv" class="review panel"', "</section>"));
  });
});

describe("Designer fidelity: portal Request a correction", () => {
  const captured = controls(html(createElement(CorrectionMarkup)));

  it("renders the stepper and the answer list exactly as captured", () => {
    expectSame(html(createElement(Stepper, { step: 0 })), region(captured, '<ol class="stepper" id="cst">', "</ol>"));
    const pick = html(
      createElement(CorrectionPick, {
        firm: "Amara",
        picked: "address",
        options: [
          { key: "address", label: "Address history", detail: "Pune, 2019–2021", answered: "Flat 4B, Koregaon Park, from June 2019" },
          { key: "moved", label: "Your relationship", detail: "when you moved in together", answered: "March 2024" },
        ],
      }),
    );
    expectSame(pick, region(captured, '<div class="pick">', "</div>"));
  });

  it("renders the proof step and the step buttons exactly as captured", () => {
    const form: PortalIntakeForm = {
      responseId: "00000000-0000-4000-8000-0000000000r1",
      matterId: "00000000-0000-4000-8000-0000000000m1",
      title: "Background questions",
      versionNumber: 3,
      status: "submitted",
      frozen: false,
      submittedAt: "2026-10-09T08:00:00Z",
      updatedAt: "2026-10-09T08:00:00Z",
      version: 4,
      fields: [{ key: "address", type: "text", labels: { "en-CA": "Address history" } }],
      answers: [{ id: "a1", fieldKey: "address", presence: "provided", value: { text: "Flat 4B" }, createdAt: "2026-10-09T08:00:00Z", createdBy: null }],
      reviewed: [],
      dueOn: null,
      message: null,
      isSample: false,
      corrections: [],
    };
    const live = controls(html(createElement(CorrectionFlow, { viewer: VIEWER, form, initialField: null })));
    const proof = '<section class="fstep" data-c="2">';
    expectSame(region(live, proof, "</section>"), region(captured, proof, "</section>"));
    expectSame(region(live, '<div class="fnav" id="cnav">', "</div>"), region(captured, '<div class="fnav" id="cnav">', "</div>"));
    // The sent step keeps the Designer's panel; its sentence is the live one.
    const sent = (source: string) => region(source, '<section class="fstep" data-c="3">', "</section>").replace(/<p style="margin-top:6px">[\s\S]*?<\/p>/, "<p></p>").replace(/CR-\d{4}/, "");
    expectSame(sent(live), sent(captured));
  });
});

describe("Designer fidelity: portal Tasks", () => {
  const captured = html(createElement(TasksMarkup));

  it("renders the heading, the To do / Waiting / Done switch and a done task exactly as captured", () => {
    const tasks = [
      ...[1, 2].map((n) => ({ id: `o${n}`, title: `Open ${n}`, status: "open" as const, dueOn: null, completedAt: null, blockerNote: null, intakeResponseId: null })),
      ...[1, 2].map((n) => ({ id: `b${n}`, title: `Waiting ${n}`, status: "blocked" as const, dueOn: null, completedAt: null, blockerNote: "Being reviewed", intakeResponseId: null })),
      ...[1, 2, 3, 4, 5, 6].map((n) => ({ id: `d${n}`, title: `Done ${n}`, status: "done" as const, dueOn: null, completedAt: null, blockerNote: null, intakeResponseId: null })),
    ];
    const live = html(createElement(TasksLive, { viewer: { ...VIEWER, organizationName: "Northline" }, tasks }));
    const head = '<div class="ph pp-h rv" style="--i:0">';
    expectSame(region(live, head, "</div></div>"), region(captured, head, "</div></div>"));
    const seg = '<div class="seg rv k2-rs"';
    expectSame(region(live, seg, "</button></div>"), region(captured, seg, "</button></div>"));
    const done = html(createElement(TaskCardView, { card: { id: "x", title: "Sign the service agreement", line: "Signed 4 Sep by you and Rafael.", due: null, done: true, href: null, action: null }, index: 6, mine: false }));
    expectSame(done, region(captured, '<div class="task done rv k2-spot" style="--i:6"', '<span class="r"></span></div>'));
  });
});
