/**
 * What Vo's tools may read, as the requesting staff member: a Supabase client built from THEIR
 * short-lived access token and the publishable key, so Postgres RLS decides every row (PRD AI-05:
 * retrieval restricted by tenant, matter, person and audience before content reaches the model).
 * The service never holds a service-role key. Every query is narrowed to the run's matter and,
 * for drafts, its conversation.
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../../../src/types/database.types";
import { parseAvailability, slotsFromAvailability } from "../../../src/modules/scheduling/availability";
import { isCitableOfficialUrl } from "../../../src/modules/vo/grounding";

export type VoSettingsRow = {
  enabled: boolean;
  reply_drafts: boolean;
  staff_answers: boolean;
  read_client_messages: boolean;
  read_identity: boolean;
  read_relationship: boolean;
  read_financial: boolean;
  read_medical: boolean;
  read_criminal: boolean;
  read_narratives: boolean;
};

export type VoMessage = { id: string; body: string; createdAt: string; authorKind: "client" | "staff"; authorName: string };
export type VoMatter = { id: string; title: string; reference: string | null; stage: string; isSample: boolean };
export type VoRequestRow = { id: string; purpose: string; explanation: string; dueOn: string | null; formats: string[] };
export type VoTaskRow = { id: string; title: string; dueOn: string | null; status: string };
export type VoDeadlineRow = { id: string; label: string; dueOn: string | null; verification: string };
export type VoDocumentRow = { id: string; purpose: string; sensitivity: string; category: string | null; status: string | null; versionId?: string | null };
export type VoSourceRow = { title: string; publisher: string; url: string; lastChecked: string | null };

/** The narrow read surface the tools use. Tests pass a fake; production uses supabaseVoData. */
export interface VoData {
  settings(): Promise<VoSettingsRow | null>;
  firm(): Promise<{ name: string; slug: string | null; sampleMode: boolean } | null>;
  matter(matterId: string): Promise<VoMatter | null>;
  people(matterId: string): Promise<{ name: string; role: string }[]>;
  threadPeople(threadId: string): Promise<string[]>;
  messages(threadId: string, limit: number): Promise<VoMessage[]>;
  requests(matterId: string): Promise<VoRequestRow[]>;
  tasks(matterId: string): Promise<VoTaskRow[]>;
  deadlines(matterId: string): Promise<VoDeadlineRow[]>;
  documents(matterId: string): Promise<VoDocumentRow[]>;
  approvedSources(): Promise<VoSourceRow[]>;
  freeSlots(days: number): Promise<{ starts: string[]; bookingLink: string | null; timeZone: string }>;
  /** AI-01 letter drafts (letter-tools.ts): the run's approved facts and approved official content. */
  letterFacts?(runId: string): Promise<VoLetterFacts>;
  officialContent?(runId: string): Promise<VoOfficialItem[]>;
  /** SRC-09 Ask Vo: the run's approved facts and approved official content (public.vo_run_facts, vo_run_official_content). */
  runFacts?(runId: string): Promise<VoLetterFacts>;
  runOfficialContent?(runId: string): Promise<VoOfficialSource[]>;
  rpc(name: "finish_vo_run" | "save_vo_letter_draft", args: Record<string, unknown>): Promise<{ data: unknown; error: { message: string } | null }>;
}

/** An approved fact of the matter (public.vo_letter_facts): reviewed, latest, in an allowed category. */
export type VoLetterFact = { answerId: string; person: string; form: string; fieldType: string; label: string; value: string };
export type VoLetterFacts = { facts: VoLetterFact[]; hidden: number };
/** Approved official content (public.vo_letter_official_content): text and source, no page body. */
export type VoOfficialItem = {
  kind: string;
  id: string;
  label: string;
  content: string;
  sourceUrl: string;
  checkedOn: string | null;
  /** The page wasn't captured by Casevoya; a licensed reviewer attested it (who, the date they opened it). */
  attested: boolean;
  attestedBy: string | null;
  attestedOn: string | null;
  /** #188: the firm's licensed edit of a live official claim (Vo cites the firm's wording with this stamp). */
  edit?: { by: string | null; licence: string | null; on: string | null } | null;
};
/** Approved official content with its source as Ask Vo shows it (SRC-01/02 dates, as stored; null when the page didn't say). */
export type VoOfficialSource = VoOfficialItem & {
  section: string | null;
  formNumber: string | null;
  formModifiedOn: string | null;
  currentTo: string | null;
  sha256: string | null;
  /** #188 stale block: Vo can't cite it (its source is overdue for a re-check); the reason, to say why. */
  stale?: boolean;
  staleReason?: string;
};

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

/** The database's answers, field by field; anything malformed is dropped. */
export function parseLetterFacts(raw: unknown): VoLetterFacts {
  const value = (raw ?? {}) as { facts?: unknown; hidden?: unknown };
  const facts = Array.isArray(value.facts) ? value.facts : [];
  return {
    facts: facts
      .map((row) => (row ?? {}) as Record<string, unknown>)
      .filter((row) => text(row.answer_id) && text(row.value))
      .map((row) => ({ answerId: text(row.answer_id), person: text(row.person), form: text(row.form), fieldType: text(row.field_type), label: text(row.label), value: text(row.value) })),
    hidden: typeof value.hidden === "number" ? value.hidden : 0,
  };
}

/**
 * The attestation of a page Casevoya didn't capture, and (#188) the firm's edit stamp of a live
 * official claim, as the database states them.
 */
function attestation(row: Record<string, unknown>): Pick<VoOfficialItem, "attested" | "attestedBy" | "attestedOn" | "edit"> {
  const edit = row.edited === true ? { edit: { by: text(row.edited_by) || null, licence: text(row.edited_licence) || null, on: text(row.edited_on) || null } } : {};
  return row.attested === true
    ? { attested: true, attestedBy: text(row.attested_by) || null, attestedOn: text(row.attested_on) || null, ...edit }
    : { attested: false, attestedBy: null, attestedOn: null, ...edit };
}

export function parseOfficialContent(raw: unknown): VoOfficialItem[] {
  return (Array.isArray(raw) ? raw : [])
    .map((row) => (row ?? {}) as Record<string, unknown>)
    .filter((row) => text(row.id) && text(row.kind) && text(row.content))
    .map((row) => ({
      kind: text(row.kind),
      id: text(row.id),
      label: text(row.label),
      content: text(row.content),
      sourceUrl: text(row.source_url),
      checkedOn: text(row.checked_on) || null,
      ...attestation(row),
    }));
}

export function parseOfficialSources(raw: unknown): VoOfficialSource[] {
  return (Array.isArray(raw) ? raw : [])
    .map((row) => (row ?? {}) as Record<string, unknown>)
    .filter((row) => text(row.id) && text(row.kind) && text(row.content))
    .map((row) => ({
      kind: text(row.kind),
      id: text(row.id),
      label: text(row.label),
      content: text(row.content),
      sourceUrl: text(row.source_url),
      checkedOn: text(row.checked_on) || null,
      section: text(row.source_section) || null,
      formNumber: text(row.form_number) || null,
      formModifiedOn: text(row.form_modified_on) || null,
      currentTo: text(row.current_to) || null,
      sha256: text(row.snapshot_sha256) || null,
      ...attestation(row),
      // #188 stale block: an official claim Vo can't cite, because its source is overdue for a re-check.
      ...(row.stale === true ? { stale: true, staleReason: text(row.stale_reason) || "Its source is due for a re-check" } : {}),
    }));
}

export function supabaseVoData(input: { url: string; publishableKey: string; accessToken: string; organizationId: string }): VoData {
  const db: SupabaseClient<Database> = createClient<Database>(input.url, input.publishableKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { headers: { Authorization: `Bearer ${input.accessToken}`, "x-casevoya-org": input.organizationId } },
  });
  const org = input.organizationId;
  return {
    async settings() {
      const { data } = await db.from("vo_settings").select("*").eq("organization_id", org).maybeSingle();
      return (data as VoSettingsRow | null) ?? null;
    },
    async firm() {
      const { data } = await db.from("organizations").select("display_name, slug, sample_mode").eq("id", org).maybeSingle();
      return data ? { name: data.display_name, slug: data.slug ?? null, sampleMode: data.sample_mode } : null;
    },
    async matter(matterId) {
      const { data } = await db.from("matters").select("id, title, reference, stage, is_sample").eq("organization_id", org).eq("id", matterId).maybeSingle();
      return data ? { id: data.id, title: data.title, reference: data.reference, stage: String(data.stage), isSample: data.is_sample } : null;
    },
    async people(matterId) {
      const { data: parties } = await db.from("matter_participants").select("person_id, role").eq("organization_id", org).eq("matter_id", matterId).not("person_id", "is", null);
      const ids = [...new Set((parties ?? []).map((row) => row.person_id).filter((id): id is string => Boolean(id)))];
      if (!ids.length) return [];
      const { data: persons } = await db.from("persons").select("id, display_name").eq("organization_id", org).in("id", ids);
      const name = new Map((persons ?? []).map((row) => [row.id, row.display_name]));
      return (parties ?? []).filter((row) => row.person_id && name.has(row.person_id)).map((row) => ({ name: name.get(row.person_id!)!, role: String(row.role) }));
    },
    async threadPeople(threadId) {
      const { data } = await db.from("message_thread_people").select("person_id").eq("organization_id", org).eq("thread_id", threadId);
      const ids = (data ?? []).map((row) => row.person_id);
      if (!ids.length) return [];
      const { data: persons } = await db.from("persons").select("display_name").eq("organization_id", org).in("id", ids);
      return (persons ?? []).map((row) => row.display_name).sort();
    },
    async messages(threadId, limit) {
      const { data } = await db
        .from("matter_messages")
        .select("id, body, created_at, author_kind, author_name")
        .eq("organization_id", org)
        .eq("thread_id", threadId)
        .order("created_at", { ascending: false })
        .limit(limit);
      return (data ?? [])
        .reverse()
        .map((row) => ({ id: row.id, body: row.body, createdAt: row.created_at, authorKind: row.author_kind === "client" ? "client" : "staff", authorName: row.author_name }));
    },
    async requests(matterId) {
      const { data } = await db
        .from("document_requests")
        .select("id, purpose, explanation, due_on, acceptable_formats")
        .eq("organization_id", org)
        .eq("matter_id", matterId)
        .eq("status", "open")
        .limit(10);
      return (data ?? []).map((row) => ({ id: row.id, purpose: row.purpose, explanation: row.explanation, dueOn: row.due_on, formats: row.acceptable_formats ?? [] }));
    },
    async tasks(matterId) {
      const { data } = await db.from("tasks").select("id, title, due_on, status").eq("organization_id", org).eq("matter_id", matterId).in("status", ["open", "blocked"]).limit(15);
      return (data ?? []).map((row) => ({ id: row.id, title: row.title, dueOn: row.due_on, status: String(row.status) }));
    },
    async deadlines(matterId) {
      const { data } = await db.from("deadlines").select("id, label, due_on, verification").eq("organization_id", org).eq("matter_id", matterId).limit(15);
      return (data ?? []).map((row) => ({ id: row.id, label: row.label, dueOn: row.due_on, verification: String(row.verification) }));
    },
    async documents(matterId) {
      const { data: refs } = await db.from("document_matter_refs").select("document_id").eq("organization_id", org).eq("matter_id", matterId).is("removed_at", null).limit(100);
      const ids = (refs ?? []).map((row) => row.document_id);
      if (!ids.length) return [];
      const { data } = await db.from("documents").select("id, purpose, sensitivity, current_version_id").eq("organization_id", org).in("id", ids);
      return (data ?? []).map((row) => ({ id: row.id, purpose: row.purpose, sensitivity: String(row.sensitivity), category: null, status: null, versionId: row.current_version_id }));
    },
    async approvedSources() {
      const { data } = await db
        .from("official_sources")
        .select("title, publisher, canonical_url, last_checked_at, next_review_at, review_status, change_state")
        .eq("review_status", "verified")
        .limit(40);
      const now = Date.now();
      return (data ?? [])
        .filter((row) => String(row.change_state) !== "change_detected" && (!row.next_review_at || Date.parse(row.next_review_at) > now))
        // SRC-09: only deep pages on federal official hosts (never a homepage or another site).
        .filter((row) => isCitableOfficialUrl(row.canonical_url))
        .map((row) => ({ title: row.title ?? row.canonical_url, publisher: row.publisher, url: row.canonical_url, lastChecked: row.last_checked_at }));
    },
    async freeSlots(days) {
      const { data: types } = await db
        .from("booking_event_types")
        .select("id, slug, is_published")
        .eq("organization_id", org)
        .is("archived_at", null)
        .order("created_at", { ascending: true })
        .limit(1);
      const type = types?.[0];
      if (!type) return { starts: [], bookingLink: null, timeZone: "America/Toronto" };
      const now = Date.now();
      const to = now + Math.min(Math.max(days, 1), 14) * 86_400_000;
      const { data } = await db.rpc("staff_booking_availability", { p_org: org, p_event_type_id: type.id, p_from: new Date(now).toISOString(), p_to: new Date(to).toISOString() });
      const payload = parseAvailability(data);
      const starts = payload ? slotsFromAvailability(payload, { fromUtc: now, toUtc: to, nowUtc: now }).slice(0, 6) : [];
      const firm = await this.firm();
      const zone = payload?.hosts[0]?.timeZone ?? "America/Toronto";
      return {
        starts: starts.map((start) => new Date(start).toISOString()),
        bookingLink: type.is_published && firm?.slug ? `https://app.casevoya.ca/book/${firm.slug}/${type.slug}` : null,
        timeZone: zone,
      };
    },
    async letterFacts(runId) {
      const { data, error } = await db.rpc("vo_letter_facts", { p_run_id: runId });
      if (error) throw new Error("facts");
      return parseLetterFacts(data);
    },
    async officialContent(runId) {
      const { data, error } = await db.rpc("vo_letter_official_content", { p_run_id: runId });
      if (error) throw new Error("official");
      return parseOfficialContent(data);
    },
    async runFacts(runId) {
      const { data, error } = await db.rpc("vo_run_facts", { p_run_id: runId });
      if (error) throw new Error("facts");
      return parseLetterFacts(data);
    },
    async runOfficialContent(runId) {
      const { data, error } = await db.rpc("vo_run_official_content", { p_run_id: runId });
      if (error) throw new Error("official");
      return parseOfficialSources(data);
    },
    async rpc(name, args) {
      const { data, error } = await db.rpc(name, args as never);
      return { data, error: error ? { message: error.message } : null };
    },
  };
}
