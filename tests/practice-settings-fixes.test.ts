import { describe, expect, it } from "vitest";
import { isIsoCountry } from "@/lib/iso-country";
import { privacyCloseProblem } from "@/modules/compliance/checks";
import { complaintSteps, complaintsDialogs, type ComplaintRowData, type ComplaintsContext } from "@/modules/compliance/complaints-present";
import { sealedPdfBytes } from "@/modules/exports/build";
import { continuityProblem, firmDetailChanges, officeInput, sameOffice } from "@/modules/settings/firm-input";
import { orderedRuns, readQuietHours, readReminderDays, runRow, automationsData, type ReminderRun } from "@/modules/sheet/automations-present";
import { excludedWarning, exportState } from "@/modules/sheet/exports-present";
import { builderPage, fieldRow, moveField, newField, previewFields, removeField, type IntakeField } from "@/modules/sheet/intake-builder-present";
import { licenceState, LICENCE_STATE_LABEL } from "@/modules/sheet/licence-state";
import { guessDateOrder, suggestColumns } from "@/modules/sheet/migration-present";
import { consultantOptions } from "@/modules/sheet/new-matter";
import { officesPage } from "@/modules/sheet/settings-firm-present";
import { integrationsData, whatsappDialog } from "@/modules/sheet/settings-integrations-present";
import { invitationRow, memberRow, orderedInvitations, portalInvitationRow, type PendingInvitation, type PortalInvitation } from "@/modules/sheet/staff-present";
import { aiAudit, aiRunRows, aiSettings, aiSources, effectiveSettings, type VoNames, type VoRunRow, type VoViewer } from "@/modules/sheet/vo-present";

const NOW = new Date("2026-10-19T15:00:00Z");
const ZONE = "America/Toronto";

describe("client-file exports", () => {
  it("warns on the page, and marks the row Incomplete, when an export left files out", () => {
    const excluded = [
      { path: "documents/Executed agreement/v1-executed-agreement.pdf", reason: "Not included: the stored file could not be read." },
      { path: "documents/Completion certificate/v1-completion-certificate.pdf", reason: "Not included: the stored file could not be read." },
      { path: "documents/x/v1-big.pdf", reason: "Not included: over this export's size limit. Download it from the matter." },
    ];
    const warning = excludedWarning("CA-2026-0001", excluded);
    expect(warning?.title).toBe("This export of CA-2026-0001 is incomplete: 3 files left out");
    expect(warning?.items).toEqual(["2 × The stored file could not be read", "1 × Over this export's size limit. Download it from the matter"]);
    expect(excludedWarning("CA-2026-0001", [])).toBeNull();
    const row = { status: "ready" as const, expiresAt: "2026-10-20T15:00:00Z", lastDownloadedOn: null, failureReason: null, expiresLabel: "20 Oct 11:00" };
    expect(exportState({ ...row, excludedCount: 12 }, NOW)).toEqual({ tone: "chg", label: "Incomplete", detail: "12 files left out, link open until 20 Oct 11:00" });
    expect(exportState({ ...row, excludedCount: 0 }, NOW)).toEqual({ tone: "ok", label: "Ready", detail: "link open until 20 Oct 11:00" });
  });

  it("reads executed agreements and certificates from their envelope, where the sealed bytes live", async () => {
    const pdf = "\\x255044462d312e37";
    const calls: string[] = [];
    const chain = {
      select: () => chain,
      eq: (column: string, value: string) => (calls.push(`${column}=${value}`), chain),
      or: (filter: string) => {
        calls.push(filter);
        return Promise.resolve({
          data: [{ sealed_document_version_id: "v-sealed", certificate_document_version_id: "v-cert", sealed_pdf: pdf, certificate_pdf: "not a pdf" }],
        });
      },
    };
    const service = { from: (table: string) => (calls.push(table), chain) } as unknown as Parameters<typeof sealedPdfBytes>[0];
    const found = await sealedPdfBytes(service, "org-1", ["v-sealed", "v-cert", "v-other"]);
    expect([...found.keys()]).toEqual(["v-sealed"]);
    expect(found.get("v-sealed")?.slice(0, 4)).toEqual(Uint8Array.from([0x25, 0x50, 0x44, 0x46]));
    expect(calls).toEqual(["signature_envelopes", "organization_id=org-1", "sealed_document_version_id.in.(v-sealed,v-cert,v-other),certificate_document_version_id.in.(v-sealed,v-cert,v-other)"]);
    expect((await sealedPdfBytes(service, "org-1", [])).size).toBe(0);
  });
});

describe("privacy requests and complaints", () => {
  it("checks Close request before any step-up", () => {
    const blank = { outcome: "", refusalReason: "", evidence: "", deliveredBy: "", note: "" };
    expect(privacyCloseProblem(blank)?.field).toBe("pcO");
    expect(privacyCloseProblem({ ...blank, outcome: "refused" })?.field).toBe("pcR");
    expect(privacyCloseProblem({ ...blank, outcome: "fulfilled" })?.field).toBe("pcE");
    expect(privacyCloseProblem({ ...blank, outcome: "fulfilled", evidence: "Sent the file", deliveredBy: "ab" })?.field).toBe("pcD");
    expect(privacyCloseProblem({ ...blank, outcome: "fulfilled", evidence: "Sent the file", note: "x" })?.field).toBe("pcN");
    expect(privacyCloseProblem({ ...blank, kind: "deletion", outcome: "fulfilled", evidence: "Done" })?.field).toBe("pcO");
    expect(privacyCloseProblem({ ...blank, outcome: "withdrawn" })).toBeNull();
    expect(privacyCloseProblem({ ...blank, outcome: "fulfilled", evidence: "Sent the file by portal" })).toBeNull();
  });

  const CTX: ComplaintsContext = {
    organizationId: "org",
    firmName: "Synthetic Firm",
    today: "2026-10-19",
    isOwner: true,
    isHandler: true,
    userName: () => "Dana Lee",
    memberName: () => "Dana Lee",
    matterRef: () => "—",
    visibleTo: [],
    escalation: null,
    selectedId: undefined,
  };
  const ROW: ComplaintRowData = {
    id: "c1",
    reference: "CP-001",
    complainant_name: "Ana Diaz",
    matter_id: null,
    category: "fees_billing",
    channel: "phone",
    issue: "Fees",
    received_on: "2026-10-10",
    ack_due_on: null,
    response_due_on: null,
    assignee_membership_id: "m1",
    acknowledged_on: "2026-10-11",
    ack_note: "Called back",
    reviewed_at: "2026-10-12T12:00:00Z",
    reviewed_by: "u1",
    evidence_note: "Quote and two emails",
    response_sent_on: "2026-10-13",
    response_note: "Explained the fee",
    resolved_on: null,
    resolution: null,
  };

  it("shows each step's own note: acknowledgement, review evidence and the response", () => {
    const steps = complaintSteps(ROW, CTX);
    expect(steps[1].small).toEqual(["11 Oct", "Called back"]);
    expect(steps[2].small).toEqual(["Dana Lee", "Evidence reviewed: Quote and two emails"]);
    expect(steps[3].small).toEqual(["13 Oct", "Explained the fee"]);
  });

  it("says why Who handles complaints is empty instead of showing an empty list", () => {
    const base = { ctx: CTX, selectedRow: null, people: [], matters: [], assignable: [], me: null, handlers: [], settings: { ackDays: null, responseDays: null, escalation: null } };
    expect(complaintsDialogs({ ...base, staff: [] }).settings?.staff).toEqual([["", "No other active staff yet. Invite staff in Settings › Staff, then choose them here."]]);
    expect(complaintsDialogs({ ...base, staff: [["m2", "Sam (Case manager)"]] }).settings?.staff).toEqual([["m2", "Sam (Case manager)"]]);
  });
});

describe("Settings: offices and the continuity contact", () => {
  it("accepts only ISO 3166-1 alpha-2 countries", () => {
    expect(isIsoCountry("CA")).toBe(true);
    expect(isIsoCountry("XX")).toBe(false);
    const office = { label: "Main", addressLine: "1 Main St", locality: "Toronto" };
    expect(officeInput({ ...office, countryCode: "xx" })).toEqual({ error: "Enter the country as its two-letter ISO code, like CA, US or GB." });
    expect(officeInput({ ...office, countryCode: "us" })).toMatchObject({ countryCode: "US" });
  });

  it("knows the same office saved twice, ignoring case and spacing", () => {
    const saved = { label: "Main office", address_line: "1 Main St", locality: "Toronto" };
    expect(sameOffice(saved, { label: " main  OFFICE", addressLine: "1 main st", locality: "toronto" })).toBe(true);
    expect(sameOffice(saved, { label: "Main office", addressLine: "2 Main St", locality: "Toronto" })).toBe(false);
  });

  it("doesn't say 'main office' twice", () => {
    const row = (label: string) => ({ id: "o1", label, address_line: "1 Main St", locality: "Toronto", region: "ON", postal_code: null, country_code: "CA", timezone: null, is_primary: true });
    expect(officesPage([row("Main office")], ZONE, true).rows[0].label).toBe("Main office");
    expect(officesPage([row("Toronto")], ZONE, true).rows[0].label).toBe("Toronto (main office)");
  });

  it("needs a continuity contact's name and email together, or neither", () => {
    expect(continuityProblem("Grace Lin", "")).toBe("Add the continuity contact’s email, or clear both.");
    expect(continuityProblem("", "grace@example.test")).toBe("Add the continuity contact’s name, or clear both.");
    expect(continuityProblem("", "")).toBeNull();
    expect(continuityProblem("Grace Lin", "grace@example.test")).toBeNull();
    expect(continuityProblem(undefined, undefined)).toBeNull();
    expect(firmDetailChanges({ continuity_contact_name: "Grace Lin", continuity_contact_email: "" })).toEqual({ error: "Add the continuity contact’s email, or clear both." });
  });
});

describe("People and invitations", () => {
  const INVITE: PendingInvitation = { id: "i1", email: "sam@example.test", role: "case_manager", expiresAt: "2026-10-26T15:00:00Z", createdAt: "2026-10-19T15:00:00Z" };

  it("keeps a revoked invitation on the list, greyed, with nothing to do", () => {
    const row = invitationRow({ ...INVITE, revokedAt: "2026-10-19T16:00:00Z" }, NOW, ZONE);
    expect(row).toMatchObject({ state: { tone: "gr", label: "Revoked 19 Oct" }, action: { kind: "none" }, muted: true });
    // Replaced by a resend: the new one shows, not the revoked one.
    const replaced = orderedInvitations([{ ...INVITE, revokedAt: "2026-10-19T16:00:00Z" }, { ...INVITE, id: "i2", createdAt: "2026-10-19T16:00:00Z" }], NOW);
    expect(replaced.map((row) => row.id)).toEqual(["i2"]);
    expect(orderedInvitations([{ ...INVITE, revokedAt: "2026-10-19T16:00:00Z" }], NOW).map((row) => row.id)).toEqual(["i1"]);
  });

  it("gives every team member's More a real place: Settings › Team and seats", () => {
    const row = memberRow({ membershipId: "m1", name: "Dana Lee", email: "dana@example.test", role: "firm_owner", status: "active", licensed: true, twoStep: true });
    expect(row.action).toEqual({ kind: "more", go: "/sheet/settings?tab=team&dlg=dlgMem&member=m1", title: "Change role or access in Settings › Team and seats" });
  });

  it("shows client portal invitations with their state, revoke and resend", () => {
    const base: PortalInvitation = {
      id: "p1",
      personName: "Olena Sharma",
      email: "olena@example.test",
      role: "adult_dependant",
      matterReference: "CA-2026-0142",
      expiresAt: "2026-10-23T15:00:00Z",
      createdAt: "2026-10-16T15:00:00Z",
      openedAt: null,
      consumedAt: null,
      revokedAt: null,
      declinedAt: null,
    };
    expect(portalInvitationRow(base, "org", NOW, ZONE)).toMatchObject({
      name: "Olena Sharma",
      email: { left: "Adult dependant", right: "CA-2026-0142" },
      state: { tone: "rev", label: "Sent", detail: "expires 23 Oct" },
      action: { kind: "revoke", invitationId: "p1", portal: true, organizationId: "org" },
    });
    expect(portalInvitationRow({ ...base, openedAt: "2026-10-17T15:00:00Z" }, "org", NOW, ZONE).state).toEqual({ tone: "unv", label: "Opened", detail: "not finished" });
    expect(portalInvitationRow({ ...base, consumedAt: "2026-10-18T15:00:00Z" }, "org", NOW, ZONE)).toMatchObject({ state: { tone: "ok", label: "Accepted" }, action: { kind: "none" } });
    expect(portalInvitationRow({ ...base, revokedAt: "2026-10-18T15:00:00Z" }, "org", NOW, ZONE)).toMatchObject({ muted: true, state: { label: "Revoked 18 Oct" } });
    expect(portalInvitationRow({ ...base, expiresAt: "2026-10-18T15:00:00Z" }, "org", NOW, ZONE).action).toMatchObject({ kind: "resend", portal: true });
  });
});

describe("licence words", () => {
  it("uses one status set: the owner counts as licensed; Verified, Needs review, Declared", () => {
    expect(licenceState({ status: "verified" })).toBe("verified");
    expect(licenceState({ status: "declared", latestResult: "needs_review" })).toBe("needs_review");
    expect(licenceState({ status: "declared" })).toBe("declared");
    expect(licenceState({ status: "suspended" })).toBe("blocked");
    expect(licenceState({ status: null, isOwner: true })).toBe("owner");
    expect(LICENCE_STATE_LABEL.needs_review).toBe("Needs review");
    const options = consultantOptions(
      [
        { id: "owner", name: "Dana Lee" },
        { id: "c1", name: "Sam Park" },
      ],
      new Map([["c1", "declared"]]),
    );
    expect(options).toEqual([
      { value: "owner", label: "Dana Lee" },
      { value: "c1", label: "Sam Park (licence declared)" },
    ]);
    expect(JSON.stringify(options)).not.toMatch(/can’t sign|pending/);
  });
});

describe("Vo and AI", () => {
  const VIEWER: VoViewer = { organizationId: "org", firmName: "Synthetic Firm", isOwner: true, sampleMode: false, agentReady: true, timeZone: ZONE };
  const NAMES: VoNames = { matter: () => "Ana Diaz", reference: () => "CA-2026-0001", person: () => "Dana Lee" };

  it("shows every switch under the firm switch off and disabled while Vo is off for the firm", () => {
    const off = aiSettings(VIEWER, effectiveSettings({ enabled: false, reply_drafts: true }, false));
    expect(off.firm[0]).toMatchObject({ id: "swVoFirm", on: false });
    expect(off.firm[0].disabled).toBeUndefined();
    expect(off.firm.slice(1).every((item) => item.on === false && item.disabled === "Vo is off for the whole firm. Turn it on first.")).toBe(true);
    expect(off.categories.every((item) => item.disabled)).toBe(true);
    const on = aiSettings(VIEWER, effectiveSettings({ enabled: true, reply_drafts: true }, false));
    expect(on.firm.some((item) => item.disabled)).toBe(false);
    expect(JSON.stringify(on)).not.toMatch(/\(AI-\d\d/);
  });

  it("shows a source's real check date and links its name", () => {
    const [checked] = aiSources(
      [{ title: "IRCC page", publisher: "IRCC", reviewStatus: "unverified", changeState: "unchanged", nextReviewAt: null, canonicalUrl: "https://www.canada.ca/x", lastCheckedAt: "2026-10-18T12:00:00Z", lastResult: "success" }],
      VIEWER,
    ).rows;
    expect(checked.state).toEqual({ tone: "unv", label: "Checked", detail: "18 Oct, not reviewed yet" });
    expect(checked.href).toBe("https://www.canada.ca/x");
    const [never] = aiSources([{ title: null, publisher: "IRCC", reviewStatus: "unverified", changeState: "unchanged", nextReviewAt: null, canonicalUrl: "http://x" }], VIEWER).rows;
    expect(never.state.label).toBe("Not checked");
    expect(never.href).toBeUndefined();
  });

  it("puts document readings in the draft audit and links every row to its draft", () => {
    const audit = aiAudit(
      [
        {
          id: "d1", runId: "r1", kind: "message_reply", title: "Reply to Ana", body: "", sources: [], matterId: "m1", threadId: "t1", status: "sent", edited: false,
          needsRule: false, isSample: false, createdAt: "2026-10-18T12:00:00Z", reviewedAt: "2026-10-18T13:00:00Z", reviewedBy: "u1", latencyMs: null,
        },
      ],
      NAMES,
      VIEWER,
      [{ id: "v1", matterId: "m1", title: "Passport reading", status: "reviewed", reviewedBy: "u1", reviewedAt: "2026-10-19T13:00:00Z", createdAt: "2026-10-19T12:00:00Z" }],
    );
    expect(audit.rows.map((row) => row.draft)).toEqual(["Passport reading", "Reply to Ana"]);
    expect(audit.rows[0]).toMatchObject({ result: { label: "Reviewed" }, href: "/sheet/matters/m1?tab=documents&vo=v1" });
    expect(audit.rows[1].href).toBe("/sheet/matters/m1?tab=messages&vo=d1");
  });

  it("links a run's matter reference", () => {
    const run: VoRunRow = {
      id: "r1", kind: "ask", result: "answered", failure: null, model: "m", promptVersion: "p1", tools: [], sourceCount: 2, userId: "u1", matterId: "m1",
      createdAt: "2026-10-19T12:00:00Z", costUsd: null, useful: null, draft: null, versionId: null,
    } as unknown as VoRunRow;
    expect(aiRunRows([run], NAMES, VIEWER)[0].matterHref).toBe("/sheet/matters/m1");
  });
});

describe("Automations", () => {
  it("reads reminder days and quiet hours the way the database checks them", () => {
    expect(readReminderDays("14, 7, 3, 1")).toEqual({ days: [14, 7, 3, 1] });
    expect(readReminderDays("1 7 7 30")).toEqual({ days: [30, 7, 1] });
    expect(readReminderDays("")).toMatchObject({ error: expect.stringContaining("at least one") });
    expect(readReminderDays("0")).toMatchObject({ error: expect.stringContaining("between 1 and 365") });
    expect(readReminderDays("two")).toMatchObject({ error: expect.any(String) });
    expect(readQuietHours("21:00", "08:00")).toEqual({ start: "21:00", end: "08:00" });
    expect(readQuietHours("", "")).toEqual({ start: null, end: null });
    expect(readQuietHours("21:00", "")).toMatchObject({ error: expect.any(String) });
  });

  const RUN: ReminderRun = {
    status: "sent", kind: "offset", offsetDays: 7, scheduledFor: "2026-10-12T13:00:00Z", sentAt: "2026-10-12T13:00:05Z", createdAt: "2026-10-01T13:00:00Z",
    matterName: "Ana Diaz", reference: "CA-1", deadline: { label: "Medical exam", dueOn: "2026-10-19" }, matterId: "m1",
  };

  it("says which deadline a reminder is for, and lists runs newest first by when they happened", () => {
    expect(runRow(RUN, NOW, ZONE).note).toEqual({ left: "Medical exam, due 19 Oct: reminder 7 days before", right: "sent to the mail queue" });
    const later = { ...RUN, status: "pending", sentAt: null, scheduledFor: "2026-10-18T13:00:00Z", createdAt: "2026-10-01T13:00:00Z" };
    const earlier = { ...RUN, sentAt: "2026-10-05T13:00:00Z", createdAt: "2026-10-02T13:00:00Z" };
    expect(orderedRuns([earlier, later, RUN]).map((run) => run.scheduledFor + (run.sentAt ?? ""))).toEqual([later, RUN, earlier].map((run) => run.scheduledFor + (run.sentAt ?? "")));
  });

  it("lets the firm owner open Reminder settings; Delay and the critical exception say they're fixed", () => {
    const owner = automationsData({ tab: "builder", days: [14, 7], firmSet: true, quiet: "21:00–08:00", runs: [], now: NOW, timeZone: ZONE, editable: true });
    expect(owner.settings[0]).toMatchObject({ label: "Reminder days", attrs: { "data-dlg": "dlgAuto" } });
    expect(owner.settings[2]).toEqual({ label: "Delay", value: "None (fixed)" });
    expect(owner.intro).toContain("steps are built in");
    const staff = automationsData({ tab: "builder", days: [14, 7], firmSet: false, quiet: null, runs: [], now: NOW, timeZone: ZONE });
    expect(staff.settings[0].attrs).toBeUndefined();
    expect(staff.settings[0].value).toBe("14 and 7 (proposed)");
  });
});

describe("Intake form builder", () => {
  const field = (key: string, extra: Partial<IntakeField> = {}): IntakeField => ({ key, type: "text", labels: { "en-CA": key }, ...extra });

  it("starts a declaration as required and shows a chip when the sponsor sees a field", () => {
    expect(newField("Declaration", [])?.required).toBe(true);
    expect(newField("Short text", [])?.required).toBe(false);
    expect(fieldRow(field("a", { section_key: "shared_family_record" })).badge).toEqual({ tone: "gr", label: "Sponsor sees it" });
  });

  it("moves and deletes fields, never putting a conditional field before the one it depends on", () => {
    const fields = [field("a"), field("b", { show_when: { field: "a", equals: "yes" } }), field("c")];
    expect(moveField(fields, "c", "up")?.map((item) => item.key)).toEqual(["a", "c", "b"]);
    expect(moveField(fields, "b", "up")).toBeNull();
    expect(moveField(fields, "c", "down")).toBeNull();
    expect(removeField(fields, "a")).toMatchObject({ error: expect.stringContaining("shows only after this one") });
    expect(removeField(fields, "c")).toEqual({ fields: fields.slice(0, 2) });
    expect(removeField([field("a")], "a")).toMatchObject({ error: expect.stringContaining("at least one") });
  });

  it("previews fields as a client sees them, and turns Publish off until there's a draft", () => {
    expect(previewFields([field("a", { required: true, section_key: "shared_family_record" })])).toEqual([
      { key: "a", label: "a", type: "text", ui: undefined, required: true, note: "The sponsor sees this answer" },
    ]);
    const published = { id: "t1", stableKey: "intake", versionNumber: 1, status: "published", title: "Intake", schema: { fields: [field("a")] }, updatedAt: "2026-10-18T12:00:00Z", effectiveOn: "2026-10-18", version: 1 };
    expect(builderPage([published], new Map(), {}, NOW).publishDisabled).toContain("Nothing new to publish");
    expect(builderPage([published, { ...published, id: "t2", versionNumber: 2, status: "draft" }], new Map(), {}, NOW).publishDisabled).toBeNull();
  });
});

describe("Migration import", () => {
  it("treats ISO dates (with or without a time) as year-first and certain", () => {
    expect(guessDateOrder(["1990-05-14", "1988-03-02"])).toEqual({ order: "ymd", certain: true });
    expect(guessDateOrder(["1990-05-14 00:00:00", "", "1988-03-02T00:00:00Z"])).toEqual({ order: "ymd", certain: true });
    expect(guessDateOrder(["14/05/1990", "1988-03-02"])).toEqual({ order: "dmy", certain: true });
    expect(guessDateOrder(["03/04/1990"])).toEqual({ order: "dmy", certain: false });
  });

  it("suggests first and last name as the legal name and its second part", () => {
    expect(suggestColumns(["First name", "Last name", "Email"])).toMatchObject({ name: 0, name_extra: 1, email: 2 });
    expect(suggestColumns(["Full name", "Surname"])).toMatchObject({ name: 0, name_extra: 1 });
  });
});

describe("Integrations", () => {
  const input: Parameters<typeof integrationsData>[0] = {
    organizationId: "org",
    firmSlug: null,
    fromAddress: "notices@casevoya.ca",
    inboundDomain: "in.casevoya.ca",
    isOwner: true,
    composio: { configured: false, enabled: false, acceptedAt: null },
    connections: [],
    busySyncedAt: null,
    stripe: { canSee: false, isOwner: true, account: null },
    whatsapp: { configured: true, status: "none", sandbox: false, phone: null, connectedAt: null, live: null },
    timeZone: ZONE,
  };

  it("names the tab Integrations, and asks for consent naming Zernio and Meta before Connect", () => {
    const dialog = whatsappDialog(input);
    expect(dialog?.lead).toMatch(/Zernio/);
    expect(dialog?.lead).toMatch(/Meta/);
    expect(dialog?.points.map((point) => point.title)).toContain("Zernio carries the messages");
    expect(whatsappDialog({ ...input, isOwner: false })).toBeNull();
    const data = integrationsData(input);
    expect(data.title).toBe("Integrations");
    expect(data.rows.find((row) => row.name === "WhatsApp")?.action?.attrs).toEqual({ "data-dlg": "dlgWhatsApp" });
  });
});
