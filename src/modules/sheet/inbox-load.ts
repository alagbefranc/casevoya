import "server-only";
import type { AnnouncementDialogData, BouncedRow, ComposeData, InboxData, ThreadItem, ThreadMail, TriageRow } from "@/components/sheet/designer/inbox";
import { createClient } from "@/lib/supabase/server";
import { readState } from "@/modules/messages/present";
import { approvedTemplates, consultantNames, messageTemplateOptions } from "@/modules/messages/templates-load";
import { firstNameOf } from "@/modules/messages/templates";
import { announcementCard, audienceLine, audienceOptions } from "@/modules/sheet/announcements-present";
import { loadSheetChrome, memberNames } from "@/modules/sheet/chrome-load";
import {
  attachment,
  bouncedFollowUp,
  DELIVERY_PROBLEM_STATUSES,
  deliveryProblem,
  deliveryProblemsPill,
  deliveryProblemsSince,
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
  withFileToMatter,
  type Candidate,
} from "@/modules/sheet/inbox-present";
import {
  canEmail,
  composeSendAttrs,
  composeValue,
  conversationChannels,
  messageMail,
  messageSendAttrs,
  noteAttrs,
  outboundMail,
  outboundStatus,
  replySendAttrs,
  type MessageChannel,
} from "@/modules/sheet/inbox-reply-present";
import type { SheetStaff } from "@/modules/sheet/load";
import { isoDateInTimeZone, type SheetQuery } from "@/modules/sheet/present";

type Client = Awaited<ReturnType<typeof createClient>>;

const READ = 100;
const DEFAULT_INBOUND_DOMAIN = "docs.casevoya.ca";

const NOTE_NO_MATTER = { "data-toast": "This conversation isn’t on a matter", "data-toast-kind": "warn", "data-toast-sub": "A staff-only note is kept on a matter. Nothing was saved." };

/** The conversation list's filter chips. */
const CONVERSATION_FILTERS = ["All", "Portal", "Email", "WhatsApp"];

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
      .select("id, from_email, subject, matter_id, attachments_done, sender_verified, created_at")
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
      ? supabase.from("inbound_inbox_items").select("id, inbound_email_id, filename, media_type, upload_state, created_at").eq("organization_id", org).in("inbound_email_id", ids).order("created_at")
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
    const suggestion = suggest({ emailId: row.id, organizationId: org, from, ready: row.attachments_done, verified: row.sender_verified, addressMatter, byEmail: candidates });
    const files = filesOf.get(row.id) ?? [];
    return {
      from: row.from_email,
      subject: row.subject || "(no subject)",
      attachments: files.map((item) => attachment(item.filename, item.upload_state, item.media_type)),
      ...suggestion,
      // OPS-06: File to matter, with a matter search and a choice per file.
      actions: withFileToMatter(suggestion.actions, { emailId: row.id, organizationId: org, ready: row.attachments_done, files }),
    };
  });

  table.push(...(await loadUnmoved(supabase, org)));

  const domain = (process.env.INBOUND_EMAIL_DOMAIN || DEFAULT_INBOUND_DOMAIN).trim().toLowerCase();
  return {
    copy: "Email sent to your firm’s address or a matter’s reply address, when Casevoya can’t tell which client sent it. Filing an email doesn’t give its sender access to a case.",
    sources: firm.data?.slug ? [{ logo: null, parts: [`${firm.data.slug}@${domain}`, "firm address and matter reply addresses"] }] : [],
    rows: table,
  };
}

/** Filed emails whose clean files did not all become documents: they stay here until they move. */
async function loadUnmoved(supabase: Client, org: string): Promise<TriageRow[]> {
  // A file staff left out when filing (skipped_at) never moves, so it doesn't keep the email here.
  const pending = await supabase.from("inbound_inbox_items").select("inbound_email_id").eq("organization_id", org).eq("upload_state", "clean").is("skipped_at", null).limit(READ);
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
    supabase.from("inbound_inbox_items").select("inbound_email_id, filename, media_type, upload_state").eq("organization_id", org).in("inbound_email_id", rows.map((row) => row.id)).neq("upload_state", "assigned").is("skipped_at", null),
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
  // Email staff wrote from here (matter_outbound_emails: staff who can read the matter only), and
  // the matters' secure messages (portal and WhatsApp, matter_messages: staff who read the matter).
  const [sentRows, messageRows] = await Promise.all([
    supabase
      .from("matter_outbound_emails")
      .select("id, matter_id, person_id, author_name, body, is_sample, outbox_event_id, created_at")
      .eq("organization_id", org)
      .order("created_at", { ascending: false })
      .limit(READ * 2),
    supabase
      .from("matter_messages")
      .select("id, thread_id, matter_id, author_kind, author_user_id, author_person_id, author_name, body, requires_ack, channel, created_at")
      .eq("organization_id", org)
      .order("created_at", { ascending: false })
      .limit(READ * 2),
  ]);
  const messages = messageRows.data ?? [];
  const threadIds = [...new Set(messages.map((row) => row.thread_id))];
  const audience = threadIds.length
    ? await supabase.from("message_thread_people").select("thread_id, person_id").eq("organization_id", org).in("thread_id", threadIds)
    : null;
  const peopleOf = new Map<string, string[]>();
  for (const row of audience?.data ?? []) peopleOf.set(row.thread_id, [...(peopleOf.get(row.thread_id) ?? []), row.person_id]);
  type Item =
    | { kind: "in"; id: string; matter_id: string | null; person_id: string; created_at: string; subject: string | null; text: string | null }
    | { kind: "out"; id: string; matter_id: string; person_id: string; created_at: string; author: string; text: string; sample: boolean; event: string }
    | { kind: "msg"; id: string; matter_id: string; person_id: string; created_at: string; author: string; text: string; channel: MessageChannel; thread: string; ack: boolean; staff: boolean; authorUser: string | null };
  // A message belongs to the conversation of every person its thread is addressed to.
  const messageItems: Item[] = messages.flatMap((row) => {
    const people = peopleOf.get(row.thread_id) ?? (row.author_person_id ? [row.author_person_id] : []);
    return people.map(
      (personId): Item => ({
        kind: "msg",
        id: row.id,
        matter_id: row.matter_id,
        person_id: personId,
        created_at: row.created_at,
        author: row.author_name,
        text: row.body,
        channel: row.channel === "whatsapp" ? "whatsapp" : "portal",
        thread: row.thread_id,
        ack: row.requires_ack,
        staff: row.author_kind === "staff",
        authorUser: row.author_user_id,
      }),
    );
  });
  const rows: Item[] = [
    ...messageItems,
    ...(emails.data ?? []).flatMap((row): Item[] =>
      row.person_id ? [{ kind: "in", id: row.id, matter_id: row.matter_id, person_id: row.person_id, created_at: row.created_at, subject: row.subject, text: row.text_body }] : [],
    ),
    ...(sentRows?.data ?? []).map(
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
    const list = threads.get(personId)!;
    const latest = list[0];
    return {
      href: `/sheet/inbox?tab=conv&view=${personId}`,
      selected: personId === selected,
      person: { name: name.get(personId) ?? "Person" },
      unread: false,
      line: [latest.matter_id ? labels.get(latest.matter_id) ?? "Matter" : "No matter", snippet(latest.kind === "in" ? latest.subject : null, latest.text)],
      when: listWhen(latest.created_at, staff.timezone, today),
      // The filter chips: which channels this conversation has.
      flags: conversationChannels(list.map((item) => (item.kind === "msg" ? item.channel : "email"))),
    };
  });

  if (!selected) return { filters: CONVERSATION_FILTERS, threads: items, view: null, filterEmpty: true };
  const all = [...threads.get(selected)!].slice(0, 20).reverse();
  const mails = all.filter((mail) => mail.kind === "in");
  const sent = all.filter((mail) => mail.kind === "out");
  const ids = mails.map((mail) => mail.id);
  const deliveries = sent.length
    ? await supabase.from("email_deliveries").select("outbox_event_id, status").eq("organization_id", org).in("outbox_event_id", sent.map((mail) => mail.event))
    : null;
  const deliveryOf = new Map((deliveries?.data ?? []).map((row) => [row.outbox_event_id, row.status as string]));
  // OPS-04: who read and acknowledged the staff messages shown (receipts: staff on the matter).
  const staffMessages = all.filter((mail) => mail.kind === "msg" && mail.staff);
  const receipts = staffMessages.length
    ? await supabase.from("matter_message_receipts").select("message_id, user_id, person_id, acknowledged_at").eq("organization_id", org).in("message_id", staffMessages.map((mail) => mail.id))
    : null;
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
    if (mail.kind === "msg") {
      const readers = mail.staff ? (receipts?.data ?? []).filter((row) => row.message_id === mail.id && row.user_id !== mail.authorUser && row.person_id) : [];
      const nameOf = (row: { person_id: string | null }) => name.get(row.person_id ?? "") ?? "Client";
      return messageMail({
        author: mail.author,
        when,
        body: mail.text,
        channel: mail.channel,
        ack: mail.ack,
        acked: readers.filter((row) => row.acknowledged_at).map(nameOf),
        state: mail.staff ? readState(readers.map(nameOf)) : null,
      });
    }
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
  // Send answers on the channel of the latest message: a portal or WhatsApp message goes back to
  // that matter thread (a staff message; WhatsApp replies go out while the client's window is
  // open); otherwise an email to this person on the latest mail's matter, a reply (threaded, "Re:")
  // to their latest filed email on that matter when there is one.
  const latestItem = all[all.length - 1];
  const replyTo = [...mails].reverse().find((mail) => mail.matter_id === latestMatter)?.id ?? null;
  const portal = latestItem.kind === "msg" ? latestItem : null;
  const send = portal
    ? messageSendAttrs({ organizationId: org, matterId: portal.matter_id, threadId: portal.thread, name: personName })
    : latestMatter
      ? replySendAttrs({
          organizationId: org,
          matterId: latestMatter,
          personId: selected,
          name: personName,
          hasEmail: Boolean(emailOf.get(selected)),
          replyToEmailId: replyTo,
        })
      : { "data-toast": "This email isn’t on a matter", "data-toast-kind": "warn", "data-toast-sub": "Nothing was sent." };
  const note = latestMatter ? noteAttrs(org, latestMatter) : NOTE_NO_MATTER;
  return {
    filters: CONVERSATION_FILTERS,
    filterEmpty: true,
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
      reply: {
        send: { label: `Send to ${first}`, attrs: send },
        note,
        acknowledge: `Ask ${first} to acknowledge`,
        // Acknowledgement is a portal message's (requires_ack); an email can't carry it.
        ackAttrs: portal ? { id: "rpAck" } : { disabled: "disabled", title: "Only a portal message can ask for an acknowledgement. This reply goes by email." },
      },
    },
  };
}

async function loadBounced(supabase: Client, staff: SheetStaff, now: Date): Promise<NonNullable<InboxData["bounced"]>> {
  const org = staff.organizationId;
  const [deliveries, tasks, members] = await Promise.all([
    supabase
      .from("email_deliveries")
      .select("id, recipient_email, template, status, critical, matter_id, attempt_count, created_at, follow_up_task_id")
      .eq("organization_id", org)
      .in("status", [...DELIVERY_PROBLEM_STATUSES])
      .gte("created_at", deliveryProblemsSince(now))
      .order("created_at", { ascending: false })
      .limit(READ),
    // The firm's open follow-up task: bounces recorded before follow_up_task_id existed match it by matter.
    supabase.from("tasks").select("id, matter_id, owner_membership_id, status").eq("organization_id", org).eq("task_key", "email_delivery_failure").in("status", ["open", "blocked"]).limit(1),
    memberNames(supabase, org),
  ]);
  const rows = deliveries.data ?? [];
  const addresses = [...new Set(rows.map((row) => row.recipient_email))];
  const linkedIds = [...new Set(rows.map((row) => row.follow_up_task_id).filter((id): id is string => Boolean(id)))];
  const [people, linked] = await Promise.all([
    addresses.length ? supabase.from("persons").select("display_name, email").eq("organization_id", org).in("email", addresses) : null,
    linkedIds.length ? supabase.from("tasks").select("id, matter_id, owner_membership_id, status").eq("organization_id", org).in("id", linkedIds) : null,
  ]);
  const nameOf = new Map((people?.data ?? []).map((row) => [row.email?.toLowerCase() ?? "", row.display_name]));
  const openTask = tasks.data?.[0] ?? null;
  const taskOf = new Map((linked?.data ?? []).map((row) => [row.id, row]));
  const followUpOf = (row: (typeof rows)[number]) => {
    if (row.follow_up_task_id) return taskOf.get(row.follow_up_task_id) ?? null;
    return openTask && row.critical && row.status === "bounced" && row.matter_id && row.matter_id === openTask.matter_id ? openTask : null;
  };
  const ownerOf = (task: { owner_membership_id: string | null } | null) => (task?.owner_membership_id ? members.get(task.owner_membership_id) ?? null : null);

  const table: BouncedRow[] = rows.map((row) => {
    const task = followUpOf(row);
    return {
      sent: sentWhen(row.created_at, staff.timezone),
      to: nameOf.get(row.recipient_email) ?? row.recipient_email,
      notice: noticeLabel(row.template, row.critical),
      problem: deliveryProblem(row.status, row.attempt_count),
      followUp: bouncedFollowUp({ status: row.status, critical: row.critical, matterId: row.matter_id, task: task ? { status: task.status, owner: ownerOf(task) } : null }),
      state: deliveryState(row.status),
    };
  });
  const critical = rows.find((row) => row.critical && row.status === "bounced");
  const task = critical ? followUpOf(critical) : null;
  const owner = ownerOf(task);
  const alert = critical
    ? {
        title: `${templateLabel(critical.template)} to ${nameOf.get(critical.recipient_email) ?? critical.recipient_email} didn’t arrive`,
        parts: [
          "address bounced",
          `${sentWhen(critical.created_at, staff.timezone)}. ${
            task ? `A follow-up task is ${task.status === "open" || task.status === "blocked" ? "open" : task.status}${owner ? ` for ${owner}` : ""}.` : "No follow-up task is open."
          }`,
        ],
        href: task?.matter_id ? `/sheet/matters/${task.matter_id}?tab=tasks` : "/sheet/tasks",
      }
    : null;
  return { alert, rows: table };
}

async function loadCompose(supabase: Client, staff: SheetStaff): Promise<ComposeData> {
  const org = staff.organizationId;
  const [matters, templates] = await Promise.all([
    supabase
      .from("matters")
      .select("id, reference, title, responsible_consultant_membership_id")
      .eq("organization_id", org)
      .neq("stage", "closed")
      .order("updated_at", { ascending: false })
      .limit(30),
    messageTemplateOptions(supabase, org),
  ]);
  const label = new Map((matters.data ?? []).map((row) => [row.id, row.reference || row.title]));
  const reference = new Map((matters.data ?? []).map((row) => [row.id, row.reference]));
  const consultant = await consultantNames(supabase, org, matters.data ?? []);
  const everyone = await participants(supabase, org, [...label.keys()]);
  const personIds = [...new Set(everyone.map((person) => person.personId))];
  const addresses = [...new Set(everyone.map((person) => person.email?.trim().toLowerCase()).filter((email): email is string => Boolean(email)))];
  const [prefs, suppressions] = await Promise.all([
    personIds.length ? supabase.from("person_contact_preferences").select("person_id, email_notices").eq("organization_id", org).in("person_id", personIds) : null,
    addresses.length ? supabase.from("email_suppressions").select("recipient_email").eq("organization_id", org).in("recipient_email", addresses) : null,
  ]);
  const emailOff = new Set((prefs?.data ?? []).filter((row) => row.email_notices === false).map((row) => row.person_id));
  const suppressed = new Set((suppressions?.data ?? []).map((row) => row.recipient_email.toLowerCase()));
  // Only people email can reach are offered: an address on file, email not turned off, not on the
  // do-not-send list. The database checks it all again on send.
  const people = everyone.filter((person) => canEmail({ email: person.email, emailOff: emailOff.has(person.personId) }, suppressed)).slice(0, 60);
  return {
    to: people.map((person) => [person.name, label.get(person.matterId) ?? "Matter"]),
    toValues: people.map((person) => composeValue(person.matterId, person.personId)),
    // OPS-04: what "Start from a template" fills in; an empty value stays a {field} to fill.
    toMerge: people.map((person) => ({
      "data-first": firstNameOf(person.name) ?? "",
      "data-ref": reference.get(person.matterId) ?? "",
      "data-consultant": consultant.get(person.matterId) ?? "",
    })),
    firmName: staff.organizationName,
    // The firm's approved message templates; with none, the template choice is not shown.
    templates: templates.length ? ["None", ...templates.map((row) => row.name)] : [],
    templateValues: templates.length ? [{ value: "", body: "" }, ...templates.map((row) => ({ value: row.id, body: row.body }))] : undefined,
    send: { attrs: composeSendAttrs(org) },
  };
}

/** Inbox > Announcements: the firm's sent announcements, and the New announcement dialog. */
async function loadNotes(supabase: Client, staff: SheetStaff): Promise<{ notes: NonNullable<InboxData["notes"]>; announce: AnnouncementDialogData }> {
  const org = staff.organizationId;
  const [sent, templates, audiences] = await Promise.all([
    supabase
      .from("announcements")
      .select("id, title, audience_kind, program_key, recipient_count, emailed_count, is_sample, created_at")
      .eq("organization_id", org)
      .order("created_at", { ascending: false })
      .limit(30),
    approvedTemplates(supabase, org, "announcement"),
    supabase.rpc("announcement_audiences", { p_organization_id: org }),
  ]);
  const rows = sent.data ?? [];
  const seen = rows.length
    ? await supabase.from("announcement_deliveries").select("announcement_id").eq("organization_id", org).in("announcement_id", rows.map((row) => row.id)).not("seen_at", "is", null)
    : null;
  const seenOf = new Map<string, number>();
  for (const row of seen?.data ?? []) seenOf.set(row.announcement_id, (seenOf.get(row.announcement_id) ?? 0) + 1);
  const firm = staff.organizationName;
  return {
    notes: {
      cards: rows.map((row) =>
        announcementCard(
          {
            title: row.title,
            audienceKind: row.audience_kind,
            programKey: row.program_key,
            recipients: row.recipient_count,
            emailed: row.emailed_count,
            seen: seenOf.get(row.id) ?? 0,
            sample: row.is_sample,
            createdAt: row.created_at,
          },
          staff.timezone,
        ),
      ),
    },
    announce: {
      organizationId: org,
      timezone: staff.timezone,
      // What clients will read: the firm's name merged, exactly as send_announcement does.
      templates: templates.map((row) => ({
        id: row.id,
        version: row.version,
        name: row.name,
        title: (row.title ?? "").replaceAll("{firm_name}", firm),
        body: row.body.replaceAll("{firm_name}", firm),
      })),
      audiences: audiences.error
        ? []
        : audienceOptions(audiences.data).map((option) => ({
            value: option.value,
            label: option.label,
            recipients: option.count.recipients,
            line: audienceLine(option.count, staff.sampleMode),
          })),
      canSend: staff.role === "firm_owner" || staff.role === "licensed_consultant",
    },
  };
}

/** The Designer's Inbox for a firm, read as the signed-in staff member so RLS decides what is visible. */
export async function loadSheetInbox(staff: SheetStaff, query: SheetQuery, now: Date = new Date()) {
  const supabase = await createClient({ organizationId: staff.organizationId });
  const org = staff.organizationId;
  const today = isoDateInTimeZone(now, staff.timezone);
  const tab = inboxTab(query.tab);
  const count = { count: "exact" as const, head: true };

  const [chrome, triageCount, problemCount, compose, conv, triage, bounced, notes] = await Promise.all([
    loadSheetChrome(staff, "/sheet/inbox"),
    supabase.from("inbound_emails").select("id", count).eq("organization_id", org).eq("triage_state", "open"),
    // The same rows as the Delivery problems tab (deliveryProblemsSince): one definition.
    supabase.from("email_deliveries").select("id", count).eq("organization_id", org).in("status", [...DELIVERY_PROBLEM_STATUSES]).gte("created_at", deliveryProblemsSince(now)),
    loadCompose(supabase, staff),
    tab === "conv" ? loadConversations(supabase, staff, query, today) : undefined,
    tab === "triage" ? loadTriage(supabase, staff) : undefined,
    tab === "bounced" ? loadBounced(supabase, staff, now) : undefined,
    tab === "notes" ? loadNotes(supabase, staff) : undefined,
  ]);
  const pills = [`${triageCount.count ?? 0} to triage`, deliveryProblemsPill(problemCount.count ?? 0)];
  const inbox: InboxData = { tab, conv, triage, bounced, notes: notes?.notes };
  return { chrome, pills, inbox, compose, announce: notes?.announce ?? null };
}
