import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { MatterIntake } from "@/components/sheet/designer/matter-intake";
import { IntakeForm } from "@/components/portal/intake-live";
import type { AnswerVersion } from "@/modules/intake/present";
import type { PortalIntakeForm } from "@/modules/intake/portal-load";
import type { PortalViewer } from "@/modules/portal/load";
import type { IntakeField } from "@/modules/sheet/intake-builder-present";
import { intakePanel } from "@/modules/sheet/matter-intake-present";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => undefined, replace: () => undefined }) }));

// INT-04 (#177): answers reused from the person's earlier matter, on the staff Intake tab and in
// the client's portal form. Synthetic records only.

const FIELDS: IntakeField[] = [
  { key: "full_name", labels: { en: "Full name" }, type: "text", required: true },
  { key: "city", labels: { en: "City of birth" }, type: "text" },
];

const answer = (id: string, fieldKey: string, text: string): AnswerVersion => ({ id, fieldKey, presence: "provided", value: { text }, raw: { text }, createdAt: "2026-10-20T09:00:00Z", createdBy: "u-staff" });

const who = (id: string | null) => (id === "u-staff" ? "Dana Staff" : "Someone");

const draft = {
  id: "r2",
  personName: "Casey Client",
  title: "Background",
  versionNumber: 1,
  status: "draft" as const,
  submittedAt: null,
  frozenAt: null,
  fields: FIELDS,
  answers: [answer("a1", "full_name", "Casey Client"), answer("a2", "city", "Lagos")],
  reviewed: new Set<string>(),
  corrections: [],
  record: null,
  documents: [],
  otherBirths: [],
  reviews: new Map(),
  reuses: [
    { answerId: "a1", status: "needs_reconfirmation" as const, confirmedAt: null, originRef: "ON-2026-0002" },
    { answerId: "a2", status: "confirmed" as const, confirmedAt: "2026-10-21T10:30:00Z", originRef: null },
  ],
  earlierForms: true,
};

describe("reused facts on the staff Intake tab", () => {
  it("marks each copied answer with its origin and whether the client has confirmed it", () => {
    const panel = intakePanel(draft, who, "UTC", "2026-10-24");
    expect(panel.rows.map((row) => [row.key, row.badge.label, row.source.at(-1)])).toEqual([
      ["full_name", "Needs client reconfirmation", "Reused from ON-2026-0002"],
      ["city", "Client confirmed", "Reused from an earlier matter"],
    ]);
    expect(panel.rows[0].provenance?.source).toBe("Reused from ON-2026-0002: an answer reviewed there. The client hasn’t confirmed it yet.");
    expect(panel.rows[1].provenance?.source).toBe("Reused from an earlier matter: an answer reviewed there. The client confirmed it 21 Oct 10:30.");
    expect(panel.sections.at(-1)).toEqual({ label: "Reused, client to confirm", badge: { tone: "rev", label: "1" } });
    // No Mark reviewed on a draft: staff review once the client sends the form.
    expect(panel.rows.every((row) => row.answerId === null)).toBe(true);
    expect(panel.reuse).toBe(true);
  });

  it("offers Reuse approved facts only on a draft whose person sent a form on another matter", () => {
    expect(intakePanel({ ...draft, earlierForms: false }, who, "UTC", "2026-10-24").reuse).toBe(false);
    expect(intakePanel({ ...draft, status: "submitted", submittedAt: "2026-10-22T09:00:00Z" }, who, "UTC", "2026-10-24").reuse).toBe(false);
    const panel = intakePanel(draft, who, "UTC", "2026-10-24");
    const html = renderToStaticMarkup(createElement(MatterIntake, { data: { organizationId: "o1", panels: [panel], reviewer: true, send: null, note: "" } }));
    expect(html).toContain('data-intake-reuse="r2" data-org="o1"');
    expect(html).toContain("Reuse approved facts");
    const viewer = renderToStaticMarkup(createElement(MatterIntake, { data: { organizationId: "o1", panels: [panel], reviewer: false, send: null, note: "" } }));
    expect(viewer).not.toContain("data-intake-reuse");
  });
});

const VIEWER = {
  organizationId: "00000000-0000-4000-8000-00000000000a",
  organizationName: "Amara",
  organizationSlug: "example-firm",
  timezone: "UTC",
  role: "client",
  person: { id: "00000000-0000-4000-8000-0000000000p1", displayName: "Casey Client", email: null, phone: null, isMinor: false, role: "applicant" },
  matters: [],
  people: [],
  grants: [],
  shares: [],
  prefs: null,
  sections: [],
} satisfies PortalViewer;

const FORM: PortalIntakeForm = {
  responseId: "00000000-0000-4000-8000-0000000000r2",
  matterId: "00000000-0000-4000-8000-0000000000m2",
  title: "Background",
  versionNumber: 1,
  status: "draft",
  frozen: false,
  submittedAt: null,
  updatedAt: "2026-10-20T09:00:00Z",
  version: 3,
  fields: FIELDS,
  answers: [answer("a1", "full_name", "Casey Client"), answer("a2", "city", "Lagos")],
  reviewed: [],
  dueOn: null,
  message: null,
  isSample: false,
  corrections: [],
  reuses: [
    { id: "f1", fieldKey: "full_name", answerId: "a1", status: "needs_reconfirmation", originRef: "ON-2026-0002" },
    { id: "f2", fieldKey: "city", answerId: "a2", status: "confirmed", originRef: "ON-2026-0002" },
  ],
};

describe("reused facts in the client's portal form", () => {
  it("asks the client to confirm each copied answer, and holds Send until they do", () => {
    const html = renderToStaticMarkup(createElement(IntakeForm, { viewer: VIEWER, form: FORM }));
    expect(html).toContain("<b>Answers from your earlier matter</b>Amara filled 1 answer from what you told them before (ON-2026-0002).");
    expect(html).toContain('<span class="bd rev"><i></i>From your earlier matter</span> Casey Client');
    expect(html.match(/>Confirm<\/button>/g)).toHaveLength(1);
    expect(html).toContain("Confirm or change 1 answer from your earlier matter first");
    expect(html).toMatch(/aria-disabled="true" aria-describedby="w2"[^>]*>Send answers to Amara/);
  });

  it("shows nothing extra when every copied answer is settled", () => {
    const settled = { ...FORM, reuses: FORM.reuses?.map((reuse) => ({ ...reuse, status: "confirmed" as const })) };
    const html = renderToStaticMarkup(createElement(IntakeForm, { viewer: VIEWER, form: settled }));
    expect(html).not.toContain("From your earlier matter");
    expect(html).not.toContain(">Confirm</button>");
    expect(html).not.toContain('aria-disabled="true"');
    // A copy the client already changed (a newer answer) is not asked about either.
    const changed = { ...FORM, answers: [...FORM.answers, { ...answer("a3", "full_name", "Casey A. Client"), createdAt: "2026-10-22T09:00:00Z" }] };
    expect(renderToStaticMarkup(createElement(IntakeForm, { viewer: VIEWER, form: changed }))).not.toContain(">Confirm</button>");
  });
});
