import "server-only";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { isUuid } from "@/lib/tenant/context";
import type { PublicDeps } from "./public-api";

type SessionClient = Awaited<ReturnType<typeof createClient>>;

/**
 * Supabase wiring for the public booking API. Reads run as the visitor (anonymous, or signed in):
 * the database functions return published types and busy ranges only. The client carries the
 * visitor's session cookie, so a sample-mode firm's practice page (and its slots) comes back only
 * for the firm's own signed-in staff with MFA: the database checks it with auth.uid(). Everyone
 * else gets the same "not found" as an unpublished page.
 *
 * The hold is service role only: the database takes the client-address hash only from this
 * server. postPublicHold reads the page with the visitor's session first, so a practice page is
 * held only after that check passed; the hold then names the visitor (p_viewer) and their session
 * assurance (p_viewer_aal) so the database can re-check staff membership with staff MFA and link
 * a signed-in portal client to their own person.
 */
export async function publicDeps(): Promise<PublicDeps> {
  const supabase = await createClient();
  return {
    async event(firm, event) {
      const { data, error } = await supabase.rpc("booking_public_event", { p_firm_slug: firm, p_event_slug: event });
      if (error) throw new Error("booking_public_event failed");
      return data;
    },
    async busy(eventTypeId, from, to) {
      const { data, error } = await supabase.rpc("booking_public_busy", { p_event_type_id: eventTypeId, p_from: from, p_to: to });
      if (error) throw new Error("booking_public_busy failed");
      return data;
    },
    async hold(args) {
      const viewer = await sessionViewerWithAssurance(supabase);
      const { data, error } = await createServiceClient().rpc("booking_public_hold", {
        ...args,
        p_viewer: viewer?.id ?? null,
        p_viewer_aal: viewer?.aal ?? null,
      });
      if (error) throw new Error(error.message);
      return data;
    },
    async agreement(publicRef) {
      const { data, error } = await supabase.rpc("booking_agreement_for_signing", { p_ref: publicRef });
      if (error) throw new Error("booking_agreement_for_signing failed");
      return data;
    },
    now: () => Date.now(),
  };
}

/** The signed-in visitor's user id from their verified session, or null when signed out. */
export async function sessionViewer(supabase: SessionClient): Promise<string | null> {
  const { data } = await supabase.auth.getClaims();
  const sub = data?.claims?.sub;
  return isUuid(sub) ? sub : null;
}

/** The visitor's session assurance: aal2, "mfa" (passkey or recovery code on this session), or aal1. */
export type ViewerAssurance = "aal1" | "aal2" | "mfa";

/**
 * The signed-in visitor and their session's assurance, read from their own verified session, or
 * null when signed out. "mfa" means public.session_mfa_satisfied() holds on that session (the
 * staff MFA rule). The database opens a practice page only to staff at aal2 or "mfa", and links a
 * booking to a client who has a second step only at the same levels.
 */
export async function sessionViewerWithAssurance(supabase: SessionClient): Promise<{ id: string; aal: ViewerAssurance } | null> {
  const { data } = await supabase.auth.getClaims();
  const sub = data?.claims?.sub;
  if (!isUuid(sub)) return null;
  if (data?.claims?.aal === "aal2") return { id: sub, aal: "aal2" };
  try {
    const satisfied = await supabase.rpc("session_mfa_satisfied");
    return { id: sub, aal: !satisfied?.error && satisfied?.data === true ? "mfa" : "aal1" };
  } catch {
    return { id: sub, aal: "aal1" };
  }
}

/** The visitor's address as Cloudflare (or a local proxy) reports it. */
export { clientAddress } from "@/lib/security/client-address";
