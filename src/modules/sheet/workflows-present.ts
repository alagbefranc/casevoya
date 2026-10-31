/**
 * Firm workflows (2026-10-30): the Templates > Workflows tab. A firm owner or licensed consultant
 * makes the firm's own workflows (stages, steps, documents to request) or copies a published
 * Casevoya shared template into one. Shared templates stay read only. Pure.
 */
import { programLabel } from "@/modules/sheet/matters-present";

export type WorkflowItemKind = "step" | "document";
export type WorkflowItemOwner = "staff" | "client";

export type WorkflowItemInput = {
  kind: WorkflowItemKind;
  title: string;
  detail: string;
  owner: WorkflowItemOwner;
  due_offset_days: number | null;
};

export type WorkflowStageInput = { name: string; items: WorkflowItemInput[] };

export type WorkflowView = {
  id: string;
  name: string;
  programKey: string | null;
  description: string;
  status: "active" | "archived";
  rowVersion: number;
  updatedAt: string;
  /** Set when the workflow is the firm's copy of a shared template. */
  copiedFrom: { templateId: string; title: string; versionNumber: number | null } | null;
  stages: WorkflowStageInput[];
};

export type SharedWorkflowSource = {
  templateId: string;
  versionId: string;
  versionNumber: number;
  title: string;
  summary: string;
  items: number;
};

export type WorkflowsLiveData = {
  organizationId: string;
  /** Firm owner or licensed consultant: create, copy, edit, archive. */
  edit: boolean;
  programs: { value: string; label: string }[];
  workflows: WorkflowView[];
  shared: SharedWorkflowSource[];
  sharedFailed: boolean;
};

export const WORKFLOW_EDIT_ROLES: readonly string[] = ["firm_owner", "licensed_consultant"];

export const MAX_STAGES = 30;
export const MAX_ITEMS_PER_STAGE = 80;

export function blankItem(kind: WorkflowItemKind = "step"): WorkflowItemInput {
  return { kind, title: "", detail: "", owner: kind === "document" ? "client" : "staff", due_offset_days: null };
}

export function blankStage(): WorkflowStageInput {
  return { name: "", items: [blankItem()] };
}

/** Moves the entry at `from` one place up (-1) or down (+1); out of range leaves the list as it is. */
export function move<T>(list: readonly T[], from: number, by: -1 | 1): T[] {
  const to = from + by;
  if (from < 0 || from >= list.length || to < 0 || to >= list.length) return [...list];
  const next = [...list];
  [next[from], next[to]] = [next[to], next[from]];
  return next;
}

/** What is sent to save_firm_workflow: trimmed, empty items dropped, days clamped. */
export function cleanStages(stages: readonly WorkflowStageInput[]): WorkflowStageInput[] {
  return stages.map((stage) => ({
    name: stage.name.trim(),
    items: stage.items
      .filter((item) => item.title.trim())
      .map((item) => ({
        kind: item.kind === "document" ? "document" : "step",
        title: item.title.trim(),
        detail: item.detail.trim(),
        owner: item.owner === "client" ? "client" : "staff",
        due_offset_days: item.due_offset_days == null || !Number.isFinite(item.due_offset_days) ? null : Math.max(0, Math.min(365, Math.round(item.due_offset_days))),
      })),
  }));
}

/** A problem the person can fix before saving, or null. The database checks the same rules. */
export function workflowProblem(name: string, stages: readonly WorkflowStageInput[]): string | null {
  if (!name.trim()) return "Give the workflow a name.";
  if (name.trim().length > 160) return "Keep the name to 160 characters.";
  if (stages.length === 0) return "Add at least one stage.";
  if (stages.length > MAX_STAGES) return `A workflow has at most ${MAX_STAGES} stages.`;
  const unnamed = stages.findIndex((stage) => !stage.name.trim());
  if (unnamed >= 0) return `Name stage ${unnamed + 1}.`;
  const full = stages.findIndex((stage) => stage.items.length > MAX_ITEMS_PER_STAGE);
  if (full >= 0) return `Stage ${full + 1} has more than ${MAX_ITEMS_PER_STAGE} items.`;
  return null;
}

/** A database refusal in words for the person (never the raw SQL error). */
export function workflowError(message: string): string {
  if (/someone else changed/i.test(message)) return "Someone else changed this workflow. Reload to see their version.";
  if (/restore the workflow/i.test(message)) return "Restore the workflow before editing it.";
  if (/not published/i.test(message)) return "That shared template isn’t published.";
  if (/workflow denied|permission|role|not allowed|required/i.test(message)) return "Only a firm owner or a licensed consultant can change workflows.";
  if (/aal2|mfa|two-factor/i.test(message)) return "Sign in again with two-step verification.";
  const plain = message.match(/^(give the workflow|a workflow|stage \d+|that program|the description)[^\n]*/i);
  if (plain) return plain[0][0].toUpperCase() + plain[0].slice(1).replace(/\.?$/, ".");
  return "The workflow wasn’t saved. Try again.";
}

export function workflowCounts(stages: readonly WorkflowStageInput[]): { stages: number; steps: number; documents: number } {
  let steps = 0;
  let documents = 0;
  for (const stage of stages) for (const item of stage.items) if (item.kind === "document") documents++; else steps++;
  return { stages: stages.length, steps, documents };
}

function plural(n: number, one: string, many: string) {
  return `${n} ${n === 1 ? one : many}`;
}

export function workflowSummary(workflow: Pick<WorkflowView, "stages">): string {
  const counts = workflowCounts(workflow.stages);
  return [plural(counts.stages, "stage", "stages"), plural(counts.steps, "step", "steps"), plural(counts.documents, "document request", "document requests")].join(" · ");
}

export function workflowProgram(key: string | null, programs: readonly { value: string; label: string }[]): string {
  if (!key) return "Any program";
  return programs.find((option) => option.value === key)?.label ?? programLabel(key);
}

type Row = Record<string, unknown>;
const text = (value: unknown) => (typeof value === "string" ? value : "");

/** Builds the firm's workflows from the three table reads (RLS: staff of the firm). */
export function assembleWorkflows(
  workflows: readonly Row[],
  stages: readonly Row[],
  items: readonly Row[],
  sharedTitles: ReadonlyMap<string, { title: string; versionNumbers: ReadonlyMap<string, number> }>,
): WorkflowView[] {
  const itemsOf = new Map<string, Row[]>();
  for (const item of items) {
    const list = itemsOf.get(text(item.stage_id)) ?? [];
    list.push(item);
    itemsOf.set(text(item.stage_id), list);
  }
  const stagesOf = new Map<string, Row[]>();
  for (const stage of stages) {
    const list = stagesOf.get(text(stage.workflow_id)) ?? [];
    list.push(stage);
    stagesOf.set(text(stage.workflow_id), list);
  }
  const byPosition = (a: Row, b: Row) => Number(a.position) - Number(b.position);
  return workflows.map((row) => {
    const templateId = text(row.source_template_id);
    const shared = templateId ? sharedTitles.get(templateId) : undefined;
    return {
      id: text(row.id),
      name: text(row.name),
      programKey: text(row.program_key) || null,
      description: text(row.description),
      status: row.status === "archived" ? "archived" : "active",
      rowVersion: Number(row.version) || 1,
      updatedAt: text(row.updated_at),
      copiedFrom: templateId
        ? { templateId, title: shared?.title ?? "a Casevoya shared template", versionNumber: shared?.versionNumbers.get(text(row.source_version_id)) ?? null }
        : null,
      stages: [...(stagesOf.get(text(row.id)) ?? [])].sort(byPosition).map((stage) => ({
        name: text(stage.name),
        items: [...(itemsOf.get(text(stage.id)) ?? [])].sort(byPosition).map((item) => ({
          kind: item.kind === "document" ? "document" : "step",
          title: text(item.title),
          detail: text(item.detail),
          owner: item.owner === "client" ? "client" : "staff",
          due_offset_days: typeof item.due_offset_days === "number" ? item.due_offset_days : null,
        })),
      })),
    };
  });
}
