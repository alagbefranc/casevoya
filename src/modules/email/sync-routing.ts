import "server-only";

import { emailRuntimeConfig } from "@/lib/email/env";
import { createServiceClient } from "@/lib/supabase/service";
import { EMAIL_ROUTING_ZONE_ID, provisionFirmSlug, reconcileFirmRoutes, type RoutingClient } from "@/modules/email/routing";

function client(): RoutingClient {
  const config = emailRuntimeConfig();
  return {
    token: config.routingToken,
    zoneId: EMAIL_ROUTING_ZONE_ID,
    domain: config.inboundDomain,
  };
}

/** After a firm claims a slug. A routing failure is logged and does not throw. */
export async function syncClaimedFirmSlug(slug: string): Promise<void> {
  await provisionFirmSlug({ claimed: slug }, client());
}

/** Create the new exact rule first. The previous slug's rule is removed after that succeeds. */
export async function syncChangedFirmSlug(change: { released: string; claimed: string }): Promise<void> {
  await provisionFirmSlug({ claimed: change.claimed, released: change.released }, client());
}

/** Drop the owned rule for a slug that is no longer on a firm. */
export async function syncReleasedFirmSlug(slug: string): Promise<void> {
  await provisionFirmSlug({ released: slug }, client());
}

const SLUG_PAGE = 1000;
const SLUG_PAGE_CAP = 100;

export async function runRoutingReconcile() {
  const supabase = createServiceClient();
  const slugs: string[] = [];
  for (let page = 0; page < SLUG_PAGE_CAP; page += 1) {
    const from = page * SLUG_PAGE;
    const { data, error } = await supabase
      .from("organizations")
      .select("slug")
      .order("id", { ascending: true })
      .range(from, from + SLUG_PAGE - 1);
    if (error) throw new Error(error.message);
    const batch = data ?? [];
    for (const row of batch) {
      if (typeof row.slug === "string") slugs.push(row.slug);
    }
    if (batch.length < SLUG_PAGE) return reconcileFirmRoutes(slugs, client());
  }
  throw new Error("organization slug list was incomplete");
}
