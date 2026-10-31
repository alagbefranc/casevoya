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
import type { AddClaimData, ClaimReviewData } from "@/components/sheet/designer/source-claims";
import { awaitingReview, captureLine, claimDates, claimExpired, claimStatus, resolutionLabel, UNKNOWN, type ClaimFacts } from "@/modules/sheet/source-claims-present";

export type PackRow = {
  id: string;
  programKey: string;
  jurisdiction: string;
  packVersion: number;
  status: string;
  firm: boolean;
  nextReviewAt: string | null;
  reviewerName?: string | null;
  reviewerLicence?: string | null;
  sourceOwnerName?: string | null;
  effectiveFrom?: string | null;
};
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
  /** Live (SRC-01/02/03): the claim's evidence, dates, applicability and review state. */
  facts?: ClaimFacts & { version: number; value: string | null };
};

/** Who is looking (live): what the review panel offers them. */
export type ClaimViewer = { organizationId: string; role: string; today: string; timeZone: string; now: Date };

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
    source: pack.sourceOwnerName
      ? { left: pack.firm ? "Firm template" : "Casevoya central", right: `Source owner ${pack.sourceOwnerName}` }
      : pack.firm ? "Firm template" : "Casevoya central",
    reviewer: pack.reviewerName ? `${pack.reviewerName}${pack.reviewerLicence ? `, ${pack.reviewerLicence}` : ""}` : DASH,
    effective: pack.effectiveFrom ? longDate(pack.effectiveFrom.slice(0, 10)) : DASH,
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

export type FirmMessageTemplateRow = { id: string; useFor: string; name: string; status: string; approvedAt: string | null; approvedBy: string | null };

/**
 * OPS-04: the firm's own message and announcement templates, as Message templates rows above the
 * email catalog. Each opens its edit dialog (?view=). Written in English only.
 */
export function firmMessageRows(rows: readonly FirmMessageTemplateRow[], timeZone = "America/Toronto"): MessageRow[] {
  return rows.map((row) => ({
    template: row.name,
    channel: row.useFor === "announcement" ? { left: "Announcement", right: "portal and email notice" } : "Portal message",
    usedBy: row.useFor === "announcement" ? "Firm owner or licensed consultant" : "Staff composer",
    languages: "English",
    state:
      row.status === "approved"
        ? {
            tone: "ok",
            label: "Approved",
            ...(row.approvedAt ? { detail: `${row.approvedBy ? `${row.approvedBy}, ` : ""}${dayMonth(isoDateInTimeZone(new Date(row.approvedAt), timeZone))}` } : {}),
          }
        : { tone: "rev", label: "Draft, needs approval" },
    href: `/sheet/templates?tab=messages&view=${row.id}`,
  }));
}

const NEEDS_REVIEW = new Set(["review_due", "evidence_captured", "professional_review", "draft"]);

function day(iso: string | null): string {
  return iso ? longDate(iso.slice(0, 10)) : DASH;
}

export function sourceRows(rules: readonly RuleRow[], today: string, now: Date = new Date(`${today}T12:00:00Z`)): SourceRow[] {
  return rules.map((rule) => {
    const next = rule.nextReviewAt ? rule.nextReviewAt.slice(0, 10) : null;
    return {
      rule: `${rule.stableKey} (v${rule.versionNumber})`,
      href: `?tab=rule&view=${rule.id}`,
      jurisdiction: rule.programKey ? { left: rule.jurisdiction, right: rule.programKey } : rule.jurisdiction,
      state: rule.facts ? claimStatus(rule.facts, now) : statusBadge(rule.status),
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

export function ruleDetail(rule: RuleRow | null, viewer: ClaimViewer | null = null): RuleDetail | null {
  if (!rule) return null;
  const facts = rule.facts;
  const effective = rule.effectiveFrom ? longDate(rule.effectiveFrom.slice(0, 10)) : facts ? UNKNOWN : "date not recorded";
  const base: RuleDetail = {
    title: { left: rule.stableKey, right: `v${rule.versionNumber}` },
    summary: `${facts && viewer ? claimStatus(facts, viewer.now).label : statusBadge(rule.status).label}. ${rule.programKey ? `${rule.jurisdiction}, ${rule.programKey}` : rule.jurisdiction}. Effective ${effective}.`,
    claim: rule.claim ?? "No claim recorded yet.",
    note: rule.applicabilityNote ? `Applicability note: ${rule.applicabilityNote}` : null,
    diff: null,
    tests: null,
    source:
      rule.source && !facts
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
  if (!facts || !viewer) return base;
  const timeZone = viewer.timeZone;
  base.evidence = facts.evidence.map((item) => ({
    publisher: item.snapshot?.publisher ?? (item.sourceUrl && /justice\.gc\.ca/.test(item.sourceUrl) ? "Justice Laws" : "Government of Canada"),
    url: item.sourceUrl ?? item.snapshot?.finalUrl ?? "",
    section: item.section ?? DASH,
    excerpt: item.excerpt,
    form: item.formNumber ? `${item.formNumber}, date modified ${item.formModifiedOn ? longDate(item.formModifiedOn) : UNKNOWN}` : null,
    capture: captureLine(item),
    captured: Boolean(item.snapshot),
    dates: claimDates(item, facts, timeZone),
  }));
  base.review = claimReview(rule, facts, viewer);
  return base;
}

const LICENSED = new Set(["firm_owner", "licensed_consultant"]);

/** SRC-03: the review panel: status, reason, applicability, and the steps this viewer can take. */
export function claimReview(rule: RuleRow, claim: NonNullable<RuleRow["facts"]>, viewer: ClaimViewer): ClaimReviewData {
  const licensed = LICENSED.has(viewer.role);
  const waiting = rule.status === "draft" || rule.status === "evidence_captured" || rule.status === "professional_review";
  const resolved = claim.resolution === "applies" || claim.resolution === "partly";
  const label = resolutionLabel(claim.resolution);
  const next = new Date(`${viewer.today}T12:00:00Z`);
  next.setUTCDate(next.getUTCDate() + 90);
  return {
    organizationId: viewer.organizationId,
    id: rule.id,
    version: claim.version,
    status: claimStatus(claim, viewer.now),
    reason: claim.statusReason,
    value: claim.value,
    applicability: label ? `${label}${claim.applicabilityNote ? `. ${claim.applicabilityNote}` : ""}` : "Not resolved yet. A licensed reviewer resolves it before approval.",
    licensed,
    canResolve: licensed && waiting,
    canApprove: licensed && waiting && resolved && !claimExpired({ status: "published", effectiveTo: claim.effectiveTo }, viewer.now) && claim.evidence.length > 0,
    canReject: licensed && waiting,
    canSuspend: licensed && (rule.status === "published" || rule.status === "review_due"),
    // Decision 7 (2026-10-25): a suspended claim stays suspended until a licensed member unsuspends it.
    canUnsuspend: licensed && rule.status === "suspended",
    needsAttestation: claim.evidence.some((item) => !item.snapshot),
    today: viewer.today,
    nextReviewDefault: next.toISOString().slice(0, 10),
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
  /** Live (SRC-01/03): who is looking, and the Add claim dialog. */
  viewer?: ClaimViewer;
  addClaim?: AddClaimData;
}): TemplatesData {
  const review = input.rules.filter((rule) => NEEDS_REVIEW.has(rule.status)).length;
  // The workbench queue: versions waiting for a reviewer first, then the rest, each newest first.
  const rules = input.viewer ? [...input.rules].sort((a, b) => Number(awaitingReview(b.status)) - Number(awaitingReview(a.status))) : input.rules;
  return {
    tab: input.tab,
    pills: [review === 1 ? "1 source needs review" : `${review} sources need review`],
    reviewCount: review,
    newTemplateHref: "/sheet/agreements?dlg=template",
    newTemplateLabel: input.tab === "messages" ? "New message template" : input.tab === "workflows" ? "New workflow" : "New agreement template",
    ...(input.tab === "messages" ? { newTemplateDialog: "dlgMt" } : input.tab === "workflows" ? { newTemplateDialog: "dlgWf" } : {}),
    program: { rows: input.program, note: "Firm templates are labelled so you can tell them apart from centrally reviewed content." },
    messages: { rows: input.messages },
    checklists: { cards: [] },
    sources: {
      kpis: sourceKpis(input.rules, input.packs, input.today),
      rows: sourceRows(rules, input.today, input.viewer?.now),
      ...(input.addClaim ? { addClaim: input.addClaim } : {}),
    },
    rule: ruleDetail(input.selected, input.viewer ?? null),
  };
}
