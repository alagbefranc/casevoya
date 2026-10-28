import { createHash } from "node:crypto";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { MatterSubmissions } from "@/components/sheet/designer/matter-government";
import { SubmissionChecklistDialogs } from "@/components/sheet/designer/matter-submissions-checklist";
import { handoffBadge } from "@/modules/government/present";
import { buildSubmissions, type GovernmentContext, type GovernmentRecords, type HandoffRow } from "@/modules/sheet/government-present";
import { buildSubmissionChecklist, type ChecklistInput } from "@/modules/sheet/matter-submissions-present";
import { blockedWhy, channelName, checklistError, readChecklist, type GateRow, type RequirementRow } from "@/modules/submissions/present";
import { federalOfficialUrl, snapshotOfficialPage } from "@/modules/submissions/official-page";

/**
 * GOV-01 and GOV-03 presentation: the Submission checklist card shows each gate the database
 * returned with its live status and a link; official steps carry their source; Record submission
 * stays closed while a gate blocks; the manifest lists each pinned file with its hash.
 * Synthetic values only (no IRCC content).
 */

const gates = (over: Partial<Record<string, Partial<GateRow>>> = {}): GateRow[] =>
  (
    [
      { key: "representation", state: "ok", since: "2026-10-01" },
      { key: "package", state: "blocked", released: false, pinned: false, candidates: 3, changed: 0 },
      { key: "deadlines", state: "ok", tentative: 0 },
      { key: "signatures", state: "blocked", waiting: 1, signed: true },
      { key: "fees", state: "blocked", fee_lines: 0 },
      { key: "outside_steps", state: "blocked", total: 1, done: 0 },
    ] as GateRow[]
  ).map((gate) => ({ ...gate, ...(over[gate.key] ?? {}) }) as GateRow);

const requirement = (over: Partial<RequirementRow>): RequirementRow => ({
  id: "r1",
  program_key: null,
  channel: "online_portal",
  kind: "outside_step",
  label: "Synthetic step as worded on the page",
  source_url: "https://www.canada.ca/en/synthetic-test-page.html#synthetic-section",
  source_section: null,
  form_number: "IMM 0000",
  form_modified_on: "2026-09-01",
  checked_on: "2026-10-20",
  current_to: null,
  snapshot_sha256: "c".repeat(64),
  status: "approved",
  reviewed_by_membership_id: "m-consultant",
  reviewed_at: "2026-10-20T15:00:00Z",
  review_note: null,
  version: 2,
  ...over,
});

function input(over: Partial<ChecklistInput> = {}): ChecklistInput {
  return {
    organizationId: "org",
    matterId: "matter",
    role: "case_manager",
    licensed: false,
    timezone: "America/Toronto",
    today: "2026-10-24",
    memberName: (id) => (id === "m-owner" ? "Olivia Owner" : id ? "Daniel Ruiz" : "Unassigned"),
    state: { handoff_id: "h1", channel: "online_portal", program_key: null, gates: gates(), blocked: ["package", "signatures", "fees", "outside_steps"] },
    requirements: [requirement({}), requirement({ id: "r2", kind: "channel_name", label: "Synthetic portal name", form_number: null, form_modified_on: null })],
    events: [],
    manifest: null,
    ...over,
  };
}

describe("GOV-01 Submission checklist card", () => {
  it("shows every gate with its live status and where it is fixed", () => {
    const { card } = buildSubmissionChecklist(input());
    expect(card.gates?.map((gate) => [gate.key, gate.badge.label])).toEqual([
      ["representation", "Done"],
      ["package", "Blocking"],
      ["deadlines", "Done"],
      ["signatures", "Blocking"],
      ["fees", "Blocking"],
      ["outside_steps", "Blocking"],
    ]);
    expect(card.badge).toEqual({ tone: "bad", label: "4 gates blocking" });
    expect(card.gates?.[0].detail).toBe("Authority on file, effective 1 Oct");
    expect(card.gates?.[0].link).toEqual({ href: "/sheet/agreements?tab=authority", label: "Representation authority" });
    expect(card.gates?.[1].detail).toBe("Not released. A licensed consultant’s sign-off pins 3 stored files with their SHA-256");
    expect(card.gates?.[3].detail).toBe("1 agreement is waiting for a signature");
    const html = renderToStaticMarkup(createElement(MatterSubmissions, { data: { package: null, records: [], record: null, earlier: [], checklist: card } }));
    expect(html).toContain("Submission checklist");
    expect(html).toContain("Package version released");
    expect(html).toContain('href="/sheet/matters/matter?tab=tasks"');
  });

  it("lists the approved outside steps for the channel with source, form, dates and snapshot hash, tickable by staff", () => {
    const { card } = buildSubmissionChecklist(input());
    expect(card.channel).toMatchObject({ name: "Synthetic portal name", note: null });
    expect(card.channel?.source?.href).toBe("https://www.canada.ca/en/synthetic-test-page.html#synthetic-section");
    expect(card.steps).toHaveLength(1);
    expect(card.steps[0].source.facts).toEqual(["IMM 0000, date modified 1 Sep", "checked 20 Oct", "snapshot sha256 cccc…cccc"]);
    expect(card.steps[0].wire).toMatchObject({ "data-sub": "tick", "data-handoff": "h1", "data-requirement": "r1", "data-ticked": "true" });
    const done = buildSubmissionChecklist(
      input({ events: [{ kind: "outside_step", item_key: "r1", ticked: true, note: null, membership_id: "m-owner", created_at: "2026-10-24T14:00:00Z" }] }),
    ).card;
    expect(done.steps[0]).toMatchObject({ done: true, by: "Done by Olivia Owner, 24 Oct" });
    expect(done.steps[0].wire).toMatchObject({ "data-ticked": "false" });
    // A step for another channel never shows; a finance user can't tick.
    expect(buildSubmissionChecklist(input({ requirements: [requirement({ channel: "paper" })] })).card.steps).toEqual([]);
    expect(buildSubmissionChecklist(input({ role: "finance_user" })).card.steps[0].wire).toBeNull();
    const html = renderToStaticMarkup(createElement(MatterSubmissions, { data: { package: null, records: [], record: null, earlier: [], checklist: card } }));
    expect(html).toContain('target="_blank"');
    expect(html).toContain("www.canada.ca/en/synthetic-test-page.html#synthetic-section");
  });

  it("says plainly when no official steps or channel name are captured, and never invents one", () => {
    const { card } = buildSubmissionChecklist(input({ requirements: [] }));
    expect(card.steps).toEqual([]);
    expect(card.stepsEmpty).toContain("No official steps for this program and channel are approved yet");
    expect(card.channel).toMatchObject({ name: "Online portal", source: null, note: "IRCC’s official name for this channel isn’t captured yet" });
    // A pending entry is listed for review, not as a step.
    const pending = buildSubmissionChecklist(input({ requirements: [requirement({ status: "pending_review" })], licensed: true })).card;
    expect(pending.steps).toEqual([]);
    expect(pending.pending[0].approve).toMatchObject({ "data-sub": "review", "data-id": "r1", "data-version": "2" });
    const unfetched = buildSubmissionChecklist(input({ requirements: [requirement({ status: "pending_review", snapshot_sha256: null })], licensed: true })).card;
    // No snapshot: Approve opens the reviewer's attestation (decided 2026-10-24).
    expect(unfetched.pending[0].approve).toMatchObject({ "data-sub": "attest-open", "data-id": "r1", "data-version": "2" });
    expect(unfetched.pending[0].badge.label).toBe("No page snapshot");
  });

  it("offers the owner an override only for blocking gates other than the package", () => {
    const owner = buildSubmissionChecklist(input({ role: "firm_owner" }));
    expect(owner.card.actions.override).toEqual({ "data-open": "dSubOvr" });
    expect(owner.dialogs.override?.gates.map((gate) => gate.value)).toEqual(["signatures", "fees", "outside_steps"]);
    expect(buildSubmissionChecklist(input()).card.actions.override).toBeNull();
    const html = renderToStaticMarkup(createElement(SubmissionChecklistDialogs, { data: owner.dialogs }));
    expect(html).toContain('id="dSubOvr"');
    expect(html).not.toContain('value="package"');
    const overridden = buildSubmissionChecklist(
      input({
        state: {
          handoff_id: "h1",
          channel: "online_portal",
          program_key: null,
          gates: gates({ signatures: { state: "overridden", override_reason: "Signed on paper", override_by: "m-owner", override_at: "2026-10-24T14:00:00Z" } }),
          blocked: ["package"],
        },
      }),
    ).card;
    expect(overridden.gates?.[3]).toMatchObject({ badge: { tone: "chg", label: "Overridden by owner" }, override: "Owner override: “Signed on paper”, Olivia Owner, 24 Oct" });
  });

  it("never reads an unreadable checklist as all clear", () => {
    expect(readChecklist(null)).toBeNull();
    expect(readChecklist({ gates: [], blocked: [] })).toBeNull();
    const { card } = buildSubmissionChecklist(input({ state: null }));
    expect(card.gates).toBeNull();
    expect(card.badge.label).toBe("Not loaded");
  });

  it("lists the pinned manifest: each file with its SHA-256", () => {
    const { card } = buildSubmissionChecklist(
      input({
        manifest: {
          handoff: { id: "h1", package_label: "Package v3", manifest_sha256: "d".repeat(64), manifest_file_count: 2, manifest_pinned_at: "2026-10-23T15:00:00Z" },
          files: [
            { position: 1, file_name: "form.pdf", file_sha256: "e".repeat(64), review_state: "accepted", byte_size: 2048 },
            { position: 2, file_name: "photo.jpg", file_sha256: null, review_state: "pending", byte_size: 1024 },
          ],
        },
      }),
    );
    expect(card.manifest?.title).toBe("Package manifest, Package v3");
    expect(card.manifest?.hash).toBe("sha256 dddd…dddd");
    expect(card.manifest?.rows).toEqual([
      { name: "form.pdf", hash: "sha256 eeee…eeee", note: "Accepted by the firm" },
      { name: "photo.jpg", hash: "no hash recorded", note: "Not reviewed yet" },
    ]);
  });
});

describe("GOV-01 Record submission and GOV-03 status words", () => {
  const ctx: GovernmentContext = {
    organizationId: "org",
    matterId: "matter",
    stage: "ready_to_submit",
    timezone: "America/Toronto",
    today: "2026-10-24",
    now: new Date("2026-10-24T14:00:00Z"),
    memberName: () => "Amara Osei",
    userName: () => "Daniel Ruiz",
    consultant: "Amara Osei",
    me: "Daniel Ruiz",
    role: "case_manager",
    licensed: false,
    representatives: [{ id: "m-consultant", name: "Amara Osei" }],
  };
  const authorized: HandoffRow = {
    id: "h1",
    package_label: "Package v3",
    package_sha256: null,
    channel: "online_portal",
    status: "authorized",
    signoff_membership_id: "m-consultant",
    signed_off_at: "2026-10-23T15:00:00Z",
    submitted_by_membership_id: null,
    external_reference: null,
    submitted_at: null,
    receipt_version_id: null,
    receipt_locator: null,
    acknowledged_on: null,
    verified_by_membership_id: null,
    verified_at: null,
    cancel_reason: null,
    cancelled_at: null,
    created_by: "u1",
    created_at: "2026-10-22T15:00:00Z",
    version: 3,
    manifest_sha256: "d".repeat(64),
    manifest_file_count: 2,
    manifest_pinned_at: "2026-10-23T15:00:00Z",
  };
  const records: GovernmentRecords = {
    handoffs: [authorized],
    letters: [],
    decisions: [],
    followUps: [],
    steps: [],
    checks: [],
    transitions: [],
    deadlines: [],
    representation: true,
    documents: { total: 2, open: 0 },
    expiring: [],
  };

  it("keeps Record submission closed while a gate blocks, or while the checklist can't be read", () => {
    const blocked = buildSubmissions(records, ctx, { blocked: ["fees"], why: blockedWhy(["fees"]) });
    expect(blocked.tab.record).toBeNull();
    expect(blocked.tab.recordWhy).toBe("Opens when the submission checklist is complete: fee handling confirmed.");
    expect(blocked.dialogs.submit).toBeNull();
    const unknown = buildSubmissions(records, ctx, { blocked: null, why: null });
    expect(unknown.tab.record).toBeNull();
    expect(unknown.tab.recordWhy).toContain("couldn’t load");
    const clear = buildSubmissions(records, ctx, { blocked: [], why: null });
    expect(clear.tab.record).toEqual({ "data-open": "dSubRec" });
  });

  it("names the channel officially when approved and shows the manifest on the record; says Submitted to government only when verified", () => {
    const names = [requirement({ kind: "channel_name", label: "Synthetic portal name" })];
    const submitted = { ...authorized, status: "submission_verified", submitted_at: "2026-10-24T13:00:00Z", external_reference: "SYN-1", acknowledged_on: "2026-10-24" };
    const built = buildSubmissions({ ...records, handoffs: [submitted] }, ctx, { blocked: [], why: null, channelName: (channel) => channelName(channel, names, null).name });
    expect(built.tab.records[0].parts).toContain("Synthetic portal name");
    expect(built.tab.records[0].parts).toContain("manifest 2 files, sha256 dddd…dddd");
    expect(built.tab.records[0].badge).toEqual({ tone: "ok", label: "Submitted to government" });
    expect(handoffBadge("submission_unverified")).toEqual({ tone: "unv", label: "Submission unverified" });
  });

  it("says database refusals in the Sheet's words", () => {
    expect(checklistError("the source must be an official Government of Canada page (canada.ca or gc.ca)")).toContain("canada.ca or a gc.ca site");
    expect(checklistError("that gate cannot be overridden")).toContain("can’t be overridden");
    expect(checklistError("something new")).toBe("That couldn’t be saved.");
  });
});

describe("official page snapshot", () => {
  it("fetches only federal official hosts and hashes the bytes received", async () => {
    expect(federalOfficialUrl("https://www.canada.ca/en/x.html#a")).toBe(true);
    expect(federalOfficialUrl("https://laws-lois.justice.gc.ca/eng/acts/I-2.5/")).toBe(true);
    expect(federalOfficialUrl("http://www.canada.ca/en/x.html")).toBe(false);
    expect(federalOfficialUrl("https://canada.ca.example.com/x")).toBe(false);
    expect(federalOfficialUrl("https://www.ontario.ca/page/x")).toBe(false);
    const bytes = new TextEncoder().encode("synthetic page");
    const ok = await snapshotOfficialPage(
      "https://www.canada.ca/en/x.html#a",
      (async () => ({ ok: true, status: 200, url: "https://www.canada.ca/en/x.html", arrayBuffer: async () => bytes.buffer })) as unknown as typeof fetch,
      () => new Date("2026-10-24T14:00:00Z"),
    );
    expect(ok.snapshot).toEqual({
      sha256: createHash("sha256").update("synthetic page").digest("hex"),
      retrieved_at: "2026-10-24T14:00:00.000Z",
      final_url: "https://www.canada.ca/en/x.html",
      http_status: 200,
    });
    const down = await snapshotOfficialPage("https://www.canada.ca/en/x.html#a", (async () => {
      throw new Error("timeout");
    }) as unknown as typeof fetch);
    expect(down).toEqual({ snapshot: null, reason: "The page couldn’t be reached from Casevoya." });
    const moved = await snapshotOfficialPage(
      "https://www.canada.ca/en/x.html",
      (async () => ({ ok: true, status: 200, url: "https://example.com/x", arrayBuffer: async () => bytes.buffer })) as unknown as typeof fetch,
    );
    expect(moved.snapshot).toBeNull();
  });
});
