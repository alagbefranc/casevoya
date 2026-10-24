"use server";

import { safeAccessError } from "@/lib/auth/step-up";
import { createClient } from "@/lib/supabase/server";
import { isUuid } from "@/lib/tenant/context";
import type { Json } from "@/types/database.types";
import { continuityProblem } from "@/modules/settings/firm-input";
import {
  STAFF_ROLE_CHOICES,
  parseOffboardFacts,
  parseOffboardResult,
  staffAdminError,
  type Handover,
  type OffboardFacts,
  type OffboardResult,
} from "@/modules/sheet/settings-staff-admin-present";

/**
 * Settings > Team and seats, staff admin (ORG-02, ORG-06, SEC-01). Each call acts as the signed-in
 * person; the database decides. Changing a role, suspending, offboarding and the continuity
 * contact need the firm owner with a recent step-up (public.change_staff_role, set_staff_suspended,
 * offboard_staff_member, set_firm_continuity); the offboarding preview needs the firm owner at aal2.
 */
export type StaffAdminResult<T = true> = { ok: T } | { error: string; stepUp?: boolean };

function refused(message: string): { error: string; stepUp?: boolean } {
  return staffAdminError(message) ?? { error: safeAccessError(message) };
}

type Client = Awaited<ReturnType<typeof createClient>>;

async function signedIn(organizationId: string): Promise<{ supabase: Client } | { error: string }> {
  if (!isUuid(organizationId)) return { error: "Choose a firm." };
  const supabase = await createClient({ organizationId });
  const { data: claims } = await supabase.auth.getClaims();
  if (!claims?.claims?.sub) return { error: "Sign in first." };
  return { supabase };
}

const ROLES = new Set<string>(STAFF_ROLE_CHOICES.map(([, value]) => value));

export async function changeStaffRole(input: { organizationId: string; membershipId: string; role: string }): Promise<StaffAdminResult> {
  if (!isUuid(input.membershipId)) return { error: "Choose a person." };
  if (!ROLES.has(input.role)) return { error: "Choose a staff role." };
  const session = await signedIn(input.organizationId);
  if ("error" in session) return session;
  const { error } = await session.supabase.rpc("change_staff_role", {
    p_organization_id: input.organizationId,
    p_membership_id: input.membershipId,
    p_role: input.role as (typeof STAFF_ROLE_CHOICES)[number][1],
  });
  return error ? refused(error.message) : { ok: true };
}

/** Suspend (ends their sessions; returns how many) or reactivate. */
export async function setStaffSuspended(input: { organizationId: string; membershipId: string; suspended: boolean }): Promise<StaffAdminResult<number>> {
  if (!isUuid(input.membershipId)) return { error: "Choose a person." };
  const session = await signedIn(input.organizationId);
  if ("error" in session) return session;
  const { data, error } = await session.supabase.rpc("set_staff_suspended", {
    p_organization_id: input.organizationId,
    p_membership_id: input.membershipId,
    p_suspended: input.suspended === true,
  });
  return error ? refused(error.message) : { ok: typeof data === "number" ? data : 0 };
}

export async function previewOffboarding(input: { organizationId: string; membershipId: string }): Promise<StaffAdminResult<OffboardFacts>> {
  if (!isUuid(input.membershipId)) return { error: "Choose a person." };
  const session = await signedIn(input.organizationId);
  if ("error" in session) return session;
  const { data, error } = await session.supabase.rpc("staff_offboarding_preview", {
    p_organization_id: input.organizationId,
    p_membership_id: input.membershipId,
  });
  if (error) return refused(error.message);
  const facts = parseOffboardFacts(data);
  return facts ? { ok: facts } : { error: "Their work couldn’t be read. Try again." };
}

/** Only {id: membership id} pairs of uuids, per section; anything else is dropped (the database checks each choice). */
function cleanHandover(handover: Handover | undefined): Handover {
  const out: Handover = { leads: {}, booking_types: {}, bookings: {} };
  for (const section of ["leads", "booking_types", "bookings"] as const) {
    const entries = handover && typeof handover[section] === "object" ? Object.entries(handover[section]) : [];
    for (const [id, to] of entries.slice(0, 500)) if (isUuid(id) && typeof to === "string" && isUuid(to)) out[section][id] = to;
  }
  return out;
}

export async function offboardStaff(input: { organizationId: string; membershipId: string; receiverId: string; handover?: Handover }): Promise<StaffAdminResult<OffboardResult>> {
  if (!isUuid(input.membershipId)) return { error: "Choose a person." };
  if (!isUuid(input.receiverId)) return { error: "Choose who receives their work." };
  const session = await signedIn(input.organizationId);
  if ("error" in session) return session;
  const { data, error } = await session.supabase.rpc("offboard_staff_member", {
    p_organization_id: input.organizationId,
    p_membership_id: input.membershipId,
    p_receiver_membership_id: input.receiverId,
    p_handover: cleanHandover(input.handover) as unknown as Json,
  });
  return error ? refused(error.message) : { ok: parseOffboardResult(data) };
}

export async function saveContinuity(input: { organizationId: string; name: string; email: string; succession: string }): Promise<StaffAdminResult> {
  const name = (input.name ?? "").trim();
  const email = (input.email ?? "").trim();
  const succession = (input.succession ?? "").trim();
  if (name.length > 200 || email.length > 320 || succession.length > 2000) return { error: "That’s too long. Shorten it and try again." };
  const continuity = continuityProblem(name, email);
  if (continuity) return { error: continuity };
  const session = await signedIn(input.organizationId);
  if ("error" in session) return session;
  const { error } = await session.supabase.rpc("set_firm_continuity", {
    p_organization_id: input.organizationId,
    p_name: name,
    p_email: email,
    p_succession_note: succession,
  });
  return error ? refused(error.message) : { ok: true };
}
