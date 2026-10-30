"use server";

import { refresh } from "next/cache";
import { safeAccessError } from "@/lib/auth/step-up";
import { createClient } from "@/lib/supabase/server";
import { isUuid } from "@/lib/tenant/context";
import { mayStoreServerCapture, storeIssuerNameCheck, storeServerCapture } from "@/modules/content-governance/server-capture";
import { readIssuerPage } from "@/modules/government/issuer-page";
import { letterError, officialIssuerUrl, type LetterTask } from "@/modules/government/letters";
import {
  CORRESPONDENCE_CHANNELS,
  CORRESPONDENCE_KINDS,
  governmentError,
  type CorrespondenceChannel,
  type CorrespondenceKind,
} from "@/modules/government/present";

/**
 * GOV-04 server actions: record a letter with its issuer, letter date and tasks
 * (public.record_government_letter, one transaction), and the firm's issuer list
 * (public.propose_government_issuer, public.review_government_issuer). The database decides every
 * check; a step-up refusal comes back as the shared step-up message so the Sheet sends the person
 * to /mfa?step=6.
 */
const DATE = /^\d{4}-\d{2}-\d{2}$/;

async function session(organizationId: string) {
  if (!isUuid(organizationId)) return { error: "Choose a firm." as const };
  const supabase = await createClient({ organizationId });
  const { data: claims } = await supabase.auth.getClaims();
  if (!claims?.claims?.sub) return { error: "Sign in first." as const };
  return { supabase, userId: claims.claims.sub as string };
}

function refusal(message: string): string {
  if (/step-up|aal2|recovery code/i.test(message)) return safeAccessError(message);
  return letterError(message) ?? governmentError(message);
}

const text = (value: string | null | undefined) => {
  const trimmed = (value ?? "").trim();
  return trimmed ? trimmed : null;
};

export async function recordGovernmentLetter(input: {
  organizationId: string;
  matterId: string;
  kind: string;
  channel: string;
  receivedOn: string;
  documentDate: string | null;
  issuerId: string | null;
  issuer: string | null;
  statedDeadline: string | null;
  evidenceVersionId: string | null;
  tasks: LetterTask[];
}) {
  if (!isUuid(input.matterId)) return { error: "Choose a matter." };
  if (!CORRESPONDENCE_KINDS.includes(input.kind as CorrespondenceKind)) return { error: "Choose the letter type." };
  if (!CORRESPONDENCE_CHANNELS.includes(input.channel as CorrespondenceChannel)) return { error: "Choose how it arrived." };
  if (!DATE.test(input.receivedOn)) return { error: "Add the date the firm received it." };
  if (input.documentDate && !DATE.test(input.documentDate)) return { error: "Add the date printed on the letter, or leave it empty." };
  if (input.issuerId && !isUuid(input.issuerId)) return { error: "Choose who sent the letter." };
  if (!input.issuerId && !text(input.issuer)) return { error: "Choose who sent the letter, or type it under Other." };
  if (input.evidenceVersionId && !isUuid(input.evidenceVersionId)) return { error: "Use a file that is stored on this matter." };
  const tasks = Array.isArray(input.tasks) ? input.tasks.slice(0, 11) : [];
  const s = await session(input.organizationId);
  if ("error" in s) return { error: s.error };
  const { data, error } = await s.supabase.rpc("record_government_letter", {
    p_matter_id: input.matterId,
    p_kind: input.kind as CorrespondenceKind,
    p_issuer_id: input.issuerId,
    p_issuer: input.issuerId ? null : text(input.issuer),
    p_channel: input.channel as CorrespondenceChannel,
    p_document_date: input.documentDate || null,
    p_received_on: input.receivedOn,
    p_action_requested: null,
    p_stated_deadline: text(input.statedDeadline),
    p_evidence_version_id: input.evidenceVersionId,
    p_tasks: tasks.map((task) => ({ title: task.title, owner: task.owner, owner_id: task.owner_id, due_on: task.due_on })),
  });
  if (error) return { error: refusal(error.message) };
  refresh();
  return { id: data, tasks: tasks.length };
}

/**
 * Adds an issuer from its official page. The server reads the page itself (Government of Canada
 * hosts on the allowlist only) and stores it as a server capture (service role): its SHA-256,
 * retrieval time and "Date modified" come from that capture, and whether the name is on it is
 * recorded by the server afterwards. When it can't, the issuer is recorded with the URL and date
 * checked, marked "page not read".
 */
export async function proposeGovernmentIssuer(input: { organizationId: string; name: string; sourceUrl: string; checkedOn: string }) {
  const name = (input.name ?? "").trim();
  const url = (input.sourceUrl ?? "").trim();
  if (name.length < 2 || name.length > 200) return { error: "Type the issuer’s name as the official page writes it." };
  if (!officialIssuerUrl(url) || url.length > 500) return { error: "Use the issuer’s official Government of Canada page (canada.ca or a gc.ca site)." };
  if (!DATE.test(input.checkedOn ?? "")) return { error: "Add the date you checked the page." };
  const s = await session(input.organizationId);
  if ("error" in s) return { error: s.error };
  // The firm membership is checked before any outbound fetch.
  const read = (await mayStoreServerCapture(s.supabase, input.organizationId, s.userId)) ? await readIssuerPage(fetch, url, name) : null;
  const stored = read
    ? await storeServerCapture({
        organizationId: input.organizationId,
        actorUserId: s.userId,
        sourceUrl: url,
        title: null,
        page: { sha256: read.sha256, retrieved_at: read.retrievedAt, final_url: read.finalUrl, http_status: read.httpStatus },
        dates: { modifiedOn: read.modifiedOn },
      })
    : null;
  const { data, error } = await s.supabase.rpc("propose_government_issuer", {
    p_org: input.organizationId,
    p_name: name,
    p_source_url: url,
    p_checked_on: input.checkedOn,
    p_snapshot: stored,
  });
  if (error) return { error: refusal(error.message) };
  const nameOnPage =
    stored && read && typeof data === "string"
      ? await storeIssuerNameCheck({ organizationId: input.organizationId, actorUserId: s.userId, issuerId: data, nameOnPage: read.nameOnPage })
      : null;
  refresh();
  return { id: data, read: Boolean(stored), nameOnPage };
}

/** pageOpenedOn: the reviewer's attestation when the issuer's page wasn't read (decided 2026-10-24). */
export async function reviewGovernmentIssuer(input: {
  organizationId: string;
  issuerId: string;
  version: number;
  decision: string;
  note: string | null;
  pageOpenedOn?: string | null;
}) {
  if (!isUuid(input.issuerId) || !Number.isInteger(input.version)) return { error: "Choose the issuer." };
  if (!["approved", "rejected", "retired"].includes(input.decision)) return { error: "Choose approve, reject or retire." };
  const s = await session(input.organizationId);
  if ("error" in s) return { error: s.error };
  const { data, error } = await s.supabase.rpc("review_government_issuer", {
    p_issuer_id: input.issuerId,
    p_expected_version: input.version,
    p_decision: input.decision,
    p_note: text(input.note),
    p_page_opened_on: input.decision === "approved" && DATE.test(input.pageOpenedOn ?? "") ? (input.pageOpenedOn as string) : null,
  });
  if (error) return { error: refusal(error.message) };
  refresh();
  return { version: data };
}
