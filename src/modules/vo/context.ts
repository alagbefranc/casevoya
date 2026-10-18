import "server-only";

import type { createClient } from "@/lib/supabase/server";
import { MAX_CONTEXT_MESSAGES, type VoContext, type VoKind } from "./prompt";

type Client = Awaited<ReturnType<typeof createClient>>;

export type VoSource = { kind: "message" | "matter" | "document_request"; id: string; label: string };

const MONTH = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function day(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso.slice(0, 10) : `${date.getUTCDate()} ${MONTH[date.getUTCMonth()]}`;
}

/**
 * What Vo may see for one conversation, read with the requesting staff member's own client, so
 * row-level security decides (PRD AI-05: retrieval restricted by tenant, matter, person and
 * audience before anything reaches the model). Nothing from another conversation, matter or firm
 * can appear: every query is narrowed to this thread, its matter and its people. Returns null
 * when the person can't read the thread.
 */
export async function loadVoContext(
  supabase: Client,
  input: { organizationId: string; threadId: string; kind: VoKind; firmName: string; staffName: string },
): Promise<{ context: VoContext; sources: VoSource[]; title: string } | null> {
  const org = input.organizationId;
  const thread = await supabase.from("message_threads").select("id, matter_id").eq("organization_id", org).eq("id", input.threadId).maybeSingle();
  if (!thread.data) return null;
  const matterId = thread.data.matter_id;
  const [matter, people, messages] = await Promise.all([
    supabase.from("matters").select("id, title, reference").eq("organization_id", org).eq("id", matterId).maybeSingle(),
    supabase.from("message_thread_people").select("person_id").eq("organization_id", org).eq("thread_id", input.threadId),
    supabase
      .from("matter_messages")
      .select("id, body, created_at, author_kind, author_name")
      .eq("organization_id", org)
      .eq("thread_id", input.threadId)
      .order("created_at", { ascending: false })
      .limit(MAX_CONTEXT_MESSAGES),
  ]);
  if (!matter.data) return null;
  const personIds = (people.data ?? []).map((row) => row.person_id);
  const [persons, requests] = await Promise.all([
    personIds.length ? supabase.from("persons").select("id, display_name").eq("organization_id", org).in("id", personIds) : null,
    input.kind === "document_request" && personIds.length
      ? supabase
          .from("document_requests")
          .select("id, purpose, explanation, due_on, acceptable_formats")
          .eq("organization_id", org)
          .eq("matter_id", matterId)
          .eq("status", "open")
          .in("person_id", personIds)
          .order("due_on", { ascending: true, nullsFirst: false })
          .limit(10)
      : null,
  ]);
  const audience = (persons?.data ?? []).map((row) => row.display_name).sort((a, b) => a.localeCompare(b));
  const ordered = [...(messages.data ?? [])].reverse();
  const openRequests = requests?.data ?? [];

  const context: VoContext = {
    kind: input.kind,
    firmName: input.firmName,
    staffName: input.staffName,
    matterTitle: matter.data.title,
    matterRef: matter.data.reference ?? null,
    audience,
    messages: ordered.map((row) => ({
      id: row.id,
      author: row.author_kind === "client" ? "client" : "staff",
      name: row.author_name,
      date: day(row.created_at),
      body: row.body,
    })),
    requests: openRequests.map((row) => ({
      id: row.id,
      purpose: row.purpose,
      explanation: row.explanation,
      dueOn: row.due_on,
      formats: row.acceptable_formats ?? [],
    })),
  };
  // Citations: the records the draft was given, in the order a reviewer reads them.
  const sources: VoSource[] = [
    ...ordered.map((row) => ({ kind: "message" as const, id: row.id, label: `${row.author_kind === "client" ? "Client message" : "Firm message"} ${day(row.created_at)}` })),
    ...openRequests.map((row) => ({ kind: "document_request" as const, id: row.id, label: `Request: ${row.purpose}`.slice(0, 120) })),
    { kind: "matter", id: matter.data.id, label: (matter.data.reference || matter.data.title).slice(0, 120) },
  ];
  const names = audience.join(", ") || "the client";
  const title = (input.kind === "document_request" ? `Explain document requests to ${names}` : `Reply to ${names}`).slice(0, 200);
  return { context, sources, title };
}

/** Whether there is anything to draft: a client message to answer, or an open request to explain. */
export function hasWork(context: VoContext): boolean {
  if (context.kind === "document_request") return context.requests.length > 0;
  return context.messages.some((message) => message.author === "client");
}
