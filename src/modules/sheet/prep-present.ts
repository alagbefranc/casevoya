/**
 * PREP-01 and PREP-03 view models for the matter Forms and Documents tabs.
 * Status words come from the database review. Nothing here names a real form or a real field.
 */
import { SUBMISSION_CHANNEL_OPTIONS } from "@/modules/government/present";
import { isStaleReason, staleLabel, type FieldStatus, type StaleReason } from "@/modules/prep/mapping";
import { DEFAULT_BUNDLE_MAX_BYTES, DEFAULT_BUNDLE_PATTERN } from "@/modules/prep/channel-name";

export type FormFactView = { person: string; label: string; value: string };

export type FormFieldView = {
  key: string;
  label: string;
  required: boolean;
  status: FieldStatus;
  statusLabel: string;
  factKey: string | null;
  facts: FormFactView[];
};

export type FormPinView = {
  title: string;
  meta: string;
  href: string;
  output: string;
  stale: string | null;
  counts: string;
  fields: FormFieldView[];
};

export type MatterFormsData = {
  organizationId: string;
  matterId: string;
  today: string;
  programKey: string | null;
  canPropose: boolean;
  canReview: boolean;
  canPin: boolean;
  pins: FormPinView[];
  approved: { id: string; label: string; disabled: string | null }[];
  pending: { id: string; label: string; version: number; snapshot: boolean; href: string }[];
  catalogueEmpty: boolean;
};

export type BundleCandidateView = {
  versionId: string;
  name: string;
  purpose: string;
  note: string;
  selected: boolean;
};

export type MatterBundleData = {
  organizationId: string;
  matterId: string;
  canEdit: boolean;
  canSetRule: boolean;
  channel: string;
  channels: { value: string; label: string }[];
  ruleLabel: string;
  pattern: string;
  maxMb: number;
  candidates: BundleCandidateView[];
  index: { name: string; purpose: string; place: string }[];
  downloadHref: string | null;
};

const text = (value: unknown) => (typeof value === "string" && value.trim() ? value.trim() : null);
const list = (value: unknown): Record<string, unknown>[] =>
  Array.isArray(value) ? value.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object" && !Array.isArray(item)) : [];

function statusLabel(status: FieldStatus, required: boolean): string {
  switch (status) {
    case "filled":
      return "Filled";
    case "missing":
      return required ? "Missing" : "Not provided";
    case "manual":
      return "Manual";
    default: {
      const unexpected: never = status;
      return unexpected;
    }
  }
}

function fieldStatusOf(value: unknown): FieldStatus {
  if (value === "filled" || value === "missing" || value === "manual") return value;
  return "manual";
}

function outputLabel(value: string | null): string {
  if (value === "manual_completion") return "Manual completion. Upload the finished form. Casevoya does not fill it.";
  return "Field review. Shows which approved facts fill which fields. Casevoya does not produce a filled government PDF.";
}

export function presentFormReview(
  raw: unknown,
  input: { organizationId: string; matterId: string; today: string; role: string; licensed: boolean },
): MatterFormsData | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const body = raw as Record<string, unknown>;
  const proposers = new Set(["firm_owner", "licensed_consultant", "case_manager"]);
  const pins = list(body.pins).map((pin) => {
    const fields = list(pin.fields).map((field) => {
      const status = fieldStatusOf(field.status);
      const required = field.required === true;
      return {
        key: text(field.field_key) ?? "field",
        label: text(field.label) ?? "Field",
        required,
        status,
        statusLabel: statusLabel(status, required),
        factKey: text(field.fact_field_key),
        facts: list(field.facts).map((fact) => ({
          person: text(fact.person_name) ?? "Person",
          label: text(fact.label) ?? "Fact",
          value: text(fact.value_text) ?? "",
        })),
      };
    });
    const filled = fields.filter((field) => field.status === "filled").length;
    const missing = fields.filter((field) => field.status === "missing").length;
    const reason = text(pin.stale_reason);
    const stale = isStaleReason(reason) ? staleLabel(reason) : null;
    const formId = text(pin.official_form_id) ?? "Form";
    const version = text(pin.form_version) ?? "version not recorded";
    const mapping = typeof pin.mapping_version === "number" ? pin.mapping_version : null;
    return {
      title: `${formId}, ${version}`,
      meta: [mapping ? `Mapping v${mapping}` : null, text(pin.checked_on) ? `Checked ${text(pin.checked_on)}` : null].filter(Boolean).join(" · "),
      href: text(pin.official_url) ?? "",
      output: outputLabel(text(pin.output_format)),
      stale,
      counts: fields.length ? `${filled} filled · ${missing} missing` : "No mapped fields",
      fields,
    };
  });
  const approved = list(body.approved).flatMap((row) => {
    const id = text(row.id);
    if (!id) return [];
    const reason = text(row.stale_reason);
    const stale: StaleReason | null = isStaleReason(reason) ? reason : null;
    const formId = text(row.official_form_id) ?? "Form";
    const version = text(row.form_version) ?? "";
    return [{ id, label: `${formId} ${version}`.trim(), disabled: stale ? staleLabel(stale) : null }];
  });
  const pending = list(body.pending).flatMap((row) => {
    const id = text(row.id);
    if (!id) return [];
    return [{
      id,
      label: `${text(row.official_form_id) ?? "Form"} ${text(row.form_version) ?? ""}`.trim(),
      version: typeof row.version === "number" ? row.version : 1,
      snapshot: row.snapshot === true,
      href: text(row.official_url) ?? "",
    }];
  });
  return {
    organizationId: input.organizationId,
    matterId: input.matterId,
    today: input.today,
    programKey: text(body.program_key),
    canPropose: proposers.has(input.role),
    canReview: input.licensed,
    canPin: proposers.has(input.role),
    pins,
    approved,
    pending,
    catalogueEmpty: approved.length === 0 && pending.length === 0 && pins.length === 0,
  };
}

function bytesNote(value: unknown): string {
  const bytes = typeof value === "number" ? value : null;
  if (!bytes) return "";
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function presentBundle(
  raw: unknown,
  input: { organizationId: string; matterId: string; role: string },
): MatterBundleData | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const body = raw as Record<string, unknown>;
  const editors = new Set(["firm_owner", "licensed_consultant", "case_manager"]);
  const channel = text(body.channel) ?? "online_portal";
  const rule = body.rule && typeof body.rule === "object" && !Array.isArray(body.rule) ? (body.rule as Record<string, unknown>) : null;
  const pattern = text(rule?.name_pattern) ?? DEFAULT_BUNDLE_PATTERN;
  const maxBytes = typeof rule?.max_bytes === "number" ? rule.max_bytes : DEFAULT_BUNDLE_MAX_BYTES;
  const source = rule?.source === "firm" ? "firm" : "product_default";
  const selected = new Map<string, number>();
  for (const item of list(body.items)) {
    const id = text(item.document_version_id);
    if (id) selected.set(id, typeof item.position === "number" ? item.position : selected.size + 1);
  }
  const candidates = list(body.candidates).flatMap((row) => {
    const versionId = text(row.document_version_id);
    const name = text(row.file_name);
    if (!versionId || !name) return [];
    const media = text(row.media_type) ?? "";
    const copyable = media === "application/pdf" || media === "image/jpeg" || media === "image/png";
    return [{
      versionId,
      name,
      purpose: text(row.purpose) ?? "Document",
      note: [bytesNote(row.byte_size), copyable ? "Copied into the PDF" : "Listed in the index, kept as its own file"].filter(Boolean).join(" · "),
      selected: selected.has(versionId),
    }];
  });
  const index = [...selected.entries()]
    .sort((a, b) => a[1] - b[1])
    .flatMap(([versionId, position]) => {
      const found = candidates.find((row) => row.versionId === versionId);
      return found ? [{ name: found.name, purpose: found.purpose, place: String(position) }] : [];
    });
  const ruleLabel = source === "firm"
    ? `This firm’s channel rule: ${pattern}, up to ${Math.round(maxBytes / (1024 * 1024))} MB.`
    : `No channel rule is set, so Casevoya uses ${pattern} and ${Math.round(maxBytes / (1024 * 1024))} MB. That size is a Casevoya limit, not an IRCC rule.`;
  return {
    organizationId: input.organizationId,
    matterId: input.matterId,
    canEdit: editors.has(input.role),
    canSetRule: input.role === "firm_owner",
    channel,
    channels: [...SUBMISSION_CHANNEL_OPTIONS],
    ruleLabel,
    pattern,
    maxMb: Math.round(maxBytes / (1024 * 1024)),
    candidates,
    index,
    downloadHref: index.length ? `/api/matters/${input.matterId}/evidence-bundle?organizationId=${input.organizationId}` : null,
  };
}

export function presentManifestExtras(raw: unknown): { forms: { name: string; note: string }[]; facts: { name: string; note: string }[] } {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { forms: [], facts: [] };
  const body = raw as Record<string, unknown>;
  return {
    forms: list(body.forms).map((form) => ({
      name: `${text(form.official_form_id) ?? "Form"} ${text(form.form_version) ?? ""}`.trim(),
      note: `Mapping v${typeof form.mapping_version === "number" ? form.mapping_version : "?"} · ${text(form.output_format) === "manual_completion" ? "Manual completion" : "Field review"}`,
    })),
    facts: list(body.facts).map((fact) => ({
      name: text(fact.label) ?? text(fact.field_key) ?? "Fact",
      note: `Approved fact · sha256 ${(text(fact.value_sha256) ?? "").slice(0, 8)}`,
    })),
  };
}
