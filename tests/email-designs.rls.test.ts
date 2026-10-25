import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { renderEmail } from "@/modules/email/templates";
import { asMaintenance, asServiceRole, asUser, createTestDb, type TestDb } from "./helpers/postgres";
import { firmDay } from "./helpers/firm-day";

let db: TestDb;

beforeAll(async () => {
  db = await createTestDb({ supabaseDefaultPrivileges: true });
}, 120_000);

afterAll(async () => {
  await db?.close();
});

beforeEach(async () => {
  await asMaintenance(db);
});

type Prepared = {
  action: string;
  messages: { to: string; template: string; context: Record<string, unknown> }[];
};

const tag = () => randomUUID().replaceAll("-", "").slice(0, 10);

async function createUser(label: string) {
  await asMaintenance(db);
  const id = randomUUID();
  await db.query(`insert into auth.users (id, email, email_confirmed_at) values ($1, $2, now())`, [id, `${label}-${id.slice(0, 8)}@example.test`]);
  return id;
}

/** A firm with one matter: an applicant who pays by card, and a sponsor who is not billed. */
async function firm() {
  const owner = await createUser("owner");
  const client = await createUser("client");
  await asUser(db, { userId: owner, aal: "aal2", totpAgeSeconds: 0 });
  const orgId = (
    await db.query<{ id: string }>(`select (public.create_organization($1, $2, $3)).id as id`, ["Synthetic Legal Name", "Synthetic Firm", `f${tag()}`])
  ).rows[0].id;
  await asMaintenance(db);
  await db.query(
    `insert into public.memberships (organization_id, user_id, role, status, accepted_at, created_by) values ($1, $2, 'client', 'active', now(), $3)`,
    [orgId, client, owner],
  );
  const matterId = randomUUID();
  await db.query(`insert into public.matters (id, organization_id, title, is_sample) values ($1, $2, 'Synthetic matter', true)`, [matterId, orgId]);
  const applicantEmail = `applicant-${tag()}@example.test`;
  const sponsorEmail = `sponsor-${tag()}@example.test`;
  const applicant = (
    await db.query<{ id: string }>(
      `insert into public.persons (organization_id, display_name, is_sample, user_id, email) values ($1, 'Synthetic applicant', true, $2, $3) returning id`,
      [orgId, client, applicantEmail],
    )
  ).rows[0].id;
  const sponsor = (
    await db.query<{ id: string }>(
      `insert into public.persons (organization_id, display_name, is_sample, email) values ($1, 'Synthetic sponsor', true, $2) returning id`,
      [orgId, sponsorEmail],
    )
  ).rows[0].id;
  await db.query(
    `insert into public.matter_participants (organization_id, matter_id, person_id, role) values ($1, $2, $3, 'applicant'), ($1, $2, $4, 'sponsor')`,
    [orgId, matterId, applicant, sponsor],
  );
  const account = `acct_1Syn${tag()}`;
  await asUser(db, { userId: owner, aal: "aal2", orgId, totpAgeSeconds: 0 });
  await db.query(`select public.record_firm_payment_account($1, $2, false)`, [orgId, account]);
  return { owner, client, orgId, matterId, applicant, applicantEmail, sponsorEmail, account };
}

async function issue(f: Awaited<ReturnType<typeof firm>>) {
  await asUser(db, { userId: f.owner, aal: "aal2", orgId: f.orgId, totpAgeSeconds: 0 });
  const due = firmDay(5);
  const id = (
    await db.query<{ id: string }>(`select public.create_invoice($1, 'Synthetic fee', 50000, 'CAD', $2::date, $3) as id`, [f.matterId, due, `inv-${randomUUID()}`])
  ).rows[0].id;
  return { id, due };
}

async function mailEvent(orgId: string, eventType: string, key: string, value: string) {
  await asMaintenance(db);
  const rows = await db.query<{ id: string; payload: Record<string, unknown> }>(
    `select id, payload from public.outbox_events where organization_id = $1 and event_type = $2 and payload ->> $3 = $4`,
    [orgId, eventType, key, value],
  );
  return rows.rows;
}

/** Claims through the mail worker's own function, then prepares the one event. */
async function prepare(eventId: string): Promise<Prepared> {
  await asServiceRole(db);
  const worker = `designs-${tag()}`;
  const claimed = await db.query<{ events: { id: string }[] }>(`select public.claim_mail_events($1, 50) as events`, [worker]);
  expect(claimed.rows[0].events.map((row) => row.id)).toContain(eventId);
  const prepared = await db.query<{ result: Prepared }>(`select public.prepare_email_delivery($1, $2, null, null) as result`, [eventId, worker]);
  return prepared.rows[0].result;
}

describe("invoice, payment and refund mail", () => {
  it("emails an issued invoice to the matter's applicants with its number and due date, never the amount", async () => {
    const f = await firm();
    const invoice = await issue(f);
    const events = await mailEvent(f.orgId, "invoice.issued", "invoice_id", invoice.id);
    expect(events).toHaveLength(1);
    expect(Object.keys(events[0].payload).sort()).toEqual(["invoice_id", "matter_id"]);
    const prepared = await prepare(events[0].id);
    expect(prepared.action).toBe("send");
    expect(prepared.messages.map((message) => message.to)).toEqual([f.applicantEmail]);
    const message = prepared.messages[0];
    expect(message.template).toBe("invoice");
    expect(message.context).toMatchObject({ invoice_id: invoice.id, invoice_number: "INV-0001", due_on: invoice.due, firm: "Synthetic Firm" });
    expect(JSON.stringify(message.context)).not.toMatch(/50000|amount/);
    const email = renderEmail({ ...message.context, template: message.template });
    expect(email.design).toBe("EM10");
    expect(email.text).toContain("Invoice INV-0001 has a balance due on");
    expect(email.text).toContain(`/portal/payments?invoice=${invoice.id}`);
  });

  it("honours the applicant's Email notices choice", async () => {
    const f = await firm();
    await asMaintenance(db);
    await db.query(
      `insert into public.person_contact_preferences (person_id, organization_id, email_notices, sms_notices, deadline_reminders) values ($1, $2, false, false, false)`,
      [f.applicant, f.orgId],
    );
    const invoice = await issue(f);
    const [event] = await mailEvent(f.orgId, "invoice.issued", "invoice_id", invoice.id);
    const prepared = await prepare(event.id);
    expect(prepared.action).toBe("done");
    await asMaintenance(db);
    const rows = await db.query<{ status: string }>(`select status from public.email_deliveries where outbox_event_id = $1`, [event.id]);
    expect(rows.rows.map((row) => row.status)).toEqual(["skipped"]);
  });

  it("tells the payer when a card payment fails and when a refund starts, never that it is complete", async () => {
    const f = await firm();
    const invoice = await issue(f);
    const intent = `pi_Syn${tag()}`;
    await asUser(db, { userId: f.client, aal: "aal1", orgId: f.orgId });
    await db.query(`select public.record_invoice_payment_intent($1, $2, $3, 50000, 'cad', 0, false)`, [invoice.id, intent, f.account]);
    await asServiceRole(db);
    const failed = await db.query<{ r: { payment_status: string } }>(
      `select public.apply_stripe_payment_event($1, $2, 'payment_intent.payment_failed', $3, 50000, 0, 'cad', false, null, '{}'::jsonb) as r`,
      [`evt_${tag()}`, f.account, intent],
    );
    expect(failed.rows[0].r.payment_status).toBe("failed");
    const [failure] = await mailEvent(f.orgId, "invoice.payment_failed", "invoice_id", invoice.id);
    const failedMail = await prepare(failure.id);
    expect(failedMail.messages.map((message) => [message.to, message.template])).toEqual([[f.applicantEmail, "payment_failed"]]);
    expect(renderEmail({ ...failedMail.messages[0].context, template: "payment_failed" }).text).toContain("for invoice INV-0001 didn’t go through");

    await asServiceRole(db);
    await db.query(
      `select public.apply_stripe_payment_event($1, $2, 'payment_intent.succeeded', $3, 50000, 50000, 'cad', false, null, '{}'::jsonb)`,
      [`evt_${tag()}`, f.account, intent],
    );
    // A refund recorded (as the firm's refund action does) and then confirmed by Stripe.
    await asMaintenance(db);
    const payment = (await db.query<{ id: string }>(`select id from public.invoice_payments where payment_intent_id = $1`, [intent])).rows[0].id;
    const refund = (
      await db.query<{ id: string }>(
        `insert into public.invoice_refunds (organization_id, invoice_id, payment_id, number, refund_id, connected_account_id, amount_cents, currency, status, livemode)
         values ($1, $2, $3, 'RF-0001', $4, $5, 10000, 'CAD', 'pending', false) returning id`,
        [f.orgId, invoice.id, payment, `re_Syn${tag()}`, f.account],
      )
    ).rows[0].id;
    const [started] = await mailEvent(f.orgId, "invoice.refund_started", "refund_id", refund);
    const startedMail = await prepare(started.id);
    expect(startedMail.messages.map((message) => [message.to, message.template])).toEqual([[f.applicantEmail, "refund_started"]]);
    expect(JSON.stringify(startedMail.messages[0].context)).not.toMatch(/10000|amount/);
    // Bug #215: a succeeded card refund can still fail (Stripe: up to 30 days), so no "complete" email.
    await asMaintenance(db);
    await db.query(`update public.invoice_refunds set status = 'succeeded', succeeded_at = now() where id = $1`, [refund]);
    await db.query(`update public.invoice_refunds set status = 'succeeded' where id = $1`, [refund]);
    expect(await mailEvent(f.orgId, "invoice.refund_succeeded", "refund_id", refund)).toEqual([]);
  });

  async function paidRefund() {
    const f = await firm();
    const invoice = await issue(f);
    const intent = `pi_Syn${tag()}`;
    await asUser(db, { userId: f.client, aal: "aal1", orgId: f.orgId });
    await db.query(`select public.record_invoice_payment_intent($1, $2, $3, 50000, 'cad', 0, false)`, [invoice.id, intent, f.account]);
    await asServiceRole(db);
    await db.query(
      `select public.apply_stripe_payment_event($1, $2, 'payment_intent.succeeded', $3, 50000, 50000, 'cad', false, null, '{}'::jsonb)`,
      [`evt_${tag()}`, f.account, intent],
    );
    await asMaintenance(db);
    const payment = (await db.query<{ id: string }>(`select id from public.invoice_payments where payment_intent_id = $1`, [intent])).rows[0].id;
    const stripeRefund = `re_Syn${tag()}`;
    const refund = (
      await db.query<{ id: string }>(
        `insert into public.invoice_refunds (organization_id, invoice_id, payment_id, number, refund_id, connected_account_id, amount_cents, currency, status, livemode)
         values ($1, $2, $3, 'RF-0001', $4, $5, 10000, 'CAD', 'pending', false) returning id`,
        [f.orgId, invoice.id, payment, stripeRefund, f.account],
      )
    ).rows[0].id;
    return { f, intent, stripeRefund, refund };
  }

  async function stripeRefundEvent(f: Awaited<ReturnType<typeof firm>>, id: string, type: string, stripeRefund: string, intent: string, status: string, failure: string | null) {
    await asServiceRole(db);
    const result = await db.query<{ r: { outcome: string; refund_status: string } }>(
      `select public.apply_stripe_reversal_event($1, $2, $3, $4, $5, null, 10000, 'cad', $6, null, $7, null, null, null, false, '{}'::jsonb) as r`,
      [id, f.account, type, stripeRefund, intent, status, failure],
    );
    return result.rows[0].r;
  }

  it("tells the payer once, in plain words, when a refund fails after it succeeded, however often Stripe replays it", async () => {
    const { f, intent, stripeRefund, refund } = await paidRefund();
    expect(await stripeRefundEvent(f, `evt_${tag()}`, "refund.updated", stripeRefund, intent, "succeeded", null)).toMatchObject({ refund_status: "succeeded" });
    expect(await mailEvent(f.orgId, "invoice.refund_succeeded", "refund_id", refund)).toEqual([]);

    const failedEvent = `evt_${tag()}`;
    expect(await stripeRefundEvent(f, failedEvent, "refund.failed", stripeRefund, intent, "failed", "expired_or_canceled_card")).toMatchObject({
      outcome: "applied",
      refund_status: "failed",
    });
    // The same event again, and Stripe's refund.updated for the same failure.
    expect((await stripeRefundEvent(f, failedEvent, "refund.failed", stripeRefund, intent, "failed", "expired_or_canceled_card")).outcome).toBe("duplicate");
    await stripeRefundEvent(f, `evt_${tag()}`, "refund.updated", stripeRefund, intent, "failed", "expired_or_canceled_card");

    const corrections = await mailEvent(f.orgId, "invoice.refund_failed", "refund_id", refund);
    expect(corrections).toHaveLength(1);
    const mail = await prepare(corrections[0].id);
    expect(mail.messages.map((message) => [message.to, message.template])).toEqual([[f.applicantEmail, "refund_failed"]]);
    expect(mail.messages[0].context).toMatchObject({ refund_reason: "expired_or_canceled_card" });
    expect(JSON.stringify(mail.messages[0].context)).not.toMatch(/10000|amount/);
    const email = renderEmail({ ...mail.messages[0].context, template: mail.messages[0].template });
    expect(email.design).toBe("EX20");
    expect(email.subject).toBe("Your refund from Synthetic Firm didn’t go through");
    expect(email.text).toContain("the card it was sent to is no longer active");
    expect(email.text).not.toContain("expired_or_canceled_card");
    // The owner's task is kept.
    await asMaintenance(db);
    expect((await db.query<{ task_id: string | null }>(`select task_id from public.invoice_refunds where id = $1`, [refund])).rows[0].task_id).not.toBeNull();
  });

  it("corrects a pending refund that fails, and says nothing for a refund that failed before the client heard of it", async () => {
    const { f, intent, stripeRefund, refund } = await paidRefund();
    await stripeRefundEvent(f, `evt_${tag()}`, "refund.failed", stripeRefund, intent, "failed", "unknown");
    const [correction] = await mailEvent(f.orgId, "invoice.refund_failed", "refund_id", refund);
    const mail = await prepare(correction.id);
    const email = renderEmail({ ...mail.messages[0].context, template: mail.messages[0].template });
    expect(email.design).toBe("EX20");
    expect(email.text).not.toContain("no longer active");
    expect(email.text).not.toContain("unknown");

    await asMaintenance(db);
    const silent = (
      await db.query<{ id: string }>(
        `insert into public.invoice_refunds (organization_id, invoice_id, payment_id, number, refund_id, connected_account_id, amount_cents, currency, status, livemode)
         select organization_id, invoice_id, payment_id, 'RF-0002', $2, connected_account_id, 5000, 'CAD', 'failed', false from public.invoice_refunds where id = $1 returning id`,
        [refund, `re_Syn${tag()}`],
      )
    ).rows[0].id;
    await db.query(`update public.invoice_refunds set status = 'canceled' where id = $1`, [silent]);
    expect(await mailEvent(f.orgId, "invoice.refund_started", "refund_id", silent)).toEqual([]);
    expect(await mailEvent(f.orgId, "invoice.refund_failed", "refund_id", silent)).toEqual([]);
  });

  it("skips a 'refund complete' email still queued from before", async () => {
    const { f, refund } = await paidRefund();
    await asMaintenance(db);
    const event = (
      await db.query<{ id: string }>(
        `select app.enqueue_event($1, 'invoice', invoice_id, 'invoice.refund_succeeded',
           jsonb_build_object('invoice_id', invoice_id, 'payment_id', payment_id, 'refund_id', id), null, 'old-complete:' || id::text, null) as id
         from public.invoice_refunds where id = $2`,
        [f.orgId, refund],
      )
    ).rows[0].id;
    const prepared = await prepare(event);
    expect(prepared).toMatchObject({ action: "done", messages: [] });
    await asMaintenance(db);
    expect((await db.query(`select 1 from public.email_deliveries where outbox_event_id = $1`, [event])).rows).toEqual([]);
  });
});

describe("invitation mail context", () => {
  it("names the inviter for the heading, from their profile", async () => {
    const f = await firm();
    await asMaintenance(db);
    await db.query(
      `insert into public.profiles (id, display_name) values ($1, 'Sam Example') on conflict (id) do update set display_name = excluded.display_name`,
      [f.owner],
    );
    await asUser(db, { userId: f.owner, aal: "aal2", orgId: f.orgId, totpAgeSeconds: 0 });
    const invitee = `staff-${tag()}@example.test`;
    await db.query(`select public.create_staff_invitation($1, $2, 'case_manager'::public.org_role)`, [f.orgId, invitee]);
    const [event] = await mailEvent(f.orgId, "staff_invitation.email_requested", "recipient_email", invitee);
    await asMaintenance(db);
    // The linkless email is claimed after 10 minutes without a sealed link.
    await db.query(`update public.outbox_events set occurred_at = now() - interval '11 minutes' where id = $1`, [event.id]);
    const prepared = await prepare(event.id);
    expect(prepared.messages[0].context).toMatchObject({ kind: "staff", role: "case_manager", inviter: "Sam Example" });
    const email = renderEmail({ ...prepared.messages[0].context, template: "invite" });
    expect(email.subject).toBe("Sam Example invited you to Synthetic Firm");
    expect(email.text).toContain("You’ve been invited as a Case manager.");
  });
});
