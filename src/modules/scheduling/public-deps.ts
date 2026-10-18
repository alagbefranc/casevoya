import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { PublicDeps } from "./public-api";

/**
 * Supabase wiring for the public booking API. Calls run as the visitor (anonymous, or signed in):
 * the database functions return published types and busy ranges only, and link a booking to a
 * person only when the signed-in portal client is that person.
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
      const { data, error } = await supabase.rpc("booking_public_hold", args);
      if (error) throw new Error(error.message);
      return data;
    },
    now: () => Date.now(),
  };
}

/** The visitor's address as Cloudflare (or a local proxy) reports it. */
export function clientAddress(headers: Headers): string | null {
  return headers.get("cf-connecting-ip") ?? headers.get("x-real-ip") ?? headers.get("x-forwarded-for");
}
