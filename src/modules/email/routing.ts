import { RESERVED_FIRM_SLUGS } from "@/lib/auth/slug";
import { firmAddress, inboundDomain } from "@/modules/email/addresses";

/** Zone casevoya.ca. Email Routing rules are addressed by zone, not account. */
export const EMAIL_ROUTING_ZONE_ID = "303990065795d627a9fd337b01258024";
export const INBOUND_EMAIL_WORKER = "casevoya-inbound-email";
/** Owned rules use this prefix. casevoya-test@ and the catch-all do not. */
export const FIRM_RULE_PREFIX = "casevoya-firm:";

const SLUG = /^[a-z0-9](?:[a-z0-9-]{1,61}[a-z0-9])$/;
const RESERVED = new Set<string>(RESERVED_FIRM_SLUGS);
const PAGE_SIZE = 50;
const MAX_PAGES = 20;

export type RoutingMatcher = { type: string; field?: string; value?: string };
export type RoutingAction = { type: string; value?: string[] };

export type RoutingRule = {
  id: string;
  name: string;
  enabled: boolean;
  matchers: RoutingMatcher[];
  actions: RoutingAction[];
};

export type RouteFailure = {
  op: "list" | "create" | "delete";
  slug?: string;
  ruleId?: string;
  error: string;
};

export type RoutingClient = {
  token: string;
  zoneId?: string;
  domain?: string;
  fetchImpl?: FetchLike;
};

type FetchLike = (
  input: string,
  init: { method: string; headers: Record<string, string>; body?: string },
) => Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }>;

type CfInfo = { page?: number; per_page?: number; total_count?: number };

export function firmRuleName(slug: string): string {
  return `${FIRM_RULE_PREFIX}${slug}`;
}

/** Exact base address. Plus-tags ride this rule because subaddressing is on. */
export function firmRulePayload(slug: string, domain: string): Record<string, unknown> {
  return {
    name: firmRuleName(slug),
    enabled: true,
    source: "api",
    matchers: [{ type: "literal", field: "to", value: firmAddress(slug, domain) }],
    actions: [{ type: "worker", value: [INBOUND_EMAIL_WORKER] }],
  };
}

export function isOwnedRule(rule: RoutingRule): boolean {
  return rule.name.startsWith(FIRM_RULE_PREFIX);
}

export function isCanonicalFirmRule(rule: RoutingRule, slug: string, domain: string): boolean {
  if (!rule.enabled || rule.name !== firmRuleName(slug)) return false;
  if (rule.matchers.length !== 1 || rule.actions.length !== 1) return false;
  const matcher = rule.matchers[0];
  const action = rule.actions[0];
  if (matcher?.type !== "literal" || matcher.field !== "to") return false;
  if (matcher.value !== firmAddress(slug, domain)) return false;
  if (action?.type !== "worker" || action.value?.length !== 1) return false;
  return action.value[0] === INBOUND_EMAIL_WORKER;
}

export function planFirmRouting(desiredSlugs: readonly string[], rules: readonly RoutingRule[], domainInput?: string) {
  const domain = inboundDomain(domainInput);
  const create: string[] = [];
  const skipped: string[] = [];
  const keep = new Set<string>();
  const seen = new Set<string>();

  for (const raw of desiredSlugs) {
    const slug = raw.trim().toLowerCase();
    if (!slug || seen.has(slug)) continue;
    seen.add(slug);
    if (!SLUG.test(slug) || RESERVED.has(slug) || firmAddress(slug, domain).length > 90) {
      skipped.push(slug);
      continue;
    }
    const matches = rules.filter((rule) => isCanonicalFirmRule(rule, slug, domain));
    if (matches.length === 0) create.push(slug);
    else keep.add(matches[0].id);
  }

  const remove = rules.filter((rule) => isOwnedRule(rule) && !keep.has(rule.id));
  return { domain, create, remove, keep: [...keep], skipped };
}

export async function listRoutingRules(client: RoutingClient): Promise<RoutingRule[]> {
  const zoneId = client.zoneId || EMAIL_ROUTING_ZONE_ID;
  const rules: RoutingRule[] = [];
  for (let page = 1; page <= MAX_PAGES; page += 1) {
    const url = `https://api.cloudflare.com/client/v4/zones/${zoneId}/email/routing/rules?page=${page}&per_page=${PAGE_SIZE}`;
    const envelope = await cfRequest(client, url, "GET");
    const batch = asRules(envelope.result);
    rules.push(...batch);
    const info = envelope.info;
    const total = info?.total_count;
    if (typeof total === "number") {
      if (rules.length >= total) return rules;
      continue;
    }
    if (batch.length < PAGE_SIZE) return rules;
  }
  throw new Error("email routing rule list was incomplete");
}

export async function reconcileFirmRoutes(desiredSlugs: readonly string[], client: RoutingClient) {
  const failures: RouteFailure[] = [];
  let rules: RoutingRule[];
  try {
    rules = await listRoutingRules(client);
  } catch (error) {
    return {
      added: [] as string[],
      removed: [] as { id: string; name: string }[],
      kept: [] as string[],
      skipped: [] as string[],
      failures: [{ op: "list" as const, error: messageOf(error) }],
    };
  }
  const plan = planFirmRouting(desiredSlugs, rules, client.domain);
  const added: string[] = [];
  const removed: { id: string; name: string }[] = [];
  for (const slug of plan.create) {
    const created = await createFirmRule(slug, client);
    if (created.ok) added.push(slug);
    else failures.push({ op: "create", slug, error: created.error });
  }
  for (const rule of plan.remove) {
    const deleted = await deleteFirmRule(rule.id, client);
    if (deleted.ok) removed.push({ id: rule.id, name: rule.name });
    else failures.push({ op: "delete", ruleId: rule.id, slug: slugFromRule(rule), error: deleted.error });
  }
  return { added, removed, kept: plan.keep, skipped: plan.skipped, failures };
}

export async function applyFirmSlugRoute(
  change: { claimed?: string | null; released?: string | null },
  client: RoutingClient,
): Promise<{ ok: boolean; failures: RouteFailure[] }> {
  const claimed = normalizeSlug(change.claimed);
  const released = normalizeSlug(change.released);
  if (claimed === released) return { ok: true, failures: [] };

  let rules: RoutingRule[];
  try {
    rules = await listRoutingRules(client);
  } catch (error) {
    return { ok: false, failures: [{ op: "list", error: messageOf(error) }] };
  }

  const failures: RouteFailure[] = [];
  const domain = inboundDomain(client.domain);
  if (claimed) {
    if (!SLUG.test(claimed) || RESERVED.has(claimed)) {
      // Leave the previous rule in place until the new slug is one we can route.
      return { ok: false, failures: [{ op: "create", slug: claimed, error: "slug is not routable" }] };
    }
    if (!rules.some((rule) => isCanonicalFirmRule(rule, claimed, domain))) {
      const created = await createFirmRule(claimed, client);
      if (!created.ok) {
        failures.push({ op: "create", slug: claimed, error: created.error });
        // Keep the previous rule until the new one exists. Reconcile retries both.
        return { ok: false, failures };
      }
    }
  }
  if (released && released !== claimed) {
    for (const rule of rules) {
      if (!ownedRuleForSlug(rule, released, domain)) continue;
      const deleted = await deleteFirmRule(rule.id, client);
      if (!deleted.ok) failures.push({ op: "delete", slug: released, ruleId: rule.id, error: deleted.error });
    }
  }
  return { ok: failures.length === 0, failures };
}

/** Logs routing failures and never throws, so a slug claim can finish. */
export async function provisionFirmSlug(
  change: { claimed?: string | null; released?: string | null },
  client: RoutingClient,
): Promise<void> {
  const label = normalizeSlug(change.claimed) || normalizeSlug(change.released) || "slug";
  if (!client.token.trim()) {
    console.error("email routing skipped", label, "CLOUDFLARE_ROUTING_API_TOKEN is not set");
    return;
  }
  try {
    const result = await applyFirmSlugRoute(change, client);
    if (!result.ok) {
      for (const failure of result.failures) {
        console.error("email routing failed", failure.op, failure.slug ?? failure.ruleId ?? label, failure.error);
      }
    }
  } catch (error) {
    console.error("email routing failed", label, messageOf(error));
  }
}

function ownedRuleForSlug(rule: RoutingRule, slug: string, domain: string): boolean {
  if (!isOwnedRule(rule)) return false;
  if (rule.name === firmRuleName(slug)) return true;
  return rule.matchers.some((matcher) => {
    if (matcher.type !== "literal" || matcher.field !== "to" || !matcher.value) return false;
    const at = matcher.value.lastIndexOf("@");
    if (at < 1 || matcher.value.slice(at + 1) !== domain) return false;
    const local = matcher.value.slice(0, at);
    return local === slug || local.startsWith(`${slug}+`);
  });
}

async function createFirmRule(slug: string, client: RoutingClient): Promise<{ ok: true } | { ok: false; error: string }> {
  const domain = inboundDomain(client.domain);
  const address = firmAddress(slug, domain);
  if (address.length > 90 || address.includes("+")) return { ok: false, error: "address is not an exact firm rule" };
  const zoneId = client.zoneId || EMAIL_ROUTING_ZONE_ID;
  const url = `https://api.cloudflare.com/client/v4/zones/${zoneId}/email/routing/rules`;
  try {
    await cfRequest(client, url, "POST", firmRulePayload(slug, domain));
    return { ok: true };
  } catch (error) {
    const status = error instanceof CfError ? error.status : 0;
    if (status === 409) return { ok: true };
    return { ok: false, error: messageOf(error) };
  }
}

async function deleteFirmRule(ruleId: string, client: RoutingClient): Promise<{ ok: true } | { ok: false; error: string }> {
  const zoneId = client.zoneId || EMAIL_ROUTING_ZONE_ID;
  const url = `https://api.cloudflare.com/client/v4/zones/${zoneId}/email/routing/rules/${encodeURIComponent(ruleId)}`;
  try {
    await cfRequest(client, url, "DELETE");
    return { ok: true };
  } catch (error) {
    const status = error instanceof CfError ? error.status : 0;
    if (status === 404) return { ok: true };
    return { ok: false, error: messageOf(error) };
  }
}

class CfError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

async function cfRequest(client: RoutingClient, url: string, method: "GET" | "POST" | "DELETE", body?: Record<string, unknown>) {
  const fetchImpl = client.fetchImpl ?? fetch;
  let response: { ok: boolean; status: number; json: () => Promise<unknown> };
  try {
    response = await fetchImpl(url, {
      method,
      headers: {
        authorization: `Bearer ${client.token}`,
        ...(body ? { "content-type": "application/json" } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch (error) {
    throw new CfError(0, messageOf(error));
  }
  let payload: unknown = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }
  const record = payload && typeof payload === "object" ? (payload as Record<string, unknown>) : {};
  const errors = Array.isArray(record.errors) ? record.errors : [];
  const first = errors[0] && typeof errors[0] === "object" ? (errors[0] as Record<string, unknown>) : {};
  if (!response.ok || record.success === false) {
    const text = typeof first.message === "string" ? first.message : `cloudflare ${response.status}`;
    throw new CfError(response.status, text);
  }
  const info = record.result_info && typeof record.result_info === "object" ? (record.result_info as CfInfo) : undefined;
  return { result: record.result, info };
}

function asRules(result: unknown): RoutingRule[] {
  if (!Array.isArray(result)) return [];
  const rules: RoutingRule[] = [];
  for (const item of result) {
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    const id = typeof row.id === "string" && row.id ? row.id : typeof row.tag === "string" ? row.tag : "";
    if (!id) continue;
    rules.push({
      id,
      name: typeof row.name === "string" ? row.name : "",
      enabled: row.enabled !== false,
      matchers: asMatchers(row.matchers),
      actions: asActions(row.actions),
    });
  }
  return rules;
}

function asMatchers(value: unknown): RoutingMatcher[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const row = item as Record<string, unknown>;
    if (typeof row.type !== "string") return [];
    return [{
      type: row.type,
      field: typeof row.field === "string" ? row.field : undefined,
      value: typeof row.value === "string" ? row.value : undefined,
    }];
  });
}

function asActions(value: unknown): RoutingAction[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const row = item as Record<string, unknown>;
    if (typeof row.type !== "string") return [];
    const raw = Array.isArray(row.value) ? row.value.filter((entry): entry is string => typeof entry === "string") : [];
    return [{ type: row.type, value: raw }];
  });
}

function slugFromRule(rule: RoutingRule): string | undefined {
  if (rule.name.startsWith(FIRM_RULE_PREFIX)) return rule.name.slice(FIRM_RULE_PREFIX.length);
  return undefined;
}

function normalizeSlug(value: string | null | undefined): string {
  return value?.trim().toLowerCase() ?? "";
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : "network";
}
