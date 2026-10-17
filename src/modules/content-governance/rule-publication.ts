import { z } from "zod";
import { officialUrlIsAllowlisted } from "./official-domains";

const HOMEPAGE_SECTIONS = new Set(["/", "home", "homepage", "index"]);

export const rulePublicationSchema = z.object({
  rule_id: z.string().regex(/^[A-Z][A-Z0-9]*(\.[A-Z][A-Z0-9_]*)+$/),
  version: z.number().int().positive(),
  classification: z.enum([
    "immigration_requirement",
    "professional_obligation",
    "privacy_requirement",
    "product_control",
  ]),
  jurisdiction: z.string().regex(/^[A-Z]{2}(-[A-Z0-9]{1,6})?$/),
  program_key: z.string().nullable(),
  applicant_context: z.string().nullable(),
  claim: z.string().nullable(),
  source_id: z.string().nullable(),
  source_url: z.string().nullable(),
  source_title: z.string().nullable(),
  source_section: z.string().nullable(),
  source_publisher: z.string().nullable(),
  source_language: z.enum(["en", "fr"]).nullable(),
  source_published_at: z.string().nullable(),
  source_modified_at: z.string().nullable(),
  source_current_to: z.string().nullable(),
  effective_from: z.string().nullable(),
  effective_to: z.string().nullable(),
  retrieved_at: z.string().nullable(),
  content_hash: z.string().nullable(),
  evidence_excerpt_or_locator: z.string().nullable(),
  interpretation_notes: z.string().nullable(),
  status: z.enum([
    "draft",
    "evidence_captured",
    "professional_review",
    "approved",
    "published",
    "review_due",
    "suspended",
    "superseded",
    "rejected",
  ]),
  reviewed_by: z.string().nullable(),
  reviewed_at: z.string().nullable(),
  next_review_at: z.string().nullable(),
  supersedes_version: z.number().int().positive().nullable(),
  test_case_ids: z.array(z.string()),
  applicability_established: z.boolean().optional().default(false),
  applicability_note: z.string().nullable().optional().default(null),
});

export type RulePublicationInput = z.input<typeof rulePublicationSchema>;
export type RulePublicationRecord = z.output<typeof rulePublicationSchema>;

/**
 * RULES.md §5 sample. It is intentionally incomplete and must fail publication.
 * Nulls are preserved; this object is not a real immigration rule.
 */
export const RULES_SECTION_5_SAMPLE = {
  rule_id: "CA.EXAMPLE.DOCUMENT_REQUIREMENT",
  version: 1,
  classification: "immigration_requirement",
  jurisdiction: "CA",
  program_key: null,
  applicant_context: null,
  claim: null,
  source_id: null,
  source_url: null,
  source_title: null,
  source_section: null,
  source_publisher: null,
  source_language: null,
  source_published_at: null,
  source_modified_at: null,
  source_current_to: null,
  effective_from: null,
  effective_to: null,
  retrieved_at: null,
  content_hash: null,
  evidence_excerpt_or_locator: null,
  interpretation_notes: null,
  status: "draft",
  reviewed_by: null,
  reviewed_at: null,
  next_review_at: null,
  supersedes_version: null,
  test_case_ids: [],
} as const satisfies RulePublicationInput;

function blank(value: string | null | undefined): boolean {
  return value == null || value.trim().length === 0;
}

function push(blockers: string[], code: string) {
  if (!blockers.includes(code)) blockers.push(code);
}

/**
 * Metadata gate for publishing one rule version.
 * A passing result is not a licensed review and not proof the page was fetched.
 * Unknown dates stay unknown: this function never fills them.
 */
export function publicationBlockers(input: RulePublicationInput): string[] {
  const rule = rulePublicationSchema.parse(input);
  const blockers: string[] = [];

  if (blank(rule.claim)) push(blockers, "missing_claim");
  if (rule.next_review_at == null) push(blockers, "missing_next_review_at");
  if (rule.test_case_ids.length === 0) push(blockers, "missing_test_cases");
  if (rule.effective_from == null && !rule.applicability_established) {
    push(blockers, "missing_effective_applicability");
  }
  if (rule.applicability_established && blank(rule.applicability_note)) {
    push(blockers, "missing_applicability_note");
  }

  if (blank(rule.source_url)) {
    push(blockers, "missing_source_url");
    push(blockers, "missing_evidence");
  } else if (!officialUrlIsAllowlisted(rule.source_url)) {
    push(blockers, "source_url_not_allowlisted");
  }

  if (
    blank(rule.source_section) ||
    HOMEPAGE_SECTIONS.has(rule.source_section!.trim().toLowerCase())
  ) {
    push(blockers, "missing_source_section");
  }
  if (blank(rule.source_publisher)) push(blockers, "missing_publisher");
  if (rule.content_hash == null || !/^[0-9a-f]{64}$/.test(rule.content_hash)) {
    push(blockers, "missing_content_hash");
  }
  if (rule.retrieved_at == null) push(blockers, "missing_retrieved_at");
  if (blank(rule.reviewed_by)) push(blockers, "missing_reviewer");
  if (rule.reviewed_at == null) push(blockers, "missing_reviewed_at");

  if (
    rule.effective_from != null &&
    rule.retrieved_at != null &&
    rule.effective_from === rule.retrieved_at &&
    rule.source_published_at == null &&
    rule.source_current_to == null &&
    !rule.applicability_established
  ) {
    push(blockers, "effective_from_copies_retrieved_at");
  }

  return blockers;
}

export class RulePublicationError extends Error {
  readonly blockers: string[];

  constructor(blockers: string[]) {
    super(`publication blocked: ${blockers.join(", ")}`);
    this.name = "RulePublicationError";
    this.blockers = blockers;
  }
}

export function assertPublishable(input: RulePublicationInput): RulePublicationRecord {
  const blockers = publicationBlockers(input);
  if (blockers.length > 0) throw new RulePublicationError(blockers);
  return rulePublicationSchema.parse(input);
}
