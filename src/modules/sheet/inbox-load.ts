import "server-only";
import type { BouncedRow, ComposeData, InboxData, ThreadItem, ThreadMail, TriageRow } from "@/components/sheet/designer/inbox";
import { createClient } from "@/lib/supabase/server";
import { loadSheetChrome, memberNames } from "@/modules/sheet/chrome-load";
import {
  attachment,
  deliveryProblem,
  deliveryState,
  inboxTab,
  listWhen,
  mailWhen,
  noticeLabel,
  partyRoleLabel,
  plural,
  sentWhen,
  snippet,
  suggest,
  templateLabel,
  type Candidate,
} from "@/modules/sheet/inbox-present";
import { composeSendAttrs, composeValue, outboundMail, outboundStatus, replySendAttrs } from "@/modules/sheet/inbox-reply-present";
import type { SheetStaff } from "@/modules/sheet/load";
import { isoDateInTimeZone, plusDays, type SheetQuery } from "@/modules/sheet/present";

type Client = Awaited<ReturnType<typeof createClient>>;

const READ = 100;
const RECENT_DAYS = 60;
const DEFAULT_INBOUND_DOMAIN = "docs.casevoya.ca";

const NOTE_SEND = { "data-toast": "Staff-only notes aren’t saved here yet", "data-toast-kind": "warn", "data-toast-sub": "Nothing was saved." };

function firstName(name: string): string {
  return name.trim().split(/\s+/)[0] || name;
}

async function matterLabels(supabase: Client, org: string, ids: string[]) {
  const unique = [...new Set(ids)];
  const rows = unique.length ? await supabase.from("matters").select("id, reference, title").eq("organization_id", org).in("id", unique) : null;
  return new Map((rows?.data ?? []).map((row) => [row.id, row.reference || row.title]));
}

/** People on the given matters, as RLS shows them to the viewer. */
async function participants(supabase: Client, org: string, matterIds: string[]) {
  if (!matterIds.length) return [] as { matterId: string; personId: string; role: string; name: string; email: string | null }[];
  const parties = await supabase.from("matter_participants").select("matter_id, person_id, role").eq("organization_id", org).in("matter_id", matterIds).not("person_id", "is", null);
  const ids = [...new Set((parties.data ?? []).map((row) => row.person_id).filter((id): id is string => Boolean(id)))];
  const people = ids.length ? await supabase.from("persons").select("id, display_name, email").eq("organization_id", org).in("id", ids) : null;
  const person = new Map((people?.data ?? []).map((row) => [row.id, row]));
  return (parties.data ?? []).flatMap((row) => {
    const found = row.person_id ? person.get(row.person_id) : undefined;
    return found ? [{ matterId: row.matter_id, personId: found.id, role: row.role as string, name: found.display_name, email: found.email }] : [];
  });
}

async function loadTriage(supabase: Client, staff: SheetStaff): Promise<NonNullable<InboxData["triage"]>> {
  const org = staff.organizationId;
  const [emails, firm] = await Promise.all([
    supabase
      .from("inbound_emails")
      .select("id, from_email, subject, matter_id, attachments_done, created_at")
      .eq("organization_id", org)
      .eq("triage_state", "open")
      .order("created_at", { ascending: false })
      .limit(READ),
    supabase.from("organizations").select("slug").eq("id", org).maybeSingle(),
  ]);
  const rows = emails.data ?? [];
  const ids = rows.map((row) => row.id);
  const senders = [...new Set(rows.map((row) => row.from_email.toLowerCase()))];
  const [items, byEmail] = await Promise.all([
    ids.length
      ? supabase.from("inbound_inbox_items").select("inbound_email_id, filename, media_type, upload_state, created_at").eq("organization_id", org).in("inbound_email_id", ids).order("created_at")
      : null,
    senders.length ? supabase.from("persons").select("id, display_name, email").eq("organization_id", org).in("email", senders) : null,
  ]);
  const matched = byEmail?.data ?? [];
  const matterIds = rows.map((row) => row.matter_id).filter((id): id is string => Boolean(id));
  const [onAddressMatters, matchedParties] = await Promise.all([
    participants(supabase, org, matterIds),
    matched.length
      ? supabase.from("matter_participants").select("matter_id, person_id").eq("organization_id", org).in("person_id", matched.map((row) => row.id))
      : null,
  ]);
  const labels = await matterLabels(supabase, org, [...matterIds, ...(matchedParties?.data ?? []).map((row) => row.matter_id)]);

  const filesOf = new Map<string, NonNullable<typeof items>["data"]>();
  for (const item of items?.data ?? []) filesOf.set(item.inbound_email_id, [...(filesOf.get(item.inbound_email_id) ?? []), item]);

  const table: TriageRow[] = rows.map((row) => {
    const label = row.matter_id ? labels.get(row.matter_id) : undefined;
    const addressMatter =
      row.matter_id && label
        ? {
            id: row.matter_id,
            label,
            people: onAddressMatters
              .filter((party) => party.matterId === row.matter_id)
              .map((party): Candidate => ({ personId: party.personId, name: party.name, matterId: party.matterId, matter: label, email: party.email })),
          }
        : null;
    const from = row.from_email.toLowerCase();
    const candidates: Candidate[] = matched
      .filter((person) => person.email?.toLowerCase() === from)
      .flatMap((person) =>
        (matchedParties?.data ?? [])
          .filter((party) => party.person_id === person.id && labels.has(party.matter_id))
          .map((party) => ({ personId: person.id, name: person.display_name, matterId: party.matter_id, matter: labels.get(party.matter_id) ?? "Matter", email: person.email })),
      );
    const suggestion = suggest({ emailId: row.id, organizationId: org, from, ready: row.attachments_done, addressMatter, byEmail: candidates });
    return {
      from: row.from_email,
      subject: row.subject || "(no subject)",
      attachments: (filesOf.get(row.id) ?? []).map((item) => attachment(item.filename, item.upload_state, item.media_type)),
      ...suggestion,
    };
  });

  table.push(...(await loadUnmoved(supabase, org)));

  const domain = (process.env.INBOUND_EMAIL_DOMAIN || DEFAULT_INBOUND_DOMAIN).trim().toLowerCase();
  return {
    copy: "Email sent to your firm’s address or a matter’s reply address, when Casevoya can’t tell which client sent it. Filing an email doesn’t give its sender access to a case (OPS-06).",
    sources: firm.data?.slug ? [{ logo: null, parts: [`${firm.data.slug}@${domain}`, "firm address and matter reply addresses"] }] : [],
    rows: table,
  };
}

/** Filed emails whose clean files did not all become documents: they stay here until they move. */
async function loadUnmoved(supabase: Client, org: string): Promise<TriageRow[]> {
  const pending = await supabase.from("inbound_inbox_items").select("inbound_email_id").eq("organization_id", org).eq("upload_state", "clean").limit(READ);
  const ids = [...new Set((pending.data ?? []).map((row) => row.inbound_email_id))];
  if (!ids.length) return [];
  const emails = await supabase
    .from("inbound_emails")
    .select("id, from_email, subject, matter_id, person_id")
    .eq("organization_id", org)
    .eq("triage_state", "filed")
    .in("id", ids)
    .order("created_at", { ascending: false });
  const rows = (emails.data ?? []).filter((row) => row.matter_id && row.person_id);
  if (!rows.length) return [];
  const [items, people, labels] = await Promise.all([
    supabase.from("inbound_inbox_items").select("inbound_email_id, filename, media_type, upload_state").eq("organization_id", org).in("inbound_email_id", rows.map((row) => row.id)).neq("upload_state", "assigned"),
    supabase.from("persons").select("id, display_name").eq("organization_id", org).in("id", rows.map((row) => row.person_id!)),
    matterLabels(supabase, org, rows.map((row) => row.matter_id!)),
  ]);
  const name = new Map((people.data ?? []).map((row) => [row.id, row.display_name]));
  return rows.map((row) => ({
    from: row.from_email,
    subject: row.subject || "(no subject)",
    attachments: (items.data ?? []).filter((item) => item.inbound_email_id === row.id).map((item) => attachment(item.filename, item.upload_state, item.media_type)),
    suggestion: [labels.get(row.matter_id!) ?? "Matter", name.get(row.person_id!) ?? "Person"],
    why: ["Filed", "some files didn’t move to documents yet"],
    actions: [{ label: "Move files", primary: true, attrs: { "data-inbox-move": row.id, "data-org": org } }],
  }));
}

async function loadConversations(supabase: Client, staff: SheetStaff, query: SheetQuery, today: string): Promise<NonNullable<InboxData["conv"]>> {
  const org = staff.organizationId;
  const emails = await supabase
    .from("inbound_emails")
    .select("id, from_email, subject, text_body, matter_id, person_id, created_at")
    .eq("organization_id", org)
    .eq("triage_state", "filed")
    .not("person_id", "is", null)
    .order("created_at", { ascending: false })
    .limit(READ * 2);
  // Email staff wrote from here (matter_outbound_emails: staff who can read the matter only).
  const sentRows = await supabase
    .from("matter_outbound_emails")
    .select("id, matter_id, person_id, author_name, body, is_sample, outbox_event_id, created_at")
    .eq("organization_id", org)
    .order("created_at", { ascending: false })
    .limit(READ * 2);
  type Item =
    | { kind: "in"; id: string; matter_id: string | null; person_id: string; created_at: string; subject: string | null; text: string | null }
    | { kind: "out"; id: string; matter_id: string; person_id: string; created_at: string; author: string; text: string; sample: boolean; event: string };
  const rows: Item[] = [
    ...(emails.data ?? []).flatMap((row): Item[] =>
      row.person_id ? [{ kind: "in", id: row.id, matter_id: row.matter_id, person_id: row.person_id, created_at: row.created_at, subject: row.subject, text: row.text_body }] : [],
    ),
    ...(sentRows.data ?? []).map(
      (row): Item => ({
        kind: "out",
        id: row.id,
        matter_id: row.matter_id,
        person_id: row.person_id,
        created_at: row.created_at,
        author: row.author_name,
        text: row.body,
        sample: row.is_sample,
        event: row.outbox_event_id,
      }),
    ),
  ].sort((a, b) => b.created_at.localeCompare(a.created_at));
  const personIds = [...new Set(rows.map((row) => row.person_id))];
  const matterIds = [...new Set(rows.map((row) => row.matter_id).filter((id): id is string => Boolean(id)))];
  const [people, labels, parties] = await Promise.all([
    personIds.length ? supabase.from("persons").select("id, display_name, email").eq("organization_id", org).in("id", personIds) : null,
    matterLabels(supabase, org, matterIds),
    matterIds.length ? supabase.from("matter_participants").select("matter_id, person_id, role").eq("organization_id", org).in("matter_id", matterIds) : null,
  ]);
  const name = new Map((people?.data ?? []).map((row) => [row.id, row.display_name]));
  const emailOf = new Map((people?.data ?? []).map((row) => [row.id, row.email]));

  // One conversation per person, newest first. The person must be readable to the viewer.
  const threads = new Map<string, Item[]>();
  for (const row of rows) {
    if (!name.has(row.person_id)) continue;
    threads.set(row.person_id, [...(threads.get(row.person_id) ?? []), row]);
  }
  const keys = [...threads.keys()];
  const selected = query.view && threads.has(query.view) ? query.view : keys[0];
  const items: ThreadItem[] = keys.map((personId) => {
    const latest = threads.get(personId)![0];
    return {
      href: `/sheet/inbox?tab=conv&view=${personId}`,
      selected: personId === selected,
      person: { name: name.get(personId) ?? "Person" },
      unread: false,
      line: [latest.matter_id ? labels.get(latest.matter_id) ?? "Matter" : "No matter", snippet(latest.kind === "in" ? latest.subject : null, latest.text)],
      when: listWhen(latest.created_at, staff.timezone, today),
    };
  });

  if (!selected) return { filters: ["All"], threads: items, view: null };
  const all = [...threads.get(selected)!].slice(0, 20).reverse();
  const mails = all.filter((mail) => mail.kind === "in");
  const sent = all.filter((mail) => mail.kind === "out");
  const ids = mails.map((mail) => mail.id);
  const deliveries = sent.length
    ? await supabase.from("email_deliveries").select("outbox_event_id, status").eq("organization_id", org).in("outbox_event_id", sent.map((mail) => mail.event))
    : null;
  const deliveryOf = new Map((deliveries?.data ?? []).map((row) => [row.outbox_event_id, row.status as string]));
  const files = ids.length
    ? await supabase.from("inbound_attachment_files").select("inbound_email_id, version_id, inbox_item_id").eq("organization_id", org).in("inbound_email_id", ids)
    : null;
  const filesOf = new Map<string, { filed: number; waiting: number }>();
  for (const file of files?.data ?? []) {
    const count = filesOf.get(file.inbound_email_id) ?? { filed: 0, waiting: 0 };
    if (file.version_id) count.filed++;
    else count.waiting++;
    filesOf.set(file.inbound_email_id, count);
  }
  const personName = name.get(selected) ?? "Person";
  const first = firstName(personName);
  const latestMatter = all[all.length - 1].matter_id;
  const role = partyRoleLabel((parties?.data ?? []).find((party) => party.person_id === selected && party.matter_id === latestMatter)?.role);
  const threadMails: ThreadMail[] = all.map((mail) => {
    const when = mailWhen(mail.created_at, staff.timezone, today);
    if (mail.kind === "out") {
      return outboundMail({ author: mail.author, when, body: mail.text, status: outboundStatus(deliveryOf.get(mail.event), mail.sample).label });
    }
    const count = filesOf.get(mail.id);
    const total = count ? count.filed + count.waiting : 0;
    return {
      meta: [first, when, "via email"],
      body: (mail.text ?? "").trim().slice(0, 4000) || mail.subject || "(no text)",
      files: total ? [plural(total, "file"), count!.waiting ? "some still in Email to triage" : "filed to documents"] : null,
    };
  });
  // Send writes to this person on the latest mail's matter; it is a reply (threaded, "Re:") to
  // their latest filed email on that matter, when there is one.
  const replyTo = [...mails].reverse().find((mail) => mail.matter_id === latestMatter)?.id ?? null;
  const send = latestMatter
    ? replySendAttrs({
        organizationId: org,
        matterId: latestMatter,
        personId: selected,
        name: personName,
        hasEmail: Boolean(emailOf.get(selected)),
        replyToEmailId: replyTo,
      })
    : { "data-toast": "This email isn’t on a matter", "data-toast-kind": "warn", "data-toast-sub": "Nothing was sent." };
  return {
    filters: ["All"],
    threads: items,
    view: {
      title: [personName, latestMatter ? labels.get(latestMatter) ?? "Matter" : "No matter"],
      role: role ? { tone: "gr", label: role } : null,
      mails: threadMails,
      vo: null,
      audience: {
        title: `Audience: ${personName}${role ? ` (${role.toLowerCase()})` : ""} and ${staff.organizationName} staff on this file`,
        copy: "Other people’s private records can’t be attached to this message.",
      },
      reply: { send: { label: `Send to ${first}`, attrs: send }, note: NOTE_SEND, acknowledge: `Ask ${first} to acknowledge` },
    },
  };
}

async function loadBounced(supabase: Client, staff: SheetStaff, now: Date): Promise<NonNullable<InboxData["bounced"]>> {
  const org = staff.organizationId;
  const since = new Date(now.getTime() - RECENT_DAYS * 86_400_000).toISOString();
  const [deliveries, tasks, members] = await Promise.all([
    supabase
      .from("email_deliveries")
      .select("id, recipient_email, template, status, critical, matter_id, attempt_count, created_at")
      .eq("organization_id", org)
      .in("status", ["bounced", "suppressed", "failed"])
      .gte("created_at", since)
      .order("created_at", { ascending: false })
      .limit(READ),
    supabase.from("tasks").select("id, matter_id, owner_membership_id").eq("organization_id", org).eq("task_key", "email_delivery_failure").in("status", ["open", "blocked"]).limit(1),
    memberNames(supabase, org),
  ]);
  const rows = deliveries.data ?? [];
  const addresses = [...new Set(rows.map((row) => row.recipient_email))];
  const people = addresses.length ? await supabase.from("persons").select("display_name, email").eq("organization_id", org).in("email", addresses) : null;
  const nameOf = new Map((people?.data ?? []).map((row) => [row.email?.toLowerCase() ?? "", row.display_name]));
  const task = tasks.data?.[0] ?? null;
  const owner = task?.owner_membership_id ? members.get(task.owner_membership_id) : undefined;

  const table: BouncedRow[] = rows.map((row) => {
    const followed = task && row.critical && row.status === "bounced" && row.matter_id && row.matter_id === task.matter_id;
    return {
      sent: sentWhen(row.created_at, staff.timezone),
      to: nameOf.get(row.recipient_email) ?? row.recipient_email,
      notice: noticeLabel(row.template, row.critical),
      problem: deliveryProblem(row.status, row.attempt_count),
      followUp: followed ? [owner ?? "Unassigned", "task open"] : "—",
      state: deliveryState(row.status),
    };
  });
  const critical = rows.find((row) => row.critical && row.status === "bounced");
  const alert = critical
    ? {
        title: `${templateLabel(critical.template)} to ${nameOf.get(critical.recipient_email) ?? critical.recipient_email} didn’t arrive`,
        parts: [
          "address bounced",
          `${sentWhen(critical.created_at, staff.timezone)}. ${task ? `A follow-up task is open${owner ? ` for ${owner}` : ""}.` : "No follow-up task is open."}`,
        ],
        href: task?.matter_id ? `/sheet/matters/${task.matter_id}?tab=tasks` : "/sheet/tasks",
      }
    : null;
  return { alert, rows: table };
}

async function loadCompose(supabase: Client, staff: SheetStaff): Promise<ComposeData> {
  const org = staff.organizationId;
  const matters = await supabase.from("matters").select("id, reference, title").eq("organization_id", org).neq("stage", "closed").order("updated_at", { ascending: false }).limit(30);
  const label = new Map((matters.data ?? []).map((row) => [row.id, row.reference || row.title]));
  // Only people with an email address can be written to; the database checks it again on send.
  const people = (await participants(supabase, org, [...label.keys()])).filter((person) => Boolean(person.email)).slice(0, 60);
  return {
    to: people.map((person) => [person.name, label.get(person.matterId) ?? "Matter"]),
    toValues: people.map((person) => composeValue(person.matterId, person.personId)),
    templates: ["None"],
    send: { attrs: composeSendAttrs(org) },
  };
}

/** The Designer's Inbox for a firm, read as the signed-in staff member so RLS decides what is visible. */
export async function loadSheetInbox(staff: SheetStaff, query: SheetQuery, now: Date = new Date()) {
  const supabase = await createClient({ organizationId: staff.organizationId });
  const org = staff.organizationId;
  const today = isoDateInTimeZone(now, staff.timezone);
  const tab = inboxTab(query.tab);
  const count = { count: "exact" as const, head: true };
  const since = `${plusDays(today, -30)}T00:00:00Z`;

  const [chrome, triageCount, bouncedCount, compose, conv, triage, bounced] = await Promise.all([
    loadSheetChrome(staff, "/sheet/inbox"),
    supabase.from("inbound_emails").select("id", count).eq("organization_id", org).eq("triage_state", "open"),
    supabase.from("email_deliveries").select("id", count).eq("organization_id", org).eq("status", "bounced").gte("created_at", since),
    loadCompose(supabase, staff),
    tab === "conv" ? loadConversations(supabase, staff, query, today) : undefined,
    tab === "triage" ? loadTriage(supabase, staff) : undefined,
    tab === "bounced" ? loadBounced(supabase, staff, now) : undefined,
  ]);
  const bouncedN = bouncedCount.count ?? 0;
  const pills = [`${triageCount.count ?? 0} to triage`, `${bouncedN} bounced notice${bouncedN === 1 ? "" : "s"}`];
  const inbox: InboxData = { tab, conv, triage, bounced, notes: tab === "notes" ? { cards: [] } : undefined };
  return { chrome, pills, inbox, compose };
}
