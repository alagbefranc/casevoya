"use server";

import { refresh } from "next/cache";
import { safeAccessError } from "@/lib/auth/step-up";
import { createClient } from "@/lib/supabase/server";
import { isUuid } from "@/lib/tenant/context";
import { isCanadaCaUrl, provenanceError } from "@/modules/government/status-provenance";

/**
 * GOV-05 server actions: Mark checked, and IRCC processing-time estimates (enter, review). Each
 * calls a public.* wrapper as the signed-in member; the database checks role, matter scope,
 * licence and step-up. Sharing a status reuses `shareWithClient` (src/modules/government/actions.ts).
 */
type Ref = { organizationId: string };
const DATE = /^\d{4}-\d{2}-\d{2}$/;
/** The page fetch is best effort: a page that can't be read leaves the capture empty, never invented. */
const FETCH_MS = 10_000;
const MAX_BYTES = 5_000_000;

async function session(organizationId: string) {
  if (!isUuid(organizationId)) return { error: "Choose a firm." as const };
  const supabase = await createClient({ organizationId });
  const { data: claims } = await supabase.auth.getClaims();
  if (!claims?.claims?.sub) return { error: "Sign in first." as const };
  return { supabase };
}

function refusal(message: string): string {
  if (/step-up|aal2|recovery code/i.test(message)) return safeAccessError(message);
  return provenanceError(message);
}

/** Mark checked: a staff member looked at the official channel for this status (or the whole matter). */
export async function markChecked(input: Ref & { matterId: string; correspondenceId?: string | null }) {
  if (!isUuid(input.matterId)) return { error: "Choose a matter." };
  const correspondenceId = input.correspondenceId && isUuid(input.correspondenceId) ? input.correspondenceId : null;
  const s = await session(input.organizationId);
  if ("error" in s) return { error: s.error };
  const { data, error } = await s.supabase.rpc("mark_government_checked", { p_matter_id: input.matterId, p_correspondence_id: correspondenceId });
  if (error) return { error: refusal(error.message) };
  refresh();
  return { id: data };
}

/** SHA-256 of the official page as the server fetched it now, or null when it can't be reached. */
async function capturePage(url: string): Promise<{ at: string; sha256: string } | null> {
  try {
    const response = await fetch(url, { redirect: "follow", signal: AbortSignal.timeout(FETCH_MS), headers: { Accept: "text/html" } });
    if (!response.ok || !isCanadaCaUrl(response.url || url)) return null;
    const body = await response.arrayBuffer();
    if (body.byteLength === 0 || body.byteLength > MAX_BYTES) return null;
    const digest = await crypto.subtle.digest("SHA-256", body);
    const sha256 = [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
    return { at: new Date().toISOString(), sha256 };
  } catch {
    return null;
  }
}

/** A staff member enters what IRCC's processing-times page shows; it waits for licensed review. */
export async function enterEstimate(input: Ref & { matterId: string; sourceUrl: string; applicationType: string; estimate: string; checkedOn: string }) {
  if (!isUuid(input.matterId)) return { error: "Choose a matter." };
  const sourceUrl = (input.sourceUrl ?? "").trim();
  if (!isCanadaCaUrl(sourceUrl)) return { error: "Use IRCC’s processing-times page on canada.ca." };
  const applicationType = (input.applicationType ?? "").trim();
  const estimate = (input.estimate ?? "").trim();
  if (applicationType.length < 2) return { error: "Name the application type as IRCC’s page does." };
  if (!estimate) return { error: "Write the estimate exactly as IRCC’s page shows it." };
  if (!DATE.test(input.checkedOn ?? "")) return { error: "Add the date you checked IRCC’s page." };
  const s = await session(input.organizationId);
  if ("error" in s) return { error: s.error };
  const capture = await capturePage(sourceUrl);
  const { data, error } = await s.supabase.rpc("record_processing_estimate", {
    p_matter_id: input.matterId,
    p_source_url: sourceUrl,
    p_application_type: applicationType,
    p_estimate: estimate,
    p_checked_on: input.checkedOn,
    p_retrieved_at: capture?.at ?? null,
    p_sha256: capture?.sha256 ?? null,
  });
  if (error) return { error: refusal(error.message) };
  refresh();
  return { id: data, captured: Boolean(capture) };
}

/** A licensed member approves or rejects an estimate (recent step-up). */
export async function reviewEstimate(input: Ref & { estimateId: string; version: number; decision: string; note?: string | null }) {
  if (!isUuid(input.estimateId) || !Number.isInteger(input.version)) return { error: "Choose an estimate." };
  if (input.decision !== "approved" && input.decision !== "rejected") return { error: "Approve or reject it." };
  const note = (input.note ?? "").trim();
  if (input.decision === "rejected" && note.length < 3) return { error: "Say why it’s rejected." };
  const s = await session(input.organizationId);
  if ("error" in s) return { error: s.error };
  const { data, error } = await s.supabase.rpc("review_processing_estimate", {
    p_estimate_id: input.estimateId,
    p_expected_version: input.version,
    p_decision: input.decision,
    p_note: note || null,
  });
  if (error) return { error: refusal(error.message) };
  refresh();
  return { version: data };
}
