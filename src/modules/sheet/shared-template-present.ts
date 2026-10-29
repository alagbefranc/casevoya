/**
 * ADM-03: the firm view of shared templates. Diff rules match app.shared_template_changes:
 * title, summary and items, in that order. A first version (no previous body) lists every field
 * with an empty "before". Pure.
 */

export type SharedTemplateBody = {
  title: string;
  summary: string;
  items: string[];
};

export type TemplateChange = {
  field: "title" | "summary" | "items";
  before: string;
  after: string;
};

const FIELDS = ["title", "summary", "items"] as const;

export function fieldLabel(field: TemplateChange["field"]): string {
  if (field === "title") return "Title";
  if (field === "summary") return "Summary";
  return "Items";
}

function itemsText(items: readonly string[]): string {
  return items.join("\n");
}

/** The difference between two bodies. `before` null is the first version. */
export function templateChanges(before: SharedTemplateBody | null, after: SharedTemplateBody): TemplateChange[] {
  const changes: TemplateChange[] = [];
  for (const field of FIELDS) {
    const previous = before == null ? "" : field === "items" ? itemsText(before.items) : before[field];
    const next = field === "items" ? itemsText(after.items) : after[field];
    if (before == null || previous !== next) changes.push({ field, before: previous, after: next });
  }
  return changes;
}

export function isFirstVersion(changes: readonly TemplateChange[]): boolean {
  return changes.length > 0 && changes.every((change) => change.before === "");
}

type RawVersion = {
  id: string;
  template_id: string;
  stable_key: string;
  template_title: string;
  version_number: number;
  status: string;
  body: SharedTemplateBody;
  author_name: string;
  reviewer_label: string | null;
  effective_on: string;
  changelog: string;
  test_evidence: string;
  reviewed_at: string | null;
  published_at: string | null;
  supersedes_version_id: string | null;
};

export type SharedTemplateVersionView = {
  id: string;
  versionNumber: number;
  status: string;
  body: SharedTemplateBody;
  authorName: string;
  reviewerLabel: string | null;
  effectiveOn: string;
  changelog: string;
  testEvidence: string;
  reviewedAt: string | null;
};

export type SharedTemplateCard = {
  id: string;
  stableKey: string;
  title: string;
  published: SharedTemplateVersionView | null;
  diff: TemplateChange[];
  history: SharedTemplateVersionView[];
  adoption: { versionId: string; versionNumber: number } | null;
  /** The firm's own wording, kept apart from the reviewed body. */
  override: { body: SharedTemplateBody; reason: string; basedOnVersionNumber: number } | null;
  pins: number;
};

export type SharedTemplateNotice = {
  id: string;
  kind: "published" | "rolled_back";
  versionId: string;
  versionNumber: number;
  title: string;
  stableKey: string;
  changelog: string;
};

export type SharedTemplatesView = {
  canAdopt: boolean;
  canOverride: boolean;
  canPin: boolean;
  notices: SharedTemplateNotice[];
  templates: SharedTemplateCard[];
  matters: { id: string; title: string }[];
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function bodyOf(value: unknown): SharedTemplateBody | null {
  const body = asRecord(value);
  if (!body || typeof body.title !== "string") return null;
  const items = Array.isArray(body.items) ? body.items.filter((item): item is string => typeof item === "string") : [];
  return { title: body.title, summary: typeof body.summary === "string" ? body.summary : "", items };
}

function versionOf(row: RawVersion): SharedTemplateVersionView {
  return {
    id: row.id,
    versionNumber: row.version_number,
    status: row.status,
    body: row.body,
    authorName: row.author_name,
    reviewerLabel: row.reviewer_label,
    effectiveOn: row.effective_on.slice(0, 10),
    changelog: row.changelog,
    testEvidence: row.test_evidence,
    reviewedAt: row.reviewed_at,
  };
}

function readVersions(value: unknown): RawVersion[] {
  if (!Array.isArray(value)) return [];
  const versions: RawVersion[] = [];
  for (const item of value) {
    const row = asRecord(item);
    const body = row ? bodyOf(row.body) : null;
    if (!row || !body || typeof row.id !== "string" || typeof row.template_id !== "string") continue;
    if (typeof row.version_number !== "number" || typeof row.status !== "string") continue;
    versions.push({
      id: row.id,
      template_id: row.template_id,
      stable_key: typeof row.stable_key === "string" ? row.stable_key : "",
      template_title: typeof row.template_title === "string" ? row.template_title : body.title,
      version_number: row.version_number,
      status: row.status,
      body,
      author_name: typeof row.author_name === "string" ? row.author_name : "",
      reviewer_label: typeof row.reviewer_label === "string" ? row.reviewer_label : null,
      effective_on: typeof row.effective_on === "string" ? row.effective_on : "",
      changelog: typeof row.changelog === "string" ? row.changelog : "",
      test_evidence: typeof row.test_evidence === "string" ? row.test_evidence : "",
      reviewed_at: typeof row.reviewed_at === "string" ? row.reviewed_at : null,
      published_at: typeof row.published_at === "string" ? row.published_at : null,
      supersedes_version_id: typeof row.supersedes_version_id === "string" ? row.supersedes_version_id : null,
    });
  }
  return versions;
}

/** Builds the firm catalogue from public.firm_shared_templates(). */
export function assembleSharedTemplates(data: unknown): SharedTemplatesView {
  const root = asRecord(data) ?? {};
  const versions = readVersions(root.versions);
  const byTemplate = new Map<string, RawVersion[]>();
  for (const version of versions) {
    const list = byTemplate.get(version.template_id) ?? [];
    list.push(version);
    byTemplate.set(version.template_id, list);
  }
  const adoptions = new Map<string, string>();
  if (Array.isArray(root.adoptions)) {
    for (const item of root.adoptions) {
      const row = asRecord(item);
      if (row && typeof row.template_id === "string" && typeof row.version_id === "string") adoptions.set(row.template_id, row.version_id);
    }
  }
  const overrides = new Map<string, { body: SharedTemplateBody; reason: string; basedOn: string }>();
  if (Array.isArray(root.overrides)) {
    for (const item of root.overrides) {
      const row = asRecord(item);
      const body = row ? bodyOf(row.body) : null;
      if (!row || row.kind !== "edit" || !body || typeof row.template_id !== "string") continue;
      overrides.set(row.template_id, {
        body,
        reason: typeof row.reason === "string" ? row.reason : "",
        basedOn: typeof row.based_on_version_id === "string" ? row.based_on_version_id : "",
      });
    }
  }
  const pins = new Map<string, number>();
  if (Array.isArray(root.pins)) {
    for (const item of root.pins) {
      const row = asRecord(item);
      if (row && typeof row.template_id === "string" && typeof row.count === "number") pins.set(row.template_id, row.count);
    }
  }
  const templates: SharedTemplateCard[] = [...byTemplate.entries()].map(([id, list]) => {
    const ordered = [...list].sort((a, b) => a.version_number - b.version_number);
    const published = ordered.find((version) => version.status === "published") ?? null;
    const previous = published?.supersedes_version_id
      ? ordered.find((version) => version.id === published.supersedes_version_id) ?? null
      : null;
    const adoptedId = adoptions.get(id) ?? null;
    const adopted = adoptedId ? ordered.find((version) => version.id === adoptedId) ?? null : null;
    const override = overrides.get(id) ?? null;
    const basedOn = override ? ordered.find((version) => version.id === override.basedOn) : null;
    return {
      id,
      stableKey: ordered[0]?.stable_key ?? "",
      title: published?.template_title ?? ordered[0]?.template_title ?? "Shared template",
      published: published ? versionOf(published) : null,
      diff: published ? templateChanges(previous ? previous.body : null, published.body) : [],
      history: ordered.map(versionOf),
      adoption: adopted ? { versionId: adopted.id, versionNumber: adopted.version_number } : null,
      override: override ? { body: override.body, reason: override.reason, basedOnVersionNumber: basedOn?.version_number ?? published?.version_number ?? 0 } : null,
      pins: pins.get(id) ?? 0,
    };
  });
  templates.sort((a, b) => a.title.localeCompare(b.title));
  const notices: SharedTemplateNotice[] = [];
  if (Array.isArray(root.notices)) {
    for (const item of root.notices) {
      const row = asRecord(item);
      if (!row || (row.kind !== "published" && row.kind !== "rolled_back") || typeof row.id !== "string") continue;
      notices.push({
        id: row.id,
        kind: row.kind,
        versionId: typeof row.version_id === "string" ? row.version_id : "",
        versionNumber: typeof row.version_number === "number" ? row.version_number : 0,
        title: typeof row.title === "string" ? row.title : "Shared template",
        stableKey: typeof row.stable_key === "string" ? row.stable_key : "",
        changelog: typeof row.changelog === "string" ? row.changelog : "",
      });
    }
  }
  const matters: { id: string; title: string }[] = [];
  if (Array.isArray(root.matters)) {
    for (const item of root.matters) {
      const row = asRecord(item);
      if (row && typeof row.id === "string" && typeof row.title === "string") matters.push({ id: row.id, title: row.title });
    }
  }
  return {
    canAdopt: root.can_adopt === true,
    canOverride: root.can_override === true,
    canPin: root.can_pin === true,
    notices,
    templates,
    matters,
  };
}

export function sharedTemplateError(message: string): string {
  if (/step-up is required/i.test(message)) return "Confirm it’s you with your authenticator, then try again.";
  if (/already uses version/i.test(message)) return message;
  if (/adopt the shared template first|no longer the published/i.test(message)) return "Adopt the published version first. Existing matter pins stay where they are.";
  if (/matches the reviewed version/i.test(message)) return "That wording matches the reviewed version, so it was not saved as a firm override.";
  if (/staff access denied|template review denied/i.test(message)) return "A licensed member of the firm does that.";
  if (/a reason is required/i.test(message)) return "Write a reason of at least 3 characters.";
  return "That didn’t work. Reload the page and try again.";
}
