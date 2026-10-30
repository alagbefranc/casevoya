import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { asMaintenance, asServiceRole, asUser, createTestDb, expectDbError, type TestDb } from "./helpers/postgres";

let db: TestDb;

beforeAll(async () => {
  db = await createTestDb();
}, 120_000);

afterAll(async () => {
  await db?.close();
});

beforeEach(async () => {
  await asMaintenance(db);
});

afterEach(async () => {
  await asMaintenance(db);
  await db.query(`update public.product_settings set value = '{"messages":30}'::jsonb where key = 'email.inbound_hourly_limit'`);
  await db.query(
    `update public.product_settings set value = '{"per_sender":20,"per_domain":100,"known_messages":300}'::jsonb
     where key = 'email.inbound_sender_limits'`,
  );
});

function slug() {
  return `f${randomUUID().replaceAll("-", "").slice(0, 12)}`;
}

async function createUser(address: string) {
  await asMaintenance(db);
  const id = randomUUID();
  await db.query(
    `insert into auth.users (id, email, email_confirmed_at, raw_user_meta_data) values ($1, $2, now(), '{}'::jsonb)`,
    [id, address],
  );
  return id;
}

async function firm() {
  const ownerEmail = `owner-${randomUUID().slice(0, 8)}@firm.example`;
  const owner = await createUser(ownerEmail);
  await asUser(db, { userId: owner, aal: "aal2", totpAgeSeconds: 0 });
  const created = await db.query<{ id: string }>(`select (public.create_organization($1, $2, $3)).id as id`, [
    "Synthetic Legal Name",
    "Synthetic Firm",
    slug(),
  ]);
  const orgId = created.rows[0].id;
  await asMaintenance(db);
  const orgSlug = (await db.query<{ slug: string }>(`select slug from public.organizations where id = $1`, [orgId])).rows[0].slug;
  const clientEmail = `client-${randomUUID().slice(0, 8)}@example.test`;
  await db.query(`insert into public.persons (organization_id, display_name, email) values ($1, 'Synthetic client', $2)`, [
    orgId,
    clientEmail,
  ]);
  return { owner, ownerEmail, orgId, to: `${orgSlug}@docs.casevoya.ca`, clientEmail };
}

async function limits(value: { per_sender: number; per_domain: number; known_messages: number }, firmCap = 30) {
  await asMaintenance(db);
  await db.query(`update public.product_settings set value = $1::jsonb where key = 'email.inbound_sender_limits'`, [JSON.stringify(value)]);
  await db.query(`update public.product_settings set value = $1::jsonb where key = 'email.inbound_hourly_limit'`, [
    JSON.stringify({ messages: firmCap }),
  ]);
}

type Begin = { status: string; reason?: string; inbound_email_id?: string };

async function send(to: string, from: string, verified = false): Promise<Begin> {
  await asServiceRole(db);
  const result = await db.query<{ result: Begin }>(
    `select public.begin_verified_inbound_message($1, $2, $3, 'Subject', 'Body', null, null, $4) as result`,
    [to, from, `<m-${randomUUID()}@example.test>`, verified],
  );
  return result.rows[0].result;
}

async function storedCount(orgId: string) {
  await asMaintenance(db);
  const rows = await db.query<{ n: number }>(`select count(*)::int as n from public.inbound_emails where organization_id = $1`, [orgId]);
  return rows.rows[0].n;
}

describe("inbound sender limits", () => {
  it("limits one sender address (ignoring +tags) and stores nothing for refused mail", async () => {
    const ctx = await firm();
    await limits({ per_sender: 3, per_domain: 100, known_messages: 300 });
    for (let i = 0; i < 3; i += 1) {
      expect((await send(ctx.to, "flood@spam.example")).status).toBe("accepted");
    }
    const refused = await send(ctx.to, "flood@spam.example");
    expect(refused).toMatchObject({ status: "rate_limited", reason: "sender_rate_limit" });
    expect(refused.inbound_email_id).toBeUndefined();
    expect((await send(ctx.to, "Flood+2@Spam.example")).status).toBe("rate_limited");
    expect((await send(ctx.to, "Mr Flood <flood+3@spam.example>")).status).toBe("rate_limited");
    expect((await send(ctx.to, "other@spam.example")).status).toBe("accepted");
    expect(await storedCount(ctx.orgId)).toBe(4);

    const counters = await db.query<{ scope: string; sender_key: string; hits: number; rejected: number }>(
      `select scope, sender_key, sum(hits)::int as hits, sum(rejected)::int as rejected
       from public.email_inbound_sender_windows where organization_id = $1 group by scope, sender_key order by scope, hits desc`,
      [ctx.orgId],
    );
    const domain = counters.rows.find((row) => row.scope === "domain");
    expect(domain).toMatchObject({ sender_key: "spam.example", hits: 4, rejected: 0 });
    const flood = counters.rows.find((row) => row.scope === "sender" && row.hits === 3);
    expect(flood?.rejected).toBe(3);
    expect(flood?.sender_key).toMatch(/^[0-9a-f]{64}$/);
    expect(counters.rows.some((row) => row.sender_key.includes("flood"))).toBe(false);

    const audit = await db.query<{ context: Record<string, unknown> }>(
      `select context from public.audit_log where organization_id = $1 and action = 'email.rejected'`,
      [ctx.orgId],
    );
    // One compact row per counter window (two only if the run crosses a 5-minute bucket).
    expect(audit.rows.length).toBeGreaterThanOrEqual(1);
    expect(audit.rows.length).toBeLessThanOrEqual(2);
    for (const row of audit.rows) {
      expect(row.context).toEqual({ reason: "sender_rate_limit", sender_domain: "spam.example" });
    }
  });

  it("limits one sender domain across many addresses", async () => {
    const ctx = await firm();
    await limits({ per_sender: 20, per_domain: 3, known_messages: 300 });
    for (let i = 0; i < 3; i += 1) {
      expect((await send(ctx.to, `a${i}@bulk.example`)).status).toBe("accepted");
    }
    expect(await send(ctx.to, "fresh@bulk.example")).toMatchObject({ status: "rate_limited", reason: "domain_rate_limit" });
    expect((await send(ctx.to, "someone@elsewhere.example")).status).toBe("accepted");
    expect(await storedCount(ctx.orgId)).toBe(4);
  });

  it("keeps the firm cap for strangers but lets verified clients and staff through", async () => {
    const ctx = await firm();
    await limits({ per_sender: 1, per_domain: 1, known_messages: 9 }, 5);
    for (let i = 1; i <= 5; i += 1) {
      expect((await send(ctx.to, `s@d${i}.example`)).status).toBe("accepted");
    }
    expect(await send(ctx.to, "s@d6.example")).toMatchObject({ status: "rate_limited", reason: "rate_limit" });
    expect(await send(ctx.to, "s@d1.example")).toMatchObject({ status: "rate_limited", reason: "sender_rate_limit" });

    // A forged client From (not verified) and a verified address the firm does not know are strangers.
    expect(await send(ctx.to, ctx.clientEmail, false)).toMatchObject({ status: "rate_limited", reason: "rate_limit" });
    expect(await send(ctx.to, "unknown@verified.example", true)).toMatchObject({ status: "rate_limited", reason: "rate_limit" });

    // Verified client: exempt from the per-sender limit and the stranger firm cap.
    for (let i = 0; i < 3; i += 1) {
      expect((await send(ctx.to, ctx.clientEmail, true)).status).toBe("accepted");
    }
    // Verified staff of the firm.
    expect((await send(ctx.to, ctx.ownerEmail.toUpperCase(), true)).status).toBe("accepted");
    // Backstop: known senders stop at known_messages for the firm hour.
    expect(await send(ctx.to, ctx.clientEmail, true)).toMatchObject({ status: "rate_limited", reason: "rate_limit" });
    expect(await storedCount(ctx.orgId)).toBe(9);

    const window = await db.query<{ hits: number; rejected: number }>(
      `select hits, rejected from public.email_inbound_windows where organization_id = $1`,
      [ctx.orgId],
    );
    expect(window.rows[0]).toEqual({ hits: 9, rejected: 4 });
    const known = await db.query<{ n: number }>(
      `select count(*)::int as n from public.email_inbound_sender_windows where organization_id = $1 and sender_key = 'example.test'`,
      [ctx.orgId],
    );
    expect(known.rows[0].n).toBe(0);
  });

  it("does not exempt a client of another firm", async () => {
    const ctx = await firm();
    const other = await firm();
    await limits({ per_sender: 1, per_domain: 5, known_messages: 300 });
    expect((await send(ctx.to, other.clientEmail, true)).status).toBe("accepted");
    expect(await send(ctx.to, other.clientEmail, true)).toMatchObject({ status: "rate_limited", reason: "sender_rate_limit" });
    expect((await send(other.to, other.clientEmail, true)).status).toBe("accepted");
    expect((await send(other.to, other.clientEmail, true)).status).toBe("accepted");
  });

  it("shows counters only to the firm's staff and cannot be written by users", async () => {
    const ctx = await firm();
    await send(ctx.to, "visible@counter.example");
    await asUser(db, { userId: ctx.owner, aal: "aal2", orgId: ctx.orgId, totpAgeSeconds: 0 });
    const seen = await db.query(`select scope from public.email_inbound_sender_windows where organization_id = $1`, [ctx.orgId]);
    expect(seen.rows.length).toBe(2);
    await expectDbError(
      () =>
        db.query(
          `insert into public.email_inbound_sender_windows (organization_id, scope, sender_key, window_start, hits)
           values ($1, 'domain', 'x.example', now(), 999)`,
          [ctx.orgId],
        ),
      /permission denied|42501|row-level security/,
    );
    const outsider = await firm();
    await asUser(db, { userId: outsider.owner, aal: "aal2", orgId: outsider.orgId, totpAgeSeconds: 0 });
    const hidden = await db.query(`select scope from public.email_inbound_sender_windows where organization_id = $1`, [ctx.orgId]);
    expect(hidden.rows).toHaveLength(0);
  });
});
