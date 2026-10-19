import { describe, expect, it } from "vitest";
import {
  answerText,
  fieldVisible,
  formProgress,
  historyFlags,
  intakeError,
  latestAnswers,
  normalizeName,
  readDateInput,
  reviewFlags,
  type AnswerVersion,
} from "@/modules/intake/present";
import { draftAnswer, intakeCards, reviewRows } from "@/components/portal/intake-live";
import { taskCards } from "@/components/portal/tasks-live";
import { intakePanel, publishedForms } from "@/modules/sheet/matter-intake-present";
import { notificationParts } from "@/modules/sheet/notifications-present";
import type { IntakeField } from "@/modules/sheet/intake-builder-present";

// Pure presentation for intake delivery (PRD INT-03 to INT-06). Synthetic records only.

let n = 0;
const answer = (fieldKey: string, presence: AnswerVersion["presence"], value: Record<string, unknown>, at = "2026-10-10T10:00:00Z", createdBy: string | null = "u-client"): AnswerVersion => ({
  id: `a${++n}`,
  fieldKey,
  presence,
  value,
  createdAt: at,
  createdBy,
});

const FIELDS: IntakeField[] = [
  { key: "full_name", type: "text", labels: { "en-CA": "Full name" }, required: true },
  { key: "date_of_birth", type: "date", labels: { "en-CA": "Date of birth" }, required: true },
  { key: "married", type: "choice", ui: "yes_no", options: ["yes", "no"], labels: { "en-CA": "Married?" }, required: true },
  { key: "spouse_name", type: "text", labels: { "en-CA": "Spouse name" }, required: true, show_when: { field: "married", equals: "yes" } },
  { key: "addresses", type: "repeatable", labels: { "en-CA": "Addresses" } },
  { key: "confirm", type: "declaration", labels: { "en-CA": "My answers are true" }, required: true },
];

describe("partial dates are never filled in", () => {
  it("keeps exactly what was typed", () => {
    expect(readDateInput({ day: "", month: "", year: "2021", sure: "exact" })).toEqual({ presence: "provided", value: { date_kind: "year", year: 2021 } });
    expect(readDateInput({ day: "", month: "3", year: "2021", sure: "exact" })).toEqual({ presence: "provided", value: { date_kind: "year_month", year: 2021, month: 3 } });
    expect(readDateInput({ day: "9", month: "3", year: "1984", sure: "exact" })).toEqual({ presence: "provided", value: { date_kind: "exact", calendar_date: "1984-03-09" } });
    expect(readDateInput({ day: "", month: "12", year: "2019", sure: "approximate" })).toMatchObject({ presence: "approximate", value: { year: 2019, month: 12 } });
    expect(readDateInput({ day: "", month: "", year: "", sure: "unknown" })).toEqual({ presence: "unknown", value: {} });
  });

  it("refuses what would need guessing", () => {
    expect(readDateInput({ day: "", month: "12", year: "", sure: "exact" })).toEqual({ error: "Add at least the year." });
    expect(readDateInput({ day: "9", month: "", year: "2021", sure: "exact" })).toEqual({ error: "Choose the month too, or leave the day empty." });
    expect(readDateInput({ day: "30", month: "2", year: "2021", sure: "exact" })).toEqual({ error: "February 2021 has no day 30." });
    expect(readDateInput({ day: "", month: "", year: "21", sure: "exact" })).toEqual({ error: "Enter the year as four digits." });
  });
});

describe("conditional questions and progress", () => {
  it("shows a conditional question only when its rule applies, and counts it only then", () => {
    const none = latestAnswers([answer("full_name", "provided", { text: "Synthetic Person" })]);
    expect(fieldVisible(FIELDS[3], none)).toBe(false);
    expect(formProgress(FIELDS, none)).toMatchObject({ answered: 1, total: 5 });
    const married = latestAnswers([answer("married", "provided", { text: "yes" })]);
    expect(fieldVisible(FIELDS[3], married)).toBe(true);
    const progress = formProgress(FIELDS, married);
    expect(progress.total).toBe(6);
    expect(progress.missing.map((field) => field.key)).toEqual(["full_name", "date_of_birth", "spouse_name", "confirm"]);
  });

  it("counts a declaration only when confirmed, and Unknown as answered", () => {
    const answers = latestAnswers([answer("confirm", "provided", { declaration: false }), answer("date_of_birth", "unknown", {})]);
    const progress = formProgress(FIELDS, answers);
    expect(progress.missing.map((field) => field.key)).toContain("confirm");
    expect(progress.missing.map((field) => field.key)).not.toContain("date_of_birth");
    expect(progress.unknown).toBe(1);
  });

  it("keeps every version and reads the latest", () => {
    const answers = latestAnswers([answer("full_name", "provided", { text: "Old" }, "2026-10-01T00:00:00Z"), answer("full_name", "provided", { text: "New" }, "2026-10-02T00:00:00Z")]);
    expect(answers.get("full_name")).toMatchObject({ versionNumber: 2, latest: { value: { text: "New" } }, history: [{ value: { text: "Old" } }] });
  });
});

describe("answers in words", () => {
  it("says what was stored and nothing more", () => {
    const dob = FIELDS[1];
    expect(answerText(dob, { presence: "provided", value: { calendar_date: "1984-03-09" } })).toBe("9 March 1984");
    expect(answerText(dob, { presence: "provided", value: { year: 2021, month: 3 } })).toBe("March 2021");
    expect(answerText(dob, { presence: "approximate", value: { year: 2019, approximate_note: "x" } })).toBe("About 2019");
    expect(answerText(dob, { presence: "unknown", value: {} })).toBe("“I don’t know”");
    expect(answerText(FIELDS[2], { presence: "provided", value: { text: "yes" } })).toBe("Yes");
    expect(answerText({ key: "country", type: "country", labels: {} }, { presence: "provided", value: { text: "CA" } })).toBe("Canada");
  });

  it("turns a form's draft into what the database accepts, or a field error", () => {
    const base = { text: "", mode: "answer" as const, date: { day: "", month: "", year: "", sure: "exact" as const }, choice: "", checked: false, entries: [], open: null, file: "" };
    expect(draftAnswer(FIELDS[0], { ...base, text: "  " })).toBeNull();
    expect(draftAnswer(FIELDS[0], { ...base, mode: "unknown" })).toEqual({ presence: "unknown", value: {} });
    expect(draftAnswer(FIELDS[1], { ...base, date: { day: "", month: "5", year: "", sure: "exact" } })).toEqual({ error: "Add at least the year." });
    expect(draftAnswer(FIELDS[4], { ...base, entries: [{ details: "Toronto", from: { day: "", month: "6", year: "2019", sure: "exact" }, to: { day: "", month: "", year: "", sure: "exact" } }] })).toEqual({
      presence: "provided",
      value: { entries: [{ details: "Toronto", from: { year: 2019, month: 6 }, to: null }] },
    });
  });

  it("lists the review rows with Missing for a required question", () => {
    const rows = reviewRows(FIELDS, latestAnswers([answer("full_name", "provided", { text: "Synthetic Person" })]), (key) => `#q-${key}`, "Change");
    expect(rows[0]).toMatchObject({ label: "Full name", text: "Synthetic Person", missing: false, link: "Change" });
    expect(rows[1]).toMatchObject({ label: "Date of birth", missing: true, link: "Fix", href: "#q-date_of_birth" });
  });
});

describe("review flags (INT-05) are things to check", () => {
  it("finds gaps and overlaps in a history, at the precision given", () => {
    const flags = historyFlags("addresses", "Addresses", [
      { details: "Pune", from: { year: 2015, month: 1 }, to: { year: 2017, month: 6 } },
      { details: "Delhi", from: { year: 2018, month: 1 }, to: { year: 2020, month: 2 } },
      { details: "Mumbai", from: { year: 2020, month: 1 }, to: null },
    ]);
    expect(flags.map((flag) => flag.kind)).toEqual(["gap", "overlap"]);
    expect(historyFlags("x", "X", [{ details: "A", from: { year: 2015 }, to: { year: 2016 } }, { details: "B", from: { year: 2016 }, to: null }])).toEqual([]);
  });

  it("flags a date of birth or name that differs from the record, and expired evidence", () => {
    const answers = latestAnswers([answer("full_name", "provided", { text: "Synthetic Persn" }), answer("date_of_birth", "provided", { year: 1984, month: 4 })]);
    const flags = reviewFlags({
      fields: FIELDS,
      answers,
      record: { displayName: "Synthetic Person", dateOfBirth: "1984-03-09", birthPrecision: "day" },
      documents: [{ purpose: "Passport", expiresOn: "2026-01-01" }, { purpose: "Lease", expiresOn: null }],
      today: "2026-10-19",
    });
    expect(flags.map((flag) => flag.kind).sort()).toEqual(["birth", "expired", "name"]);
    expect(normalizeName("Ávila, José")).toBe(normalizeName("jose avila"));
    const same = reviewFlags({ fields: FIELDS, answers: latestAnswers([answer("date_of_birth", "provided", { year: 1984 })]), record: { displayName: "x", dateOfBirth: "1984-03-09", birthPrecision: "day" }, today: "2026-10-19" });
    expect(same).toEqual([]);
  });
});

describe("the matter's Intake tab", () => {
  const input = (overrides: Partial<Parameters<typeof intakePanel>[0]> = {}) => ({
    id: "r1",
    personName: "Synthetic Person",
    title: "Background",
    versionNumber: 2,
    status: "submitted" as const,
    submittedAt: "2026-10-14T09:00:00Z",
    frozenAt: null,
    fields: FIELDS,
    answers: [answer("full_name", "provided", { text: "Synthetic Person" }, "2026-10-14T08:00:00Z"), answer("date_of_birth", "provided", { year: 1984, month: 3 }, "2026-10-14T08:01:00Z")],
    reviewed: new Set<string>(),
    corrections: [],
    record: { displayName: "Synthetic Person", dateOfBirth: null, birthPrecision: null },
    documents: [],
    otherBirths: [],
    ...overrides,
  });

  it("states submitted, awaiting review, with provenance and partial dates marked", () => {
    const panel = intakePanel(input(), () => "Synthetic Person", "America/Toronto", "2026-10-19");
    expect(panel.badge).toEqual({ tone: "rev", label: "Submitted 14 Oct, awaiting review" });
    expect(panel.title).toEqual(["Synthetic Person", "Background v2"]);
    expect(panel.rows[0]).toMatchObject({ question: "Full name", source: ["Synthetic", "v1", "14 Oct"], badge: { tone: "rev", label: "Awaiting review" } });
    expect(panel.rows[1].answer).toBe("March 1984 (partial date)");
  });

  it("states reviewed and frozen, shows a correction's number, and a draft's progress", () => {
    const first = input();
    const reviewed = intakePanel({ ...first, reviewed: new Set(first.answers.map((row) => row.id)) }, () => "X", "UTC", "2026-10-19");
    expect(reviewed.badge).toEqual({ tone: "ok", label: "Reviewed" });
    const corrected = answer("full_name", "provided", { text: "Synthetic Person" }, "2026-10-15T08:00:00Z");
    const panel = intakePanel(
      { ...first, answers: [...first.answers, corrected], frozenAt: "2026-10-16T00:00:00Z", corrections: [{ number: 7, fieldKey: "full_name", answerId: corrected.id, description: null, createdAt: corrected.createdAt }, { number: 8, fieldKey: null, answerId: null, description: "Trip dates are wrong", createdAt: corrected.createdAt }] },
      () => "Synthetic Person",
      "UTC",
      "2026-10-19",
    );
    expect(panel.badge.label).toBe("Snapshot frozen 16 Oct");
    expect(panel.rows.find((row) => row.key === "full_name")?.source).toEqual(["Synthetic", "v2", "15 Oct", "CR-0007"]);
    expect(panel.rows.find((row) => row.key === "cr:8")).toMatchObject({ question: "Something else (CR-0008)", answer: "Trip dates are wrong", answerId: null });
    const draft = intakePanel({ ...first, status: "draft", submittedAt: null }, () => "X", "UTC", "2026-10-19");
    expect(draft.badge).toEqual({ tone: "rev", label: "In progress, 2 of 5" });
    expect(draft.rows.every((row) => row.answerId === null)).toBe(true);
  });

  it("offers only forms in effect, latest published version", () => {
    expect(
      publishedForms(
        [
          { id: "1", stable_key: "a", title: "A", version_number: 1, status: "superseded", effective_on: "2026-01-01" },
          { id: "2", stable_key: "a", title: "A", version_number: 2, status: "published", effective_on: "2026-10-01" },
          { id: "3", stable_key: "b", title: "B", version_number: 1, status: "published", effective_on: "2026-12-01" },
          { id: "4", stable_key: "c", title: "C", version_number: 1, status: "draft", effective_on: null },
        ],
        "2026-10-19",
      ),
    ).toEqual([{ id: "2", label: "A · v2" }]);
  });
});

describe("portal cards, tasks and notifications", () => {
  it("lists forms with their progress and due date", () => {
    const cards = intakeCards(
      [
        { responseId: "r1", matterId: "m", title: "Background", versionNumber: 1, status: "draft", frozen: false, submittedAt: null, updatedAt: "", version: 1, fields: FIELDS, answers: [], reviewed: [], dueOn: "2026-10-23", message: null, isSample: false, corrections: [] },
      ],
      "UTC",
    );
    expect(cards[0]).toMatchObject({ title: "Background", percent: 0, dueOn: "2026-10-23", line: "Five questions. Your answers save as you go." });
  });

  it("puts an intake task in To do with Resume, and a submitted one in Done", () => {
    const groups = taskCards(
      [
        { id: "t1", title: "Complete Background", status: "open", dueOn: "2026-10-23", completedAt: null, blockerNote: null, intakeResponseId: "r1" },
        { id: "t2", title: "Complete Travel", status: "done", dueOn: null, completedAt: "2026-10-12T10:00:00Z", blockerNote: null, intakeResponseId: "r2" },
      ],
      "Synthetic Firm",
      "UTC",
    );
    expect(groups.todo[0]).toMatchObject({ due: "Fri 23 Oct", href: "/portal/intake?response=r1", action: "Resume" });
    expect(groups.done[0]).toMatchObject({ done: true, line: "Done 12 Oct.", action: "View" });
  });

  it("names a submitted form and a correction in Sheet > Notifications", () => {
    const base = { id: "n1", occurred_at: "2026-10-19T10:00:00Z", matter_id: "m1", actor_name: "Synthetic Person", subject: "Background", detail: null, href: "/sheet/matters/m1?tab=intake", read: false };
    expect(notificationParts({ ...base, kind: "intake_submitted" }, () => "NL-1")).toEqual(["Synthetic sent ", { b: "Background" }, " on ", { b: "NL-1" }]);
    expect(notificationParts({ ...base, kind: "intake_correction", detail: "CR-0001" }, () => "NL-1")).toEqual(["Synthetic asked for a correction to ", { b: "Background" }, " (CR-0001)"]);
  });

  it("says a database refusal in plain words", () => {
    expect(intakeError("intake version conflict")).toBe("These answers changed somewhere else.");
    expect(intakeError("an approximate date needs a note and is not stored as a full date")).toBe("Add at least the year, even a rough one.");
  });
});
