import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { ContinuityBanner } from "@/components/sheet/designer/continuity-banner";
import { CancelSubscriptionDialog, ContinuityPanel, EndArrangementDialog } from "@/components/sheet/designer/sec-continuity";
import { DeletionDialog, RetentionDeletionPanels } from "@/components/sheet/designer/sec-retention";
import { runDeletionJobs, type RunnerDeps } from "@/modules/retention/runner";
import {
  cancelDialog,
  continuityBanner,
  continuityPanel,
  deletionError,
  policyText,
  readContinuity,
  readDeletionOverview,
  removedText,
  retentionDeletionData,
} from "@/modules/sheet/sec-present";
import { readFirmSubscription, subscriptionPage } from "@/modules/sheet/settings-billing-present";
import { scheduleCancelAtPeriodEnd } from "@/modules/subscription/cancel";

/** SEC-07 and SEC-10: presentation, the deletion runner with fake storage, and the Stripe cancel step with a fake client. */
const ZONE = "America/Toronto";
const ORG = "00000000-0000-4000-8000-000000000001";
const OWNER = "00000000-0000-4000-8000-0000000000aa";

const OVERVIEW = {
  today: "2026-10-25",
  held: 1,
  eligible: [
    { matter_id: "m1", reference: "M-2013-0001", title: "Synthetic Applicant", is_sample: false, closed_on: "2013-01-01", retention_on: "2020-01-01", retention_years: 7, policy_version: 2 },
  ],
  jobs: [
    { id: "j1", matter_id: "m2", reference: "M-2012-0004", status: "running", approved_at: "2026-10-24T15:00:00Z", approved_by: OWNER, item_count: 5, pending: 2, blocked_reason: null, failure_reason: null, finished_at: null },
    { id: "j2", matter_id: "m3", reference: "M-2012-0005", status: "blocked", approved_at: "2026-10-24T15:00:00Z", approved_by: OWNER, item_count: 3, pending: 3, blocked_reason: "Stopped: the matter is under a legal hold.", failure_reason: null, finished_at: "2026-10-24T16:00:00Z" },
    { id: "j3", matter_id: "m4", reference: "M-2012-0006", status: "completed", approved_at: "2026-10-24T15:00:00Z", approved_by: OWNER, item_count: 3, pending: 0 },
  ],
  tombstones: [
    {
      id: "t1",
      matter_id: "m5",
      reference: "M-2011-0002",
      completed_at: "2026-10-24T18:00:00Z",
      approved_by: OWNER,
      approved_at: "2026-10-24T15:00:00Z",
      policy_version: 1,
      retention_years: 6,
      retention_on: "2019-05-01",
      removed: { document_file: 3, export_file: 1, vo_reading: 1, embeddings: 0 },
      kept: [{ kind: "document_file", reason: "Also on another matter: kept until that matter's files are deleted.", count: 1 }],
    },
  ],
};

describe("SEC-07 Settings > Retention: eligible, jobs, tombstones", () => {
  it("labels the period as the firm's own, shows job states and what each tombstone removed and kept", () => {
    const overview = readDeletionOverview(OVERVIEW)!;
    // A completed job is not a job to watch: its tombstone says what happened.
    expect(overview.jobs.map((job) => job.id)).toEqual(["j1", "j2"]);
    const data = retentionDeletionData(overview, { organizationId: ORG, timeZone: ZONE, names: new Map([[OWNER, "Synthetic Owner"]]) });
    expect(data.eligible).toEqual([
      { matterId: "m1", matter: "M-2013-0001 · Synthetic Applicant", closed: "1 Jan 2013", ended: "1 Jan 2020", policy: "Policy R-2: 7 years, set by the firm", sample: false },
    ]);
    expect(data.heldNote).toMatch(/^1 matter is past the retention end but under a legal hold/);
    expect(data.jobs[0]).toMatchObject({ badge: { label: "Removing" }, detail: expect.stringContaining("3 of 5 items done") });
    expect(data.jobs[1]).toMatchObject({ badge: { tone: "bad", label: "Stopped" }, detail: expect.stringContaining("legal hold") });
    expect(data.tombstones[0]).toMatchObject({
      when: "Deleted 24 Oct 2026",
      who: "Approved by Synthetic Owner on 24 Oct 2026",
      policy: "Policy R-1: 6 years, set by the firm, ended 1 May 2019",
      removed: "3 stored files, 1 client-file export, 1 Vo document reading removed",
    });
    expect(data.tombstones[0].kept).toContain("Also on another matter");

    const html = renderToStaticMarkup(createElement(RetentionDeletionPanels, { data, index: 3 }));
    expect(html).toContain('<section class="panel rv" style="--i:3" aria-labelledby="delEH">');
    expect(html).toContain('data-sec-act="open-delete" data-matter="m1" data-matter-label="M-2013-0001 · Synthetic Applicant">Approve deletion</button>');
    expect(html).toContain('<span class="bd chg"><i></i>Removing</span>');
    expect(html).toContain("Casevoya stores no embeddings");
    const dialog = renderToStaticMarkup(createElement(DeletionDialog, { organizationId: ORG }));
    expect(dialog).toMatch(/^<dialog class="dlg" id="dlgDelete"/);
    expect(dialog).toContain('<textarea class="ta" id="delR"');
    expect(dialog).toContain('data-sec-act="approve-delete"');
  });

  it("says plainly when nothing is eligible or nothing was removed, and maps the database's refusals", () => {
    const empty = retentionDeletionData(readDeletionOverview({ today: null, held: 0, eligible: [], jobs: [], tombstones: [] })!, { organizationId: ORG, timeZone: ZONE, names: new Map() });
    const html = renderToStaticMarkup(createElement(RetentionDeletionPanels, { data: empty }));
    expect(html).toContain("No closed matter is past its retention end.");
    expect(html).toContain("No files have been deleted under the retention policy.");
    expect(html).not.toContain("Deletion jobs");
    expect(removedText({ embeddings: 0 })).toBe("Nothing was stored, so nothing was removed");
    expect(policyText(null, null)).toBe("Firm retention period: set by the firm");
    expect(deletionError("not eligible for deletion: the matter is under a legal hold")).toMatch(/legal hold/);
    expect(deletionError("not eligible for deletion: the retention period has not ended")).toMatch(/hasn’t ended/);
    expect(deletionError("only the firm owner can do this")).toBeNull();
    expect(readDeletionOverview({})).toBeNull();
  });
});

describe("SEC-07 the deletion runner (fake storage)", () => {
  function deps(claims: unknown[], overrides: Partial<RunnerDeps> = {}) {
    const removed: string[] = [];
    const recorded: [string, string][] = [];
    const queue = [...claims];
    const base: RunnerDeps = {
      claim: vi.fn(async () => ({ data: queue.shift() ?? null, error: null })),
      ready: vi.fn(async (id: string) => ({ data: id !== "held", error: null })),
      record: vi.fn(async (id: string, outcome: "deleted" | "missing") => {
        recorded.push([id, outcome]);
        return { data: true, error: null };
      }),
      finish: vi.fn(async () => ({ data: "completed", error: null })),
      remove: vi.fn(async (_bucket: string, key: string) => {
        removed.push(key);
        return key.endsWith("gone") ? "missing" : "deleted";
      }),
      ...overrides,
    };
    return { deps: base, removed, recorded };
  }

  it("re-checks before each storage delete, removes, records, and lets the database finish the job", async () => {
    const run = deps([
      {
        job_id: "j1",
        organization_id: ORG,
        items: [
          { id: "a", kind: "document_file", bucket: "documents", storage_key: "org/files/a" },
          { id: "held", kind: "document_file", bucket: "documents", storage_key: "org/files/held" },
          { id: "b", kind: "export_file", bucket: "matter-exports", storage_key: "org/x/gone" },
          { id: "c", kind: "vo_reading", bucket: null, storage_key: null },
        ],
      },
    ]);
    const summary = await runDeletionJobs(run.deps);
    expect(run.removed).toEqual(["org/files/a", "org/x/gone"]);
    expect(run.recorded).toEqual([
      ["a", "deleted"],
      ["b", "missing"],
      ["c", "deleted"],
    ]);
    expect(summary.jobs).toEqual([{ id: "j1", status: "completed", removed: 3, skipped: 1, error: null }]);
  });

  it("stops a job on a storage error without recording it, so the next run resumes; an unknown bucket is never touched", async () => {
    const run = deps(
      [
        { job_id: "j1", organization_id: ORG, items: [{ id: "a", kind: "document_file", bucket: "documents", storage_key: "org/files/a" }] },
        { job_id: "j2", organization_id: ORG, items: [{ id: "z", kind: "document_file", bucket: "firm-logos", storage_key: "org/logo.png" }] },
      ],
      { remove: vi.fn(async () => "error" as const) },
    );
    const summary = await runDeletionJobs(run.deps);
    expect(run.recorded).toEqual([]);
    expect(run.deps.finish).not.toHaveBeenCalled();
    expect(summary.jobs).toEqual([
      { id: "j1", status: "running", removed: 0, skipped: 0, error: "storage delete failed" },
      { id: "j2", status: "running", removed: 0, skipped: 0, error: "unknown bucket" },
    ]);
  });
});

describe("SEC-10 cancellation, export window and banner", () => {
  const ending = { phase: "ending", status: "active", period_end: "2026-11-19T15:00:00Z", cancel_at: "2026-11-19T15:00:00Z", window_days: 90, window_ends_at: "2027-02-17T15:00:00Z", arrangement: null, transfer: null, coverage: { since: "2026-10-25T14:00:00Z", matters: 4, covered: 1, next_matter_id: "m2", next_reference: "M-2026-0002" } };

  it("the banner names the end of the paid period, the window and that nothing is deleted, for every staff member", () => {
    const banner = continuityBanner(readContinuity(ending), ZONE, false)!;
    expect(banner.title).toBe("The subscription ends on 19 Nov 2026");
    expect(banner.body).toContain("until at least 17 Feb 2027");
    expect(banner.body).toContain("Nothing is deleted.");
    expect(banner.href).toBeNull();
    const html = renderToStaticMarkup(createElement(ContinuityBanner, { data: { ...banner, href: "/sheet/settings?tab=billing" } }));
    expect(html).toMatch(/^<div class="alert warn" role="status" data-continuity-banner="1"><svg class="ic" aria-hidden="true"><use href="\/assets\/icons-coreui\/sprite.svg#i-alert"><\/use><\/svg><div><b>The subscription ends on 19 Nov 2026<\/b>/);
    expect(html).toContain('<div class="acts"><a class="btn sm" href="/sheet/settings?tab=billing">Subscription</a></div>');

    const window = continuityBanner(readContinuity({ ...ending, phase: "window", status: "cancelled", cancel_at: null, cancelled_at: "2026-11-19T15:00:00Z" }), ZONE, true)!;
    expect(window.title).toBe("Export window: until 17 Feb 2027");
    expect(window.body).toContain("custodial archive");
    expect(continuityBanner(readContinuity({ phase: "none" }), ZONE, true)).toBeNull();
    expect(continuityBanner(readContinuity({ ...ending, phase: "archived", arrangement: "custodial_archive" }), ZONE, true)).toMatchObject({ tone: "info", title: "This firm is archived" });
  });

  it("the After cancelling panel: dates, the full firm export coverage, the arrangement; owner buttons only for the owner", () => {
    const transfers = [{ id: "x1", receivingFirm: "Receiving Firm", status: "open" }];
    const panel = continuityPanel(readContinuity(ending), { organizationId: ORG, timeZone: ZONE, isOwner: true, transfers })!;
    expect(panel.rows).toEqual([
      ["Paid period ends", "19 Nov 2026 (from Stripe)"],
      ["New work", "Stops on 19 Nov 2026: no new matters, staff or client invitations."],
      ["Read access", "Continues for everyone at the firm, read-only, for as long as the records are kept."],
      ["Export window", "At least 90 days: until 17 Feb 2027"],
      ["Full firm export", "1 of 4 matters have a client-file export since 25 Oct 2026. Export each one, then download the firm index."],
      ["After the window", "Custodial archive (unless you choose a transfer): Casevoya keeps the records read-only under each matter’s retention."],
      ["Deletion", "None. Cancelling never deletes records; a matter’s files are deleted only by an approved deletion job after its own retention end."],
    ]);
    expect(panel.exportNext).toEqual({ href: "/sheet/exports?view=m2", label: "Export next matter (M-2026-0002)" });
    expect(panel.dialog).toEqual({ organizationId: ORG, current: "custodial_archive", transferId: null, transfers: [{ id: "x1", label: "Receiving Firm (open)" }] });
    const html = renderToStaticMarkup(createElement(ContinuityPanel, { data: panel }));
    expect(html).toContain("<dt>Export window</dt><dd>At least 90 days: until 17 Feb 2027</dd>");
    expect(html).toContain('<a class="btn p sm" href="/sheet/exports?view=m2">Export next matter (M-2026-0002)</a>');
    expect(html).toContain('data-sec-act="firm-index"');
    expect(renderToStaticMarkup(createElement(EndArrangementDialog, { data: panel.dialog! }))).toContain('<option value="x1">Receiving Firm (open)</option>');

    const finance = continuityPanel(readContinuity(ending), { organizationId: ORG, timeZone: ZONE, isOwner: false, transfers: [] })!;
    expect(finance.exportNext).toBeNull();
    expect(finance.canIndex).toBe(false);
    expect(finance.dialog).toBeNull();
    expect(continuityPanel(readContinuity({ phase: "none" }), { organizationId: ORG, timeZone: ZONE, isOwner: true, transfers: [] })).toBeNull();
  });

  it("the Cancel subscription dialog shows the paid period's end and the earliest window end; the State row counts the window from the database", () => {
    const data = cancelDialog({ organizationId: ORG, periodEnd: "2026-11-19T15:00:00Z", windowDays: 30, timeZone: ZONE });
    expect(data).toEqual({ organizationId: ORG, periodEnd: "19 Nov 2026", windowEnd: "17 Feb 2027", windowDays: 90 });
    const html = renderToStaticMarkup(createElement(CancelSubscriptionDialog, { data }));
    expect(html).toMatch(/^<dialog class="dlg" id="dlgCancelSub"/);
    expect(html).toContain("Your paid period ends on 19 Nov 2026. Until then nothing changes.");
    expect(html).toContain("Cancelling never deletes records.");
    expect(html).toContain('data-sec-act="cancel-sub"');

    const detail = readFirmSubscription({
      subscription: { status: "cancelled", plan: "practice", billing_interval: "month", extra_seats: 0, cancelled_at: "2026-10-01T15:00:00Z", current_period_end: "2026-11-19T15:00:00Z", has_billing_account: true, has_stripe_subscription: true },
      entitlements: { status: "cancelled", plan: "practice", basis: "plan", seats: 6, matters: 500, storage_gb: 100, extra_seats: 0, new_work_blocked: true },
      usage: null,
      catalog: null,
      grace: { past_due_days: 7, export_window_days: 90 },
      invoices: [],
      continuity: { ...ending, phase: "window", status: "cancelled", cancel_at: null },
    });
    const page = subscriptionPage({ firmName: "Synthetic Firm", subscription: { status: "cancelled", trial_started_at: null, trial_ends_at: null, plan: "practice" }, usage: null, timeZone: ZONE, now: new Date("2026-12-01T12:00:00Z"), detail });
    expect(page.rows.find(([term]) => term === "State")?.[1]).toBe("Cancelled on 1 Oct 2026. Exports stay open at least until 17 Feb 2027.");
  });

  it("asks Stripe to cancel at the period end with the recorded key and returns Stripe's date", async () => {
    const update = vi.fn(async () => ({ id: "sub_Synthetic01", cancel_at: 1_795_100_000, canceled_at: null, status: "active", items: { data: [{ current_period_end: 1_795_100_000, price: { lookup_key: "casevoya_practice_month" }, quantity: 1 }] }, metadata: {} }));
    const result = await scheduleCancelAtPeriodEnd({ subscriptions: { update } } as never, { subscriptionId: "sub_Synthetic01", idempotencyKey: "k-1" });
    expect(update).toHaveBeenCalledWith("sub_Synthetic01", { cancel_at_period_end: true }, { idempotencyKey: "casevoya-cancel-k-1" });
    expect(result).toEqual({ cancelAt: new Date(1_795_100_000 * 1000).toISOString(), periodEnd: new Date(1_795_100_000 * 1000).toISOString() });
  });
});
