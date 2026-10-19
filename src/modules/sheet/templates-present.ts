/**
 * Pure helpers for the Sheet's Templates page: program packs and the firm's agreement templates,
 * the approved email catalog, and the rule register, in the Designer's words. Nothing here states
 * an immigration rule: rows show only what a reviewer recorded (RULES.md); missing values stay "—".
 */
import type { MessageRow, ProgramRow, RuleDetail, SourceKpi, SourceRow, TemplatesData, TemplatesTab } from "@/components/sheet/designer/templates";
import type { MatterBadge } from "@/components/sheet/designer/matters";
import { dayMonth } from "@/modules/sheet/home-present";
import { longDate } from "@/modules/sheet/matter-present";
import { isoDateInTimeZone } from "@/modules/sheet/present";
import { chooseEmailLanguage } from "@/modules/email/designs/french";
import { designFor } from "@/modules/email/templates";

export type PackRow = { id: string; programKey: string; jurisdiction: string; packVersion: number; status: string; firm: boolean; nextReviewAt: string | null };
export type AgreementTemplateRow = { id: string; name: string; kind: string; status: string; approvedAt: string | null; approvedBy: string | null; version: number };
export type CatalogRow = {
  name: string;
  audience: string;
  status: "wired" | "ready-not-wired" | "deferred";
  /** The design id ("EM02"); live only. */
  id?: string;
  /** Its French text is approved by a named reviewer (fr-drafts.json). */
  frenchApproved?: boolean;
};
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
  // An agreement template has no jurisdiction of its own: its kind goes with its name, and
  // "Matters pinned" counts the distinct matters that used it (not the agreements).
  const agreementRows: ProgramRow[] = agreements.map((template) => ({
    template: `${template.name} (${KIND[template.kind] ?? template.kind})`,
    jurisdiction: DASH,
    // Opens the Agreements page's template dialog, where firm templates are reviewed and approved.
    href: "/sheet/agreements?dlg=template",
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

/** What the firm's own email deliveries say about one design: how many went out, when, in which languages. */
export type DesignUse = { sent: number; lastSentAt: string | null; french: number };

/** Sent deliveries per approved design (the same choice the dispatcher makes): count, latest, French. */
export function designUse(rows: readonly { template: string; context: unknown; updated_at: string }[]): Map<string, DesignUse> {
  const use = new Map<string, DesignUse>();
  for (const row of rows) {
    const context = row.context && typeof row.context === "object" && !Array.isArray(row.context) ? (row.context as Record<string, unknown>) : {};
    const design = designFor({ ...context, template: row.template });
    if (design === "generic") continue;
    const entry = use.get(design) ?? { sent: 0, lastSentAt: null, french: 0 };
    entry.sent += 1;
    if (!entry.lastSentAt || row.updated_at > entry.lastSentAt) entry.lastSentAt = row.updated_at;
    if (design !== "EX15" && chooseEmailLanguage(design, context.locale) === "fr") entry.french += 1;
    use.set(design, entry);
  }
  return use;
}

/**
 * The Message templates tab from real data: State says whether this firm ever sent the email (and
 * when last), or that it is approved but not sent yet / not wired / deferred; Languages says
 * whether French went out, is approved, or isn't approved yet. Each row previews the design with
 * synthetic sample values.
 */
export function messageRows(catalog: readonly CatalogRow[], use: ReadonlyMap<string, DesignUse> = new Map(), timeZone = "America/Toronto"): MessageRow[] {
  return catalog.map((row) => {
    const used = row.id ? use.get(row.id) : undefined;
    const sent = used?.sent ?? 0;
    const languages: MessageRow["languages"] = used?.french
      ? { left: "English", right: "French sent" }
      : row.frenchApproved
        ? { left: "English", right: "French approved" }
        : { left: "English", right: "French not approved yet" };
    const state: MatterBadge =
      sent > 0
        ? { tone: "ok", label: `Sent ${sent} time${sent === 1 ? "" : "s"}`, ...(used?.lastSentAt ? { detail: `last ${dayMonth(isoDateInTimeZone(new Date(used.lastSentAt), timeZone))}` } : {}) }
        : row.status === "wired"
          ? { tone: "rev", label: "Approved, not sent yet" }
          : row.status === "ready-not-wired"
            ? { tone: "gr", label: "Approved, not in use yet" }
            : { tone: "gr", label: "Deferred" };
    return {
      template: row.name,
      channel: "Email",
      usedBy: AUDIENCE[row.audience] ?? row.audience,
      languages,
      state,
      ...(row.id ? { href: `/api/email-designs/preview?id=${encodeURIComponent(row.id)}` } : {}),
    };
  });
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
    newTemplateLabel: "New agreement template",
    program: { rows: input.program, note: "Firm templates are labelled so you can tell them apart from centrally reviewed content." },
    messages: { rows: input.messages },
    checklists: { cards: [] },
    sources: { kpis: sourceKpis(input.rules, input.packs, input.today), rows: sourceRows(input.rules, input.today) },
    rule: ruleDetail(input.selected),
  };
}
