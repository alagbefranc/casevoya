"use server";

import { safeAccessError } from "@/lib/auth/step-up";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { isUuid } from "@/lib/tenant/context";
import { completeDocumentUpload } from "@/modules/documents/actions";

/**
 * Email to triage (OPS-06). Staff file an inbound email to a person on a matter, and its clean
 * files become that person's documents; or they dismiss it as not case mail. The database
 * decides every step (role, matter scope, step-up). Nothing here changes the sender's access.
 */

function inboxError(message: string): string {
  if (/already triaged/i.test(message)) return "Someone already filed or dismissed this email. Refresh the page.";
  if (/still arriving/i.test(message)) return "This email is still arriving. Try again in a minute.";
  if (/not on this matter/i.test(message)) return "That person isn’t on this matter.";
  if (/filed matter/i.test(message)) return "This file goes to the person the email was filed to.";
  if (/left out/i.test(message)) return "This file was left out of the matter’s documents when the email was filed.";
  if (/who may see/i.test(message)) return "Choose who may see each file.";
  if (/what happens to each file|not on this email/i.test(message)) return "Choose what happens to each file again. Refresh the page.";
  return safeAccessError(message);
}

async function session(organizationId: string) {
  if (!isUuid(organizationId)) return { error: "Choose a firm." as const };
  const supabase = await createClient({ organizationId });
  const { data: claims } = await supabase.auth.getClaims();
  if (!claims?.claims?.sub) return { error: "Sign in first." as const };
  return { supabase };
}

function itemIds(value: unknown): string[] {
  if (!value || typeof value !== "object" || Array.isArray(value)) return [];
  const items = (value as { items?: unknown }).items;
  return Array.isArray(items) ? items.filter((id): id is string => typeof id === "string" && isUuid(id)) : [];
}

/**
 * One inbox file becomes a document version for the email's person: the database authorizes a
 * new upload, the server copies the stored bytes to it, checks them like any upload, and marks
 * the inbox file assigned.
 */
async function assignFile(
  supabase: Awaited<ReturnType<typeof createClient>>,
  organizationId: string,
  itemId: string,
  matterId: string,
  personId: string,
): Promise<{ ok: true } | { error: string }> {
  const assigned = await supabase.rpc("assign_unsorted_email_file", { p_item_id: itemId, p_matter_id: matterId, p_person_id: personId });
  if (assigned.error) return { error: inboxError(assigned.error.message) };
  const intent = assigned.data && typeof assigned.data === "object" && !Array.isArray(assigned.data) ? assigned.data : null;
  const versionId = intent?.version_id;
  const target = intent?.storage_key;
  const source = intent?.source_storage_key;
  if (typeof versionId !== "string" || typeof target !== "string" || typeof source !== "string") return { error: "The file could not be moved." };
  let service: ReturnType<typeof createServiceClient>;
  try {
    service = createServiceClient();
  } catch {
    return { error: "Files cannot be moved right now. Try again later." };
  }
  const copied = await service.storage.from("documents").copy(source, target);
  if (copied.error) return { error: "The file could not be moved. Try again." };
  const checked = await completeDocumentUpload({ organizationId, versionId });
  if ("error" in checked) return { error: checked.error ?? "The file could not be checked." };
  // #263-B: a copy still being checked for viruses is filed; nobody can open it until it is clean.
  if (checked.uploadState !== "clean" && checked.uploadState !== "scanning") return { error: "The file didn’t pass the file check, so it stays out of the documents." };
  const done = await supabase.rpc("complete_unsorted_assignment", { p_item_id: itemId });
  if (done.error) return { error: inboxError(done.error.message) };
  return { ok: true };
}

export async function fileInboundEmail(input: { organizationId: string; emailId: string; matterId: string; personId: string }) {
  if (!isUuid(input.emailId) || !isUuid(input.matterId) || !isUuid(input.personId)) return { error: "Choose the person this email belongs to." };
  const auth = await session(input.organizationId);
  if ("error" in auth) return { error: auth.error };
  const filed = await auth.supabase.rpc("file_inbound_email", { p_email_id: input.emailId, p_matter_id: input.matterId, p_person_id: input.personId });
  if (filed.error) return { error: inboxError(filed.error.message) };
  const items = itemIds(filed.data);
  let moved = 0;
  const problems: string[] = [];
  for (const itemId of items) {
    const result = await assignFile(auth.supabase, input.organizationId, itemId, input.matterId, input.personId);
    if ("error" in result) problems.push(result.error);
    else moved++;
  }
  return { filed: true as const, files: items.length, moved, problem: problems[0] ?? null };
}

export type FilingChoice = { itemId: string; save: boolean; audience: "subject" | "staff" };

/**
 * File to matter (Email to triage): files the email to a person on a matter the caller found, and
 * records for each of its files whether it goes to the matter's Documents and who may see it.
 * Saved files then go through the same copy and file check as any upload (assignFile).
 */
export async function fileInboundEmailToMatter(input: { organizationId: string; emailId: string; matterId: string; personId: string; files: FilingChoice[] }) {
  if (!isUuid(input.emailId) || !isUuid(input.matterId)) return { error: "Choose a matter." };
  if (!isUuid(input.personId)) return { error: "Choose the person this email belongs to." };
  const files = (Array.isArray(input.files) ? input.files : []).slice(0, 20);
  if (files.some((file) => !isUuid(file.itemId) || (file.audience !== "subject" && file.audience !== "staff"))) return { error: "Choose who may see each file." };
  const auth = await session(input.organizationId);
  if ("error" in auth) return { error: auth.error };
  const filed = await auth.supabase.rpc("file_inbound_email_to_matter", {
    p_email_id: input.emailId,
    p_matter_id: input.matterId,
    p_person_id: input.personId,
    p_files: files.map((file) => ({ item_id: file.itemId, save: file.save === true, audience: file.audience })),
  });
  if (filed.error) return { error: inboxError(filed.error.message) };
  const items = itemIds(filed.data);
  let moved = 0;
  const problems: string[] = [];
  for (const itemId of items) {
    const result = await assignFile(auth.supabase, input.organizationId, itemId, input.matterId, input.personId);
    if ("error" in result) problems.push(result.error);
    else moved++;
  }
  return { filed: true as const, files: items.length, moved, problem: problems[0] ?? null, leftOut: files.filter((file) => !file.save).length };
}

export type FilingMatter = { id: string; label: string; people: { id: string; name: string }[] };

/**
 * The matters File to matter offers for a search: read as the signed-in staff member, so only
 * matters they can open come back (RLS), and the database checks the matter again on filing.
 */
export async function searchFilingMatters(input: { organizationId: string; query: string }): Promise<{ matters: FilingMatter[] } | { error: string }> {
  const auth = await session(input.organizationId);
  if ("error" in auth) return { error: auth.error ?? "Sign in first." };
  const term = String(input.query ?? "")
    .replace(/[%_,()\\*]/g, " ")
    .trim()
    .slice(0, 80);
  let read = auth.supabase.from("matters").select("id, reference, title").eq("organization_id", input.organizationId).order("updated_at", { ascending: false }).limit(20);
  if (term) read = read.or(`reference.ilike.%${term}%,title.ilike.%${term}%`);
  const { data, error } = await read;
  if (error) return { error: "Matters couldn’t be searched. Try again." };
  const rows = data ?? [];
  if (!rows.length) return { matters: [] };
  const parties = await auth.supabase
    .from("matter_participants")
    .select("matter_id, person_id")
    .eq("organization_id", input.organizationId)
    .in("matter_id", rows.map((row) => row.id))
    .not("person_id", "is", null);
  const personIds = [...new Set((parties.data ?? []).map((row) => row.person_id).filter((id): id is string => Boolean(id)))];
  const people = personIds.length ? await auth.supabase.from("persons").select("id, display_name").eq("organization_id", input.organizationId).in("id", personIds) : null;
  const name = new Map((people?.data ?? []).map((row) => [row.id, row.display_name]));
  return {
    matters: rows.map((row) => ({
      id: row.id,
      label: row.reference ? `${row.reference} · ${row.title}` : row.title,
      people: (parties.data ?? [])
        .filter((party) => party.matter_id === row.id && party.person_id && name.has(party.person_id))
        .map((party) => ({ id: party.person_id!, name: name.get(party.person_id!)! })),
    })),
  };
}

/** Retries the files of an email that was filed but whose files did not all move. */
export async function moveInboundFiles(input: { organizationId: string; emailId: string }) {
  if (!isUuid(input.emailId)) return { error: "Choose an email." };
  const auth = await session(input.organizationId);
  if ("error" in auth) return { error: auth.error };
  const { data: email } = await auth.supabase
    .from("inbound_emails")
    .select("matter_id, person_id, triage_state")
    .eq("id", input.emailId)
    .maybeSingle();
  if (!email || email.triage_state !== "filed" || !email.matter_id || !email.person_id) return { error: "File this email first." };
  const { data: items } = await auth.supabase
    .from("inbound_inbox_items")
    .select("id")
    .eq("inbound_email_id", input.emailId)
    .eq("upload_state", "clean")
    .is("skipped_at", null);
  let moved = 0;
  const problems: string[] = [];
  for (const item of items ?? []) {
    const result = await assignFile(auth.supabase, input.organizationId, item.id, email.matter_id, email.person_id);
    if ("error" in result) problems.push(result.error);
    else moved++;
  }
  return { files: (items ?? []).length, moved, problem: problems[0] ?? null };
}

export async function dismissInboundEmail(input: { organizationId: string; emailId: string }) {
  if (!isUuid(input.emailId)) return { error: "Choose an email." };
  const auth = await session(input.organizationId);
  if ("error" in auth) return { error: auth.error };
  const { error } = await auth.supabase.rpc("dismiss_inbound_email", { p_email_id: input.emailId, p_note: "Not case mail" });
  if (error) return { error: inboxError(error.message) };
  return { ok: true as const };
}
