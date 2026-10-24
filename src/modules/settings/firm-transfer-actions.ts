"use server";

import { safeAccessError } from "@/lib/auth/step-up";
import { createClient } from "@/lib/supabase/server";
import { isUuid } from "@/lib/tenant/context";
import { transferError } from "@/modules/sheet/firm-transfers-present";

/**
 * Settings > Team and seats, firm transfers (ORG-06). Each call acts as the signed-in firm owner;
 * the database checks the owner and the step-up and records the audit. Nothing is moved.
 */
export type TransferResult = { ok: true } | { error: string; stepUp?: boolean };

function refused(message: string): { error: string; stepUp?: boolean } {
  return transferError(message) ?? { error: safeAccessError(message) };
}

type Client = Awaited<ReturnType<typeof createClient>>;

async function signedIn(organizationId: string): Promise<{ supabase: Client } | { error: string }> {
  if (!isUuid(organizationId)) return { error: "Choose a firm." };
  const supabase = await createClient({ organizationId });
  const { data: claims } = await supabase.auth.getClaims();
  if (!claims?.claims?.sub) return { error: "Sign in first." };
  return { supabase };
}

export async function recordFirmTransfer(input: {
  organizationId: string;
  firm: string;
  contactName: string;
  contactEmail: string;
  note: string;
  matterIds: string[];
}): Promise<TransferResult> {
  const firm = (input.firm ?? "").trim();
  if (firm.length < 2) return { error: "Name the receiving firm." };
  const matterIds = [...new Set((input.matterIds ?? []).filter(isUuid))].slice(0, 200);
  if (!matterIds.length) return { error: "Choose at least one matter." };
  const session = await signedIn(input.organizationId);
  if ("error" in session) return session;
  const { error } = await session.supabase.rpc("record_firm_transfer", {
    p_organization_id: input.organizationId,
    p_receiving_firm: firm.slice(0, 200),
    p_contact_name: (input.contactName ?? "").trim().slice(0, 200),
    p_contact_email: (input.contactEmail ?? "").trim().slice(0, 320),
    p_note: (input.note ?? "").trim().slice(0, 2000),
    p_matter_ids: matterIds,
  });
  return error ? refused(error.message) : { ok: true };
}

export async function reviewTransferAuthority(input: { organizationId: string; itemId: string; authorised: boolean | null; note: string }): Promise<TransferResult> {
  if (!isUuid(input.itemId)) return { error: "Choose the matter." };
  if (input.authorised === null) return { error: "Say whether the client authorised the transfer." };
  const note = (input.note ?? "").trim();
  if (note.length < 3) return { error: "Add a note on the client’s authority (at least 3 characters)." };
  const session = await signedIn(input.organizationId);
  if ("error" in session) return session;
  const { error } = await session.supabase.rpc("review_firm_transfer_authority", { p_item_id: input.itemId, p_authorised: input.authorised, p_note: note.slice(0, 1000) });
  return error ? refused(error.message) : { ok: true };
}

export async function closeFirmTransfer(input: { organizationId: string; transferId: string; status: string; note: string }): Promise<TransferResult> {
  if (!isUuid(input.transferId)) return { error: "Choose the transfer." };
  if (input.status !== "completed" && input.status !== "cancelled") return { error: "Choose completed or cancelled." };
  const session = await signedIn(input.organizationId);
  if ("error" in session) return session;
  const { error } = await session.supabase.rpc("close_firm_transfer", { p_transfer_id: input.transferId, p_status: input.status, p_note: (input.note ?? "").trim().slice(0, 2000) });
  return error ? refused(error.message) : { ok: true };
}
