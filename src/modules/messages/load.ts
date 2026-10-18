import "server-only";

import { createClient } from "@/lib/supabase/server";
import { isUuid } from "@/lib/tenant/context";
import type { PortalViewer } from "@/modules/portal/load";
import type { SheetStaff } from "@/modules/sheet/load";
import {
  previewOf,
  sortThreads,
  type ChatAttachment,
  type ChatAudienceOption,
  type ChatData,
  type ChatDocument,
  type ChatMessage,
  type ChatThread,
} from "./present";

type Client = Awaited<ReturnType<typeof createClient>>;

const MESSAGE_LIMIT = 1000;

const ROLE: Record<string, string> = {
  applicant: "Applicant",
  dependant: "Dependant",
  sponsor: "Sponsor",
  employer: "Employer",
  guardian: "Guardian",
};

type Raw = {
  threads: { id: string; matter_id: string; last_message_at: string; is_sample: boolean }[];
  people: { thread_id: string; person_id: string }[];
  messages: {
    id: string;
    thread_id: string;
    body: string;
    created_at: string;
    author_user_id: string;
    author_kind: string;
    author_name: string;
    requires_ack: boolean;
  }[];
  attachments: { message_id: string; document_id: string }[];
  receipts: { message_id: string; user_id: string; person_id: string | null; acknowledged_at: string | null }[];
};

/** Every thread the caller can read (RLS), with its messages, attachments and receipts. */
async function readRaw(supabase: Client, org: string, matterId: string | null): Promise<Raw> {
  let threadQuery = supabase
    .from("message_threads")
    .select("id, matter_id, last_message_at, is_sample")
    .eq("organization_id", org)
    .order("last_message_at", { ascending: false })
    .limit(200);
  if (matterId) threadQuery = threadQuery.eq("matter_id", matterId);
  const threads = (await threadQuery).data ?? [];
  const ids = threads.map((row) => row.id);
  if (!ids.length) return { threads, people: [], messages: [], attachments: [], receipts: [] };
  const [people, messages] = await Promise.all([
    supabase.from("message_thread_people").select("thread_id, person_id").eq("organization_id", org).in("thread_id", ids),
    supabase
      .from("matter_messages")
      .select("id, thread_id, body, created_at, author_user_id, author_kind, author_name, requires_ack")
      .eq("organization_id", org)
      .in("thread_id", ids)
      .order("created_at", { ascending: false })
      .limit(MESSAGE_LIMIT),
  ]);
  const messageIds = (messages.data ?? []).map((row) => row.id);
  const [attachments, receipts] = messageIds.length
    ? await Promise.all([
        supabase.from("matter_message_attachments").select("message_id, document_id").eq("organization_id", org).in("message_id", messageIds),
        supabase.from("matter_message_receipts").select("message_id, user_id, person_id, acknowledged_at").eq("organization_id", org).in("message_id", messageIds),
      ])
    : [null, null];
  return {
    threads,
    people: people.data ?? [],
    messages: messages.data ?? [],
    attachments: attachments?.data ?? [],
    receipts: receipts?.data ?? [],
  };
}

async function documentRows(supabase: Client, org: string, ids: string[]) {
  if (!ids.length) return new Map<string, { purpose: string; current_version_id: string | null; person_id: string; audience: string; sensitivity: string }>();
  const docs = await supabase
    .from("documents")
    .select("id, purpose, current_version_id, person_id, audience, sensitivity")
    .eq("organization_id", org)
    .in("id", ids);
  return new Map((docs.data ?? []).map((row) => [row.id, row]));
}

/** Documents on the given matters that the caller can read (RLS), for the attach picker. */
async function attachable(supabase: Client, org: string, matterIds: string[]): Promise<ChatDocument[]> {
  if (!matterIds.length) return [];
  const refs = await supabase
    .from("document_matter_refs")
    .select("document_id")
    .eq("organization_id", org)
    .in("matter_id", matterIds)
    .is("removed_at", null)
    .limit(300);
  const ids = [...new Set((refs.data ?? []).map((row) => row.document_id))];
  const docs = await documentRows(supabase, org, ids);
  return [...docs.entries()]
    .filter(([, doc]) => doc.audience !== "staff" && doc.current_version_id)
    .map(([id, doc]) => ({ id, label: doc.purpose, personId: doc.person_id, audience: doc.audience, sensitivity: doc.sensitivity }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

function assemble(input: {
  raw: Raw;
  me: string;
  mode: "portal" | "staff";
  names: Map<string, string>;
  matterTitles: Map<string, string>;
  matterPeople: Map<string, string[]>;
  docs: Map<string, { purpose: string; current_version_id: string | null }>;
  documentHref: (matterId: string) => string | null;
}): { threads: ChatThread[]; messages: ChatMessage[] } {
  const { raw, me, mode, names } = input;
  const audienceOf = new Map<string, string[]>();
  for (const row of raw.people) {
    const list = audienceOf.get(row.thread_id) ?? [];
    list.push(row.person_id);
    audienceOf.set(row.thread_id, list);
  }
  const matterOf = new Map(raw.threads.map((row) => [row.id, row.matter_id]));
  const attachmentsOf = new Map<string, ChatAttachment[]>();
  for (const row of raw.attachments) {
    const doc = input.docs.get(row.document_id);
    const matterId = matterOf.get(raw.messages.find((m) => m.id === row.message_id)?.thread_id ?? "") ?? "";
    const list = attachmentsOf.get(row.message_id) ?? [];
    list.push({
      documentId: row.document_id,
      label: doc?.purpose ?? "Document",
      versionId: mode === "portal" ? doc?.current_version_id ?? null : null,
      href: mode === "staff" ? input.documentHref(matterId) : null,
    });
    attachmentsOf.set(row.message_id, list);
  }
  const receiptsOf = new Map<string, Raw["receipts"]>();
  for (const row of raw.receipts) {
    const list = receiptsOf.get(row.message_id) ?? [];
    list.push(row);
    receiptsOf.set(row.message_id, list);
  }

  const messages: ChatMessage[] = raw.messages.map((row) => {
    const receipts = receiptsOf.get(row.id) ?? [];
    const mine = row.author_user_id === me;
    const own = receipts.find((receipt) => receipt.user_id === me);
    const others = receipts.filter((receipt) => receipt.user_id !== row.author_user_id);
    const ackers = others.filter((receipt) => receipt.acknowledged_at && receipt.person_id);
    return {
      id: row.id,
      threadId: row.thread_id,
      body: row.body,
      createdAt: row.created_at,
      mine,
      authorName: row.author_name,
      authorKind: row.author_kind === "staff" ? "staff" : "client",
      requiresAck: row.requires_ack,
      acknowledged: mode === "portal" ? Boolean(own?.acknowledged_at) : ackers.length > 0,
      acknowledgedBy: ackers.map((receipt) => names.get(receipt.person_id ?? "") ?? "Client"),
      readBy:
        mode === "staff"
          ? others.filter((receipt) => receipt.person_id).map((receipt) => names.get(receipt.person_id ?? "") ?? "Client")
          : [],
      unread: !mine && !own,
      attachments: attachmentsOf.get(row.id) ?? [],
    };
  });

  const threads: ChatThread[] = raw.threads.map((row) => {
    const people = audienceOf.get(row.id) ?? [];
    const audience = people.map((id) => names.get(id) ?? "Client");
    const onMatter = input.matterPeople.get(row.matter_id) ?? [];
    const excluded = onMatter.filter((id) => !people.includes(id)).map((id) => names.get(id) ?? "").filter(Boolean);
    const own = messages.filter((message) => message.threadId === row.id);
    const last = own[0];
    const staffAuthor = own.find((message) => message.authorKind === "staff");
    const title =
      mode === "staff"
        ? audience.join(", ") || "Client"
        : people.length > 1
          ? audience.join(", ")
          : staffAuthor?.authorName ?? "Your firm";
    return {
      id: row.id,
      matterId: row.matter_id,
      matterTitle: input.matterTitles.get(row.matter_id) ?? "Matter",
      title,
      audience,
      audienceIds: people,
      excluded,
      lastAt: last?.createdAt ?? row.last_message_at,
      preview: last ? previewOf(last.body) : "",
      unread: own.filter((message) => message.unread).length,
      sample: row.is_sample,
    };
  });
  return { threads: sortThreads(threads), messages };
}

function pick(threads: ChatThread[], wanted: string | null | undefined): string | null {
  if (wanted && isUuid(wanted) && threads.some((thread) => thread.id === wanted)) return wanted;
  return threads[0]?.id ?? null;
}

/** The portal Messages page for the signed-in client. */
export async function loadPortalMessages(viewer: PortalViewer, threadId?: string | null): Promise<ChatData> {
  const org = viewer.organizationId;
  const supabase = await createClient({ organizationId: org });
  const { data: claims } = await supabase.auth.getClaims();
  const me = String(claims?.claims?.sub ?? "");
  const raw = await readRaw(supabase, org, null);
  const matterIds = viewer.matters.map((matter) => matter.id);
  const participants = matterIds.length
    ? (await supabase.from("matter_participants").select("matter_id, person_id").eq("organization_id", org).in("matter_id", matterIds)).data ?? []
    : [];
  const matterPeople = new Map<string, string[]>();
  for (const row of participants) {
    if (!row.person_id) continue;
    const list = matterPeople.get(row.matter_id) ?? [];
    if (!list.includes(row.person_id)) list.push(row.person_id);
    matterPeople.set(row.matter_id, list);
  }
  const names = new Map(viewer.people.map((person) => [person.id, person.displayName]));
  const docIds = [...new Set(raw.attachments.map((row) => row.document_id))];
  const [docs, documents] = await Promise.all([documentRows(supabase, org, docIds), attachable(supabase, org, matterIds)]);
  const { threads, messages } = assemble({
    raw,
    me,
    mode: "portal",
    names,
    matterTitles: new Map(viewer.matters.map((matter) => [matter.id, matter.title])),
    matterPeople,
    docs,
    documentHref: () => null,
  });
  const self = viewer.person?.id ?? null;
  return {
    mode: "portal",
    organizationId: org,
    firmName: viewer.organizationName,
    timezone: viewer.timezone,
    now: new Date().toISOString(),
    threads,
    messages,
    selectedId: pick(threads, threadId),
    opened: Boolean(threadId && threads.some((thread) => thread.id === threadId)),
    matters: viewer.matters.map((matter) => ({ id: matter.id, title: matter.title })),
    audienceOptions: [],
    // A client attaches their own documents only (the firm may share others in a thread).
    documents: documents.filter((doc) => doc.personId === self),
    selfPersonId: self,
    matterId: null,
  };
}

/** The matter workspace's Messages tab for staff: threads, audience options and documents. Staff notes stay separate. */
export async function loadMatterMessages(staff: SheetStaff, matterId: string, threadId?: string | null): Promise<ChatData> {
  const org = staff.organizationId;
  const supabase = await createClient({ organizationId: org });
  const { data: claims } = await supabase.auth.getClaims();
  const me = String(claims?.claims?.sub ?? "");
  const [raw, matter, participants] = await Promise.all([
    readRaw(supabase, org, matterId),
    supabase.from("matters").select("id, title").eq("organization_id", org).eq("id", matterId).maybeSingle(),
    supabase.from("matter_participants").select("person_id, role").eq("organization_id", org).eq("matter_id", matterId).not("person_id", "is", null),
  ]);
  const personIds = [...new Set((participants.data ?? []).map((row) => row.person_id).filter((id): id is string => Boolean(id)))];
  const persons = personIds.length
    ? (await supabase.from("persons").select("id, display_name, email").eq("organization_id", org).in("id", personIds)).data ?? []
    : [];
  const names = new Map(persons.map((row) => [row.id, row.display_name]));
  const roleOf = new Map<string, string>();
  for (const row of participants.data ?? []) {
    if (row.person_id && !roleOf.has(row.person_id)) roleOf.set(row.person_id, ROLE[row.role] ?? row.role);
  }
  const docIds = [...new Set(raw.attachments.map((row) => row.document_id))];
  const [docs, documents] = await Promise.all([documentRows(supabase, org, docIds), attachable(supabase, org, [matterId])]);
  const title = matter.data?.title ?? "Matter";
  const { threads, messages } = assemble({
    raw,
    me,
    mode: "staff",
    names,
    matterTitles: new Map([[matterId, title]]),
    matterPeople: new Map([[matterId, personIds]]),
    docs,
    documentHref: (id) => (id ? `/sheet/matters/${id}?tab=documents` : null),
  });
  const audienceOptions: ChatAudienceOption[] = persons
    .map((row) => ({ personId: row.id, name: row.display_name, role: roleOf.get(row.id) ?? "Person", email: Boolean(row.email) }))
    .sort((a, b) => a.name.localeCompare(b.name));
  return {
    mode: "staff",
    organizationId: org,
    firmName: staff.organizationName,
    timezone: staff.timezone,
    now: new Date().toISOString(),
    threads,
    messages,
    selectedId: pick(threads, threadId),
    opened: Boolean(threadId && threads.some((thread) => thread.id === threadId)),
    matters: [{ id: matterId, title }],
    audienceOptions,
    documents,
    selfPersonId: null,
    matterId,
  };
}
