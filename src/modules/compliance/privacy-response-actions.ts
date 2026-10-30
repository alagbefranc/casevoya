"use server";

import { createClient } from "@/lib/supabase/server";
import { isUuid } from "@/lib/tenant/context";
import { mayStoreServerCapture, NOT_FETCHED, storeServerCapture } from "@/modules/content-governance/server-capture";
import { federalOfficialUrl, snapshotOfficialPage } from "@/modules/submissions/official-page";
import { readDate } from "./format";
import { privacyResponseError } from "./privacy-response-format";

/**
 * SEC-06: legal time limits, the due-date extension, the scope search, redaction decisions and
 * delivery. Each call goes to a database function that checks the caller (role, assignment,
 * licence, step-up); these only shape the input and word the refusals plainly.
 */

type Result<T extends object = object> = ({ ok: true } & T) | { error: string };

async function session(organizationId: string) {
  if (!isUuid(organizationId)) return { error: "Choose a firm." as const };
  const supabase = await createClient({ organizationId });
  const { data: claims } = await supabase.auth.getClaims();
  if (!claims?.claims?.sub) return { error: "Sign in first." as const };
  return { supabase, userId: claims.claims.sub as string };
}

const text = (value: string | null | undefined) => (value && value.trim() ? value.trim() : null);

export async function proposePrivacyTimeLimit(input: {
  organizationId: string;
  kind: string;
  lawName: string;
  section: string;
  provisionText: string;
  days: string;
  sourceUrl: string;
  currentTo: string;
  checkedOn: string;
}): Promise<Result<{ captured: boolean; reason: string | null }>> {
  if (input.kind !== "response" && input.kind !== "extension") return { error: "Choose whether it’s the time to respond or the extension." };
  const url = input.sourceUrl.trim();
  if (!federalOfficialUrl(url)) return { error: "Use the official page’s link (canada.ca or a gc.ca site such as Justice Laws)." };
  if (!text(input.section)) return { error: "Name the section of the law, for example s. 8(3)." };
  if ((text(input.provisionText)?.length ?? 0) < 3) return { error: "Copy the provision word for word from the official page." };
  const days = text(input.days);
  if (days && !/^\d{1,3}$/.test(days)) return { error: "Enter days only when the provision states a number, between 1 and 365." };
  const checked = readDate(input.checkedOn);
  if (!checked) return { error: "Enter the date you checked the page as DD/MM/YYYY." };
  const currentTo = text(input.currentTo) ? readDate(input.currentTo) : null;
  if (text(input.currentTo) && !currentTo) return { error: "Enter the current-to date as DD/MM/YYYY, or leave it empty." };
  const auth = await session(input.organizationId);
  if (!auth.supabase) return { error: auth.error ?? "Sign in first." };
  // The firm membership is checked before any outbound fetch.
  const fetched = (await mayStoreServerCapture(auth.supabase, input.organizationId, auth.userId)) ? await snapshotOfficialPage(url, fetch) : NOT_FETCHED;
  // The fetched page is stored by the server (service role); the entry names that capture.
  const stored = fetched.snapshot
    ? await storeServerCapture({
        organizationId: input.organizationId,
        actorUserId: auth.userId,
        sourceUrl: url,
        title: input.lawName.trim() || null,
        page: fetched.snapshot,
        dates: { currentTo },
      })
    : null;
  const result = await auth.supabase.rpc("propose_privacy_time_limit", {
    p_org: input.organizationId,
    p_kind: input.kind,
    p_law_name: input.lawName.trim(),
    p_provision_text: input.provisionText.trim(),
    p_days: days ? Number(days) : null,
    p_source_url: url,
    p_source_section: input.section.trim(),
    p_checked_on: checked,
    p_current_to: currentTo,
    p_snapshot: stored as unknown as never,
  });
  if (result.error) return { error: privacyResponseError(result.error.message) };
  return { ok: true, captured: Boolean(stored), reason: fetched.snapshot ? (stored ? null : "The page capture couldn’t be stored.") : fetched.reason };
}

export async function reviewPrivacyTimeLimit(input: {
  organizationId: string;
  limitId: string;
  version: number;
  decision: string;
  note: string;
  pageOpenedOn: string;
}): Promise<Result> {
  if (!isUuid(input.limitId) || !Number.isInteger(input.version)) return { error: "Refresh the page and try again." };
  if (!["approved", "rejected", "retired"].includes(input.decision)) return { error: "Choose approve, reject or retire." };
  if (input.decision !== "approved" && (text(input.note)?.length ?? 0) < 3) return { error: "Say why, in 3 to 500 characters." };
  const opened = text(input.pageOpenedOn) ? readDate(input.pageOpenedOn) : null;
  if (text(input.pageOpenedOn) && !opened) return { error: "Enter the date you opened the page as DD/MM/YYYY." };
  const auth = await session(input.organizationId);
  if (!auth.supabase) return { error: auth.error ?? "Sign in first." };
  const result =
    input.decision === "retired"
      ? await auth.supabase.rpc("retire_privacy_time_limit", { p_limit_id: input.limitId, p_expected_version: input.version, p_reason: input.note.trim() })
      : await auth.supabase.rpc("review_privacy_time_limit", {
          p_limit_id: input.limitId,
          p_expected_version: input.version,
          p_decision: input.decision,
          p_note: text(input.note),
          p_page_opened_on: input.decision === "approved" ? opened : null,
        });
  if (result.error) return { error: privacyResponseError(result.error.message) };
  return { ok: true };
}

export async function extendPrivacyRequest(input: {
  organizationId: string;
  requestId: string;
  newDue: string;
  basis: string;
  reason: string;
  recourse: string;
  noticeMethod: string;
}): Promise<Result> {
  if (!isUuid(input.requestId)) return { error: "Refresh the page and try again." };
  const due = readDate(input.newDue);
  if (!due) return { error: "Enter the new due date as DD/MM/YYYY." };
  if ((text(input.reason)?.length ?? 0) < 3) return { error: "Give the reason for the extension (3 to 500 characters). They see it." };
  const auth = await session(input.organizationId);
  if (!auth.supabase) return { error: auth.error ?? "Sign in first." };
  const result = await auth.supabase.rpc("extend_privacy_request", {
    p_request_id: input.requestId,
    p_new_due_on: due,
    p_reason: input.reason.trim(),
    p_time_limit_id: isUuid(input.basis) ? input.basis : null,
    p_recourse: text(input.recourse),
    p_notice_method: text(input.noticeMethod),
  });
  if (result.error) return { error: privacyResponseError(result.error.message) };
  return { ok: true };
}

export async function searchPrivacyRecords(input: { organizationId: string; requestId: string }): Promise<Result<{ total: number; added: number }>> {
  if (!isUuid(input.requestId)) return { error: "Refresh the page and try again." };
  const auth = await session(input.organizationId);
  if (!auth.supabase) return { error: auth.error ?? "Sign in first." };
  const result = await auth.supabase.rpc("privacy_scope_search", { p_request_id: input.requestId });
  if (result.error) return { error: privacyResponseError(result.error.message) };
  const value = (result.data ?? {}) as { total?: unknown; added?: unknown };
  return { ok: true, total: Number(value.total ?? 0), added: Number(value.added ?? 0) };
}

export async function decidePrivacyItem(input: {
  organizationId: string;
  itemId: string;
  decision: string;
  fields: string[];
  thirdParty: string;
  reason: string;
}): Promise<Result> {
  if (!isUuid(input.itemId)) return { error: "Refresh the page and try again." };
  if (!["include", "withhold", "redact"].includes(input.decision)) return { error: "Choose a decision." };
  if (input.decision === "redact" && input.fields.length === 0) return { error: "Choose the fields to withhold." };
  if (input.decision !== "include") {
    if (!text(input.thirdParty)) return { error: "Name whose information it is." };
    if ((text(input.reason)?.length ?? 0) < 3) return { error: "Give the reason (3 to 500 characters). They see it." };
  }
  const auth = await session(input.organizationId);
  if (!auth.supabase) return { error: auth.error ?? "Sign in first." };
  const result = await auth.supabase.rpc("decide_privacy_item", {
    p_item_id: input.itemId,
    p_decision: input.decision,
    p_fields: input.decision === "redact" ? input.fields : null,
    p_third_party: input.decision === "include" ? null : text(input.thirdParty),
    p_reason: input.decision === "include" ? null : text(input.reason),
  });
  if (result.error) return { error: privacyResponseError(result.error.message) };
  return { ok: true };
}

export async function deliverPrivacyResponse(input: { organizationId: string; requestId: string; responseId: string; outcome: string; note: string }): Promise<Result> {
  if (!isUuid(input.requestId) || !isUuid(input.responseId)) return { error: "Refresh the page and try again." };
  if (input.outcome !== "fulfilled" && input.outcome !== "partly_fulfilled") return { error: "Choose an outcome." };
  const note = text(input.note);
  if (note && (note.length < 3 || note.length > 2000)) return { error: "Write the note in 3 to 2,000 characters." };
  const auth = await session(input.organizationId);
  if (!auth.supabase) return { error: auth.error ?? "Sign in first." };
  const result = await auth.supabase.rpc("deliver_privacy_response", {
    p_request_id: input.requestId,
    p_response_id: input.responseId,
    p_outcome: input.outcome,
    p_note: note,
  });
  if (result.error) return { error: privacyResponseError(result.error.message) };
  return { ok: true };
}
