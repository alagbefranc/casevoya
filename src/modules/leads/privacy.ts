/**
 * The firm's public privacy notice page (/privacy/<firm>, CRM-01), linked from its enquiry page and
 * its booking page. Pure: the path and what public_privacy_notice returned.
 */
export function privacyPath(slug: string): string {
  return `/privacy/${encodeURIComponent(slug)}`;
}

export type PublicPrivacyNotice = { firmName: string; firmSlug: string; title: string; version: string; body: string; publishedOn: string | null };

export function parsePrivacyNotice(raw: unknown): PublicPrivacyNotice | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const row = raw as Record<string, unknown>;
  const text = (value: unknown) => (typeof value === "string" && value.trim() ? value : null);
  const firmName = text(row.firm_name);
  const firmSlug = text(row.firm_slug);
  const title = text(row.title);
  const body = text(row.body);
  if (!firmName || !firmSlug || !title || !body) return null;
  const published = text(row.published_at);
  return { firmName, firmSlug, title, version: text(row.version_label) ?? "", body, publishedOn: published ? published.slice(0, 10) : null };
}
