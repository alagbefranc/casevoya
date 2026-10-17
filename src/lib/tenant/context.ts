/**
 * Tenant context plumbing.
 *
 * The active workspace travels to Postgres as the `x-casevoya-org` header (PostgREST) or the
 * transaction-local `app.organization_id` setting (direct SQL / workers). The database function
 * app.current_organization_id() only returns it when the caller is an ACTIVE member, so the
 * value is a workspace selection, never an authorization claim.
 */
export const ORG_HEADER = "x-casevoya-org";
export const REQUEST_ID_HEADER = "x-request-id";
export const ACTIVE_ORG_COOKIE = "cv_active_org";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const REQUEST_ID_RE = /^[A-Za-z0-9._:-]{8,200}$/;

export function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_RE.test(value);
}

/** Accepts a well-formed upstream request id, otherwise mints a new one. */
export function resolveRequestId(incoming: string | null | undefined): string {
  if (incoming && REQUEST_ID_RE.test(incoming)) return incoming;
  return crypto.randomUUID();
}

export function tenantHeaders(
  organizationId?: string | null,
  requestId?: string | null,
): Record<string, string> {
  const headers: Record<string, string> = {};
  if (organizationId != null) {
    if (!isUuid(organizationId)) throw new Error("organizationId must be a UUID");
    headers[ORG_HEADER] = organizationId.toLowerCase();
  }
  if (requestId) headers[REQUEST_ID_HEADER] = resolveRequestId(requestId);
  return headers;
}

const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{1,61}[a-z0-9])$/;

/** Mirrors the organizations.slug CHECK constraint. */
export function isValidOrgSlug(slug: string): boolean {
  return SLUG_RE.test(slug);
}
