/**
 * Pure helpers for the Sheet's Templates page: program packs and the firm's agreement templates,
 * the approved email catalog, and the rule register, in the Designer's words. Nothing here states
 * an immigration rule: rows show only what a reviewer recorded (RULES.md); missing values stay "—".
 */
import type { MessageRow, ProgramRow, RuleDetail, SourceKpi, SourceRow, TemplatesData, TemplatesTab } from "@/components/sheet/designer/templates";
import type { MatterBadge } from "@/components/sheet/designer/matters";
import { dayMonth } from "@/modules/sheet/home-present";
import { longDate } from "@/modules/sheet/matter-present";

export type PackRow = { id: string; programKey: string; jurisdiction: string; packVersion: number; status: string; firm: boolean; nextReviewAt: string | null };
export type AgreementTemplateRow = { id: string; name: string; kind: string; status: string; approvedAt: string | null; approvedBy: string | null; version: number };
export type CatalogRow = { name: string; audience: string; status: "wired" | "ready-not-wired" | "deferred" };
export type RuleRow = {
  id: string;
  stableKey: string;
  versionNumber: number;
  jurisdiction: string;
  programKey: string | null;
  status: string;
  effectiveFrom: string | null;
  nextReviewAt: string | null;
  claim: string | null;
  applicabilityNote: string | null;
  reviewer: string | null;
  lastChecked: string | null;
  affected: number;
  source: { publisher: string; url: string; title: string | null; retrievedAt: string; section: string | null } | null;
};

const DASH = "—";

const STATUS: Record<string, MatterBadge> = {
  draft: { tone: "gr", label: "Draft" },
  evidence_captured: { tone: "rev", label: "Evidence captured" },
  professional_review: { tone: "rev", label: "Requested review" },
  approved: { tone: "blue", label: "Approved" },
  published: { tone: "ok", label: "Published" },
  review_due: { tone: "chg", label: "Review required" },
  suspended: { tone: "gr", label: "Suspended" },
  superseded: { tone: "gr", label: "Superseded" },
  rejected: { tone: "bad", label: "Rejected" },
};

export function statusBadge(status: string): MatterBadge {
  return STATUS[status] ?? { tone: "gr", label: status };
}

const KIND: Record<string, string> = {
  quote: "Quote",
  consultation: "Consultation agreement",
  service: "Service agreement",
  amendment: "Amendment",
  consent: "Consent",
};

export function programRows(packs: readonly PackRow[], pinned: ReadonlyMap<string, number>, agreements: readonly AgreementTemplateRow[], usage: ReadonlyMap<string, number>): ProgramRow[] {
  const packRows: ProgramRow[] = packs.map((pack) => ({
    template: pack.programKey,
    jurisdiction: pack.jurisdiction,
    version: `v${pack.packVersion}`,
    state: statusBadge(pack.status),
    source: pack.firm ? "Firm template" : "Casevoya central",
    reviewer: DASH,
    effective: DASH,
    pinned: String(pinned.get(pack.id) ?? 0),
  }));
  const agreementRows: ProgramRow[] = agreements.map((template) => ({
    template: template.name,
    jurisdiction: { left: "Firm", right: KIND[template.kind] ?? template.kind },
    version: `v${template.version}`,
    state: template.status === "approved" ? { tone: "ok", label: "Approved" } : { tone: "gr", label: "Draft" },
    source: "Firm template",
    reviewer: template.approvedBy ?? (template.status === "approved" ? DASH : "Waiting"),
    effective: template.approvedAt ? longDate(template.approvedAt.slice(0, 10)) : DASH,
    pinned: String(usage.get(template.id) ?? 0),
  }));
  return [...packRows, ...agreementRows];
}

const AUDIENCE: Record<string, string> = { staff: "Staff", "firm owner": "Firm owner", client: "Clients", "adult dependant": "Adult dependants" };

export function messageRows(catalog: readonly CatalogRow[]): MessageRow[] {
  return catalog.map((row) => ({
    template: row.name,
    channel: "Email",
    usedBy: AUDIENCE[row.audience] ?? row.audience,
    languages: { left: "English", right: "French deferred" },
    state:
      row.status === "wired"
        ? { tone: "ok", label: "Approved, in use" }
        : row.status === "ready-not-wired"
          ? { tone: "rev", label: "Approved, not sent yet" }
          : { tone: "gr", label: "Deferred" },
  }));
}

const NEEDS_REVIEW = new Set(["review_due", "evidence_captured", "professional_review", "draft"]);

function day(iso: string | null): string {
  return iso ? longDate(iso.slice(0, 10)) : DASH;
}

export function sourceRows(rules: readonly RuleRow[], today: string): SourceRow[] {
  return rules.map((rule) => {
    const next = rule.nextReviewAt ? rule.nextReviewAt.slice(0, 10) : null;
    return {
      rule: `${rule.stableKey} (v${rule.versionNumber})`,
      href: `?tab=rule&view=${rule.id}`,
      jurisdiction: rule.programKey ? { left: rule.jurisdiction, right: rule.programKey } : rule.jurisdiction,
      state: statusBadge(rule.status),
      effective: day(rule.effectiveFrom),
      reviewer: rule.reviewer ?? DASH,
      lastChecked: day(rule.lastChecked),
      nextReview: next ? (next < today ? { num: { left: "Overdue", right: dayMonth(next) } } : longDate(next)) : DASH,
      affected: `${rule.affected} matter${rule.affected === 1 ? "" : "s"}`,
    };
  });
}

export function sourceKpis(rules: readonly RuleRow[], packs: number, today: string): SourceKpi[] {
  const review = rules.filter((rule) => NEEDS_REVIEW.has(rule.status));
  const overdue = rules.filter((rule) => rule.nextReviewAt && rule.nextReviewAt.slice(0, 10) < today).length;
  const published = rules.filter((rule) => rule.status === "published").length;
  const upcoming = rules
    .filter((rule) => rule.nextReviewAt && rule.nextReviewAt.slice(0, 10) >= today)
    .sort((a, b) => (a.nextReviewAt ?? "").localeCompare(b.nextReviewAt ?? ""))[0];
  const affected = review.reduce((sum, rule) => sum + rule.affected, 0);
  return [
    { label: "Review required", value: String(review.length), count: review.length, note: `${overdue} overdue`, warn: review.length > 0, href: "?tab=sources" },
    { label: "Published rules", value: String(published), count: published, note: `in ${packs} template${packs === 1 ? "" : "s"}`, href: "?tab=sources" },
    upcoming?.nextReviewAt
      ? { label: "Next scheduled check", value: dayMonth(upcoming.nextReviewAt.slice(0, 10)), note: upcoming.stableKey, href: `?tab=rule&view=${upcoming.id}` }
      : { label: "Next scheduled check", value: DASH, note: "Nothing scheduled", href: "?tab=sources" },
    { label: "Affected matters", value: String(affected), count: affected, note: `by the ${review.length} open review${review.length === 1 ? "" : "s"}`, href: "?tab=sources" },
  ];
}

export function ruleDetail(rule: RuleRow | null): RuleDetail | null {
  if (!rule) return null;
  return {
    title: { left: rule.stableKey, right: `v${rule.versionNumber}` },
    summary: `${statusBadge(rule.status).label}. ${rule.programKey ? `${rule.jurisdiction}, ${rule.programKey}` : rule.jurisdiction}. Effective ${rule.effectiveFrom ? longDate(rule.effectiveFrom.slice(0, 10)) : "date not recorded"}.`,
    claim: rule.claim ?? "No claim recorded yet.",
    note: rule.applicabilityNote ? `Applicability note: ${rule.applicabilityNote}` : null,
    diff: null,
    tests: null,
    source: rule.source
      ? {
          publisher: rule.source.publisher,
          url: rule.source.url,
          linkText: rule.source.title ?? rule.source.url,
          appliesTo: rule.source.section ?? DASH,
          version: `Page as captured ${longDate(rule.source.retrievedAt.slice(0, 10))}`,
          checked: longDate((rule.lastChecked ?? rule.source.retrievedAt).slice(0, 10)),
          reviewer: rule.reviewer ?? "Not reviewed yet",
          state: rule.status === "published" ? { tone: "ok", label: "Checked" } : { tone: "unv", label: "Not yet checked" },
        }
      : null,
    actions: null,
  };
}

export function templatesData(input: {
  tab: TemplatesTab;
  program: ProgramRow[];
  messages: MessageRow[];
  rules: readonly RuleRow[];
  packs: number;
  selected: RuleRow | null;
  today: string;
}): TemplatesData {
  const review = input.rules.filter((rule) => NEEDS_REVIEW.has(rule.status)).length;
  return {
    tab: input.tab,
    pills: [review === 1 ? "1 source needs review" : `${review} sources need review`],
    reviewCount: review,
    newTemplateHref: "/sheet/agreements?dlg=template",
    program: { rows: input.program, note: "Firm templates are labelled so you can tell them apart from centrally reviewed content." },
    messages: { rows: input.messages },
    checklists: { cards: [] },
    sources: { kpis: sourceKpis(input.rules, input.packs, input.today), rows: sourceRows(input.rules, input.today) },
    rule: ruleDetail(input.selected),
  };
}
