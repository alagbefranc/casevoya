const SLUG = /^[a-z0-9](?:[a-z0-9-]{1,61}[a-z0-9])$/;

/** Local parts that must not become a firm address on the inbound domain. */
export const RESERVED_FIRM_SLUGS = [
  "support",
  "billing",
  "admin",
  "hello",
  "noreply",
  "postmaster",
  "abuse",
  "security",
  "help",
  "info",
  "team",
] as const;

const RESERVED = new Set<string>(RESERVED_FIRM_SLUGS);

/** A unique organization slug from a firm name. Entropy keeps collisions off the unique index. */
export function firmSlug(name: string, entropy = Math.random().toString(36).slice(2, 8)): string {
  const base = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  const suffix = entropy.replace(/[^a-z0-9]/g, "").slice(0, 6).padEnd(6, "0");
  let slug = `${base || "firm"}-${suffix}`.replace(/-+/g, "-").replace(/^-+|-+$/g, "");
  if (slug.length > 63) slug = slug.slice(0, 63).replace(/-+$/g, "");
  if (!SLUG.test(slug) || RESERVED.has(slug)) return `firm-${suffix}`;
  return slug;
}
