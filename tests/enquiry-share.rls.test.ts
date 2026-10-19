import { createHash, randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { asAnon, asMaintenance, asUser, createTestDb, expectDbError, type TestDb } from "./helpers/postgres";

// The firm's public enquiry page (20261020190000_enquiry_public_page): enquiry_public_firm (what the
// hosted page and the embed may show, and to whom) and submit_enquiry's practice enquiries in sample
// mode (the firm's own staff only; the lead is a sample row). Everything here is synthetic.

let db: TestDb;

beforeAll(async () => {
  db = await createTestDb();
}, 180_000);

afterAll(async () => {
  await db?.close();
});

beforeEach(async () => {
  await asMaintenance(db);
});

async function createUser(label: string) {
  await asMaintenance(db);
  const id = randomUUID();
  await db.query(`insert into auth.users (id, email, email_confirmed_at, raw_user_meta_data) values ($1, $2, now(), '{}'::jsonb)`, [
    id,
    `${label}-${id.slice(0, 8)}@example.test`,
  ]);
  return id;
}

async function firm(options: { sample?: boolean; privacy?: boolean } = {}) {
  const owner = await createUser("owner");
  await asUser(db, { userId: owner, aal: "aal2", totpAgeSeconds: 0 });
  const slug = `f${randomUUID().replaceAll("-", "").slice(0, 12)}`;
  const created = await db.query<{ id: string }>(`select (public.create_organization($1, $2, $3)).id as id`, ["Synthetic Legal", "Synthetic Firm", slug]);
  const orgId = created.rows[0].id;
  await asMaintenance(db);
  await db.query(`update public.organizations set sample_mode = $2 where id = $1`, [orgId, options.sample ?? false]);
  if (options.privacy ?? true) {
    await db.query(
      `insert into public.portal_policy_documents (organization_id, kind, version_label, title, body, body_sha256)
       values ($1, 'privacy_notice', 'v1', 'Privacy notice', 'Synthetic notice', $2)`,
      [orgId, createHash("sha256").update("Synthetic notice").digest("hex")],
    );
  }
  const manager = await createUser("manager");
  await db.query(`insert into public.memberships (organization_id, user_id, role, status, accepted_at) values ($1, $2, 'case_manager', 'active', now())`, [orgId, manager]);
  return { orgId, slug, owner, manager };
}

type Firm = Awaited<ReturnType<typeof firm>>;

async function publicFirm(slug: string) {
  const row = await db.query<{ r: Record<string, unknown> | null }>(`select public.enquiry_public_firm($1) as r`, [slug]);
  return row.rows[0].r;
}

async function submit(slug: string, key = randomUUID()) {
  const row = await db.query<{ r: { ok?: boolean; error?: string } }>(
    `select public.submit_enquiry($1, 'Wei Zhang', 'wei@example.test', 'email', 'Study', 'China', 'Mandarin', true,
       'Synthetic Firm may use these details to reply to my enquiry', false, null, 'enquiry-v2', 'web_form', $2, null) as r`,
    [slug, key],
  );
  return row.rows[0].r;
}

async function leadsOf(orgId: string) {
  await asMaintenance(db);
  const rows = await db.query<{ is_sample: boolean; source: string }>(`select is_sample, source::text from public.leads where organization_id = $1`, [orgId]);
  return rows.rows;
}

const staff = (ctx: Firm, userId: string, aal: "aal1" | "aal2" = "aal2") =>
  asUser(db, { userId, aal, orgId: ctx.orgId, totpAgeSeconds: aal === "aal2" ? 0 : undefined });

describe("enquiry_public_firm", () => {
  it("names a live firm with a privacy notice to anyone, and says whether the viewer is its staff", async () => {
    const live = await firm();
    const other = await firm();
    await asAnon(db);
    expect(await publicFirm(live.slug)).toEqual({ firm_name: "Synthetic Firm", firm_slug: live.slug, practice: false, staff: false });
    expect(await publicFirm(live.slug.toUpperCase())).toMatchObject({ firm_slug: live.slug });
    await staff(live, live.manager);
    expect(await publicFirm(live.slug)).toMatchObject({ staff: true });
    // Another firm's staff and the firm's own staff without two-step are visitors.
    await staff(other, other.manager);
    expect(await publicFirm(live.slug)).toMatchObject({ staff: false });
    await staff(live, live.manager, "aal1");
    expect(await publicFirm(live.slug)).toMatchObject({ staff: false });
  });

  it("returns nothing for an unknown firm or one without a published privacy notice", async () => {
    const noNotice = await firm({ privacy: false });
    await asAnon(db);
    expect(await publicFirm(noNotice.slug)).toBeNull();
    expect(await publicFirm("no-such-firm")).toBeNull();
    expect(await publicFirm("")).toBeNull();
    await staff(noNotice, noNotice.owner);
    expect(await publicFirm(noNotice.slug)).toBeNull();
  });

  it("shows a sample-mode firm's page only to its own staff with two-step, as a practice page", async () => {
    const sample = await firm({ sample: true });
    const other = await firm();
    await asAnon(db);
    expect(await publicFirm(sample.slug)).toBeNull();
    await staff(other, other.owner);
    expect(await publicFirm(sample.slug)).toBeNull();
    await staff(sample, sample.manager, "aal1");
    expect(await publicFirm(sample.slug)).toBeNull();
    await staff(sample, sample.manager);
    expect(await publicFirm(sample.slug)).toEqual({ firm_name: "Synthetic Firm", firm_slug: sample.slug, practice: true, staff: true });
  });

  it("is callable by visitors but leaks no ids, and the practice-viewer helper stays private", async () => {
    const live = await firm();
    await asAnon(db);
    const shown = await publicFirm(live.slug);
    expect(Object.keys(shown ?? {}).sort()).toEqual(["firm_name", "firm_slug", "practice", "staff"]);
    expect(JSON.stringify(shown)).not.toContain(live.orgId);
    await expectDbError(() => db.query(`select app.booking_practice_viewer($1)`, [live.orgId]), /permission denied/);
  });
});

describe("submit_enquiry in sample mode", () => {
  it("takes a practice enquiry from the firm's own staff only, as a sample lead", async () => {
    const sample = await firm({ sample: true });
    const other = await firm();
    await asAnon(db);
    expect(await submit(sample.slug)).toEqual({ error: "form_unavailable" });
    await staff(other, other.owner);
    expect(await submit(sample.slug)).toEqual({ error: "form_unavailable" });
    await staff(sample, sample.manager, "aal1");
    expect(await submit(sample.slug)).toEqual({ error: "form_unavailable" });
    expect(await leadsOf(sample.orgId)).toEqual([]);

    await staff(sample, sample.manager);
    expect(await submit(sample.slug)).toEqual({ ok: true });
    expect(await leadsOf(sample.orgId)).toEqual([{ is_sample: true, source: "web_form" }]);
    const audit = await db.query<{ context: Record<string, unknown> }>(
      `select context from public.audit_log where organization_id = $1 and action = 'lead.enquiry_received'`,
      [sample.orgId],
    );
    expect(audit.rows.map((row) => row.context.sample)).toEqual([true]);
  });

  it("keeps a live firm's enquiries real and its other refusals unchanged", async () => {
    const live = await firm();
    const noNotice = await firm({ privacy: false });
    await asAnon(db);
    expect(await submit(live.slug)).toEqual({ ok: true });
    expect(await leadsOf(live.orgId)).toEqual([{ is_sample: false, source: "web_form" }]);
    await asAnon(db);
    expect(await submit(noNotice.slug)).toEqual({ error: "form_unavailable" });
    // A staff member of a live firm sending from the page makes a real lead too (it's a real enquiry).
    await staff(live, live.manager);
    expect(await submit(live.slug)).toEqual({ ok: true });
    expect((await leadsOf(live.orgId)).every((row) => row.is_sample === false)).toBe(true);
  });

  it("cannot be steered into another firm: the slug decides the firm, and leads stay unreadable to visitors", async () => {
    const a = await firm();
    const b = await firm();
    await asAnon(db);
    expect(await submit(a.slug)).toEqual({ ok: true });
    expect(await leadsOf(b.orgId)).toEqual([]);
    await asAnon(db);
    await expectDbError(() => db.query(`select id from public.leads`), /permission denied/);
    await staff(b, b.manager);
    const seen = await db.query(`select id from public.leads where organization_id = $1`, [a.orgId]);
    expect(seen.rows).toHaveLength(0);
  });
});
