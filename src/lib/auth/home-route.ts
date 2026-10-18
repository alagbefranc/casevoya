import "server-only";

import { createClient } from "@/lib/supabase/server";
import { STAFF_ROLES } from "@/modules/sheet/present";

export type HomeRoute = "/sign-in" | "/sheet" | "/portal" | "/start-trial";

/**
 * Where a signed-in person belongs: firm staff to the Sheet, clients and family to the portal,
 * and an account with no firm yet back to the trial's firm step, so it is never a dead end.
 */
export async function homeRoute(): Promise<HomeRoute> {
  const supabase = await createClient();
  const { data: claims } = await supabase.auth.getClaims();
  const userId = claims?.claims?.sub;
  if (!userId) return "/sign-in";
  const { data: memberships } = await supabase.from("memberships").select("role").eq("user_id", userId).eq("status", "active");
  const roles = (memberships ?? []).map((row) => row.role as string);
  if (roles.some((role) => (STAFF_ROLES as readonly string[]).includes(role))) return "/sheet";
  if (roles.length > 0) return "/portal";
  return "/start-trial";
}
