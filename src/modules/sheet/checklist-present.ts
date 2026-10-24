/**
 * DOC-01: firm checklist templates on Templates > Checklists and Apply checklist on a matter's
 * Documents tab. Pure; templates-load and matter-load read the database as the signed-in member.
 */

export type ChecklistFormat = "pdf" | "jpeg" | "png" | "heic" | "docx";

export const CHECKLIST_FORMATS: { value: ChecklistFormat; label: string }[] = [
  { value: "pdf", label: "PDF" },
  { value: "jpeg", label: "JPEG" },
  { value: "png", label: "PNG" },
  { value: "heic", label: "HEIC" },
  { value: "docx", label: "Word" },
];

/** Who on the matter an item is for; empty is everyone the firm acts for on it. */
export const CHECKLIST_ROLES = [
  { value: "", label: "Everyone on the matter" },
  { value: "applicant", label: "Applicant" },
  { value: "dependant", label: "Dependants" },
  { value: "sponsor", label: "Sponsor" },
  { value: "employer", label: "Employer" },
  { value: "guardian", label: "Guardian" },
] as const;

/** One item as the editor sends it to public.save_checklist_template. */
export type ChecklistItemInput = {
  item_key: string;
  purpose: string;
  explanation: string;
  owner: "client" | "staff";
  due_offset_days: number | null;
  acceptable_formats: ChecklistFormat[];
  review_criteria: string;
  records_expiry: boolean;
  party_role: string;
  condition_field: string;
  condition_equals: string;
};

export type ChecklistTemplateView = {
  id: string;
  stableKey: string;
  title: string;
  versionNumber: number;
  status: "draft" | "approved" | "retired";
  /** checklist_templates.version, for Approve. */
  rowVersion: number;
  approvedBy: string | null;
  items: ChecklistItemInput[];
};

/** A question an item can depend on: an intake field with fixed answers. */
export type ConditionOption = { key: string; label: string; answers: string[] };

export type ChecklistsLiveData = {
  organizationId: string;
  templates: ChecklistTemplateView[];
  /** Staff who may draft (owner, licensed consultant, case manager). */
  edit: boolean;
  /** A licensed consultant: may approve a draft. */
  approve: boolean;
  conditions: ConditionOption[];
};

/** "Spousal sponsorship" -> "spousal_sponsorship": the stable key a new checklist is saved under. */
export function keyFromTitle(title: string): string {
  const slug = title
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 60);
  return /^[a-z]/.test(slug) ? slug : `checklist_${slug}`.slice(0, 64).replace(/_+$/, "") || "checklist";
}

/** An item key from its type, unique among the keys already used. */
export function itemKey(purpose: string, used: ReadonlySet<string>): string {
  const base = keyFromTitle(purpose).replace(/^checklist_/, "item_") || "item";
  let key = base;
  for (let n = 2; used.has(key); n++) key = `${base.slice(0, 60)}_${n}`;
  return key;
}

const STATUS_LABEL: Record<ChecklistTemplateView["status"], string> = { draft: "Draft", approved: "Approved", retired: "Retired" };

/** The Designer's checklist card for one template version. */
export function checklistCard(template: ChecklistTemplateView): { title: { left: string; right: string }; note: { left: string; right: string }; tag: string } {
  const people = new Set(template.items.map((item) => item.party_role || "everyone"));
  const conditional = template.items.filter((item) => item.condition_field).length;
  return {
    title: { left: template.title, right: `v${template.versionNumber}` },
    note: {
      left: `${template.items.length} item${template.items.length === 1 ? "" : "s"}${conditional ? `, ${conditional} on an intake answer` : ""}`,
      right: people.size === 1 && people.has("everyone") ? "Everyone on the matter" : `${people.size} kinds of people`,
    },
    tag: template.status === "approved" && template.approvedBy ? `Approved by ${template.approvedBy}` : STATUS_LABEL[template.status],
  };
}

export type ChecklistProposals = {
  add: { itemId: string; purpose: string; personId: string; person: string }[];
  remove: { requestId: string; purpose: string; person: string; reason: string }[];
  waiting: { purpose: string; person: string; field: string }[];
  template: { title: string; versionNumber: number } | null;
};

function list(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.filter((row): row is Record<string, unknown> => Boolean(row) && typeof row === "object") : [];
}

const str = (value: unknown) => (typeof value === "string" ? value : "");

/** public.checklist_apply_preview's answer, read defensively. */
export function readProposals(data: unknown): ChecklistProposals {
  const record = data && typeof data === "object" && !Array.isArray(data) ? (data as Record<string, unknown>) : {};
  const template = record.template && typeof record.template === "object" ? (record.template as Record<string, unknown>) : null;
  return {
    add: list(record.add).map((row) => ({ itemId: str(row.item_id), purpose: str(row.purpose), personId: str(row.person_id), person: str(row.person) })),
    remove: list(record.remove).map((row) => ({ requestId: str(row.request_id), purpose: str(row.purpose), person: str(row.person), reason: str(row.reason) })),
    waiting: list(record.waiting).map((row) => ({ purpose: str(row.purpose), person: str(row.person), field: str(row.field) })),
    template: template ? { title: str(template.title), versionNumber: Number(template.version_number ?? 0) } : null,
  };
}

/** The database's refusals in plain words. */
export function checklistError(message: string): string {
  if (/denied/i.test(message)) return "You can’t do that with this checklist.";
  if (/version conflict/i.test(message)) return "Someone changed this checklist. Reload it.";
  if (/look at the proposals again/i.test(message)) return "The checklist or the answers changed. Preview it again.";
  if (/sample mode/i.test(message)) return "This firm is in sample mode: only sample matters accept new work.";
  if (/^(give |a checklist |an approved |that checklist |an item |choose |a condition |item \d+ |two items |only )/i.test(message)) {
    return `${message.charAt(0).toUpperCase()}${message.slice(1).replace(/''/g, "’").replace(/'/g, "’")}.`;
  }
  return "That didn’t save. Try again.";
}

/** "From Spousal sponsorship v2": a request's template version on the matter's Documents tab. */
export function fromChecklist(title: string, versionNumber: number): string {
  return `From ${title} v${versionNumber}`;
}
