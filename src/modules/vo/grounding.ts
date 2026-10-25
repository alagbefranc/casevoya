/**
 * Grounded Vo outputs (PRD SRC-09, AI-01, AI-03, AI-05; RULES.md). Pure, shared by the app and the
 * Vo agent service (services/vo-agent).
 *
 * - Every record, approved fact and piece of approved official content a tool hands Vo carries a
 *   marker: [R1] for a record of the matter (the matter, a task, a deadline, a document request, a
 *   message, a document version), [F1] for an approved fact (a reviewed intake answer), [S1] for
 *   approved official content (a published rule version or a register row a licensed member
 *   approved, from a deep canada.ca / gc.ca page). The run's markers are its ALLOWED SET.
 * - guardGroundedAnswer keeps only sentences that cite something in the allowed set. A marker the
 *   run never handed out is dropped (and counted); a sentence with no valid marker is left out; a
 *   money amount or a program requirement needs an [S#]. If nothing is left, Vo abstains: "Vo can't
 *   answer this from the file or approved sources." The database checks the citations again
 *   (public.finish_vo_run) and refuses anything outside the run's matter or approved sources.
 * - isCitableOfficialUrl and adviceLike mirror the database's app.vo_citable_official_url and
 *   app.vo_advice_like, so the page and the service can decide early; the database decides.
 */
import { clean, MONEY, REMOVED } from "./letter-guard";
import { NEEDS_CONSULTANT, NEEDS_RULE } from "./prompt";
import type { VoAbstainReason, VoSourceRef } from "./sign";

export const VO_CANT_ANSWER = "Vo can’t answer this from the file or approved sources.";

/** The longest Ask Vo answer kept on screen. */
export const MAX_ANSWER_CHARS = 4000;

/** The marker prefix for a citation kind: approved facts F, approved official content S, records R. */
export function markerPrefix(kind: VoSourceRef["kind"]): "R" | "F" | "S" {
  return kind === "fact" ? "F" : kind === "official" ? "S" : "R";
}

const MARKER = /\[([RFS])(\d{1,3})\]/g;

/**
 * A program rule in an answer: a fee or amount, eligibility, admissibility, a processing time, the
 * Act or Regulations. It needs approved official content ([S#]). The matter's own deadlines and
 * requested documents are records ([R#]) and don't.
 */
const REGULATED =
  /(?:\b(?:fees?|frais|processing\s+times?|IRPA|IRPR|LIPR|RIPR|subsection|paragraph\s+\d+|regulations?)\b|\b(?:in)?(?:eligib|admissib)|(?:^|[^\p{L}])(?:délais?\s+de\s+traitement|éligib|règlements?(?![\p{L}])))/iu;

/** Federal official hosts on public.official_source_domains (canada.ca, and the gc.ca hosts listed there). */
const FEDERAL_SUFFIXES = ["canada.ca", "cic.gc.ca", "justice.gc.ca", "priv.gc.ca", "irb-cisr.gc.ca"];

/** Site roots and landing pages: never evidence of a rule, fee or date. */
const LANDING = new Set([
  "en",
  "fr",
  "eng",
  "fra",
  "english",
  "francais",
  "index.html",
  "index.htm",
  "index.asp",
  "default.asp",
  "en.html",
  "fr.html",
  "en/index.html",
  "fr/index.html",
  "eng/index.html",
  "fra/index.html",
  "english/index.asp",
  "francais/index.asp",
  "en/immigration-refugees-citizenship.html",
  "fr/immigration-refugies-citoyennete.html",
  "eng/acts",
  "fra/lois",
  "eng/regulations",
  "fra/reglements",
]);

/** Language folders and index pages, which never make a page deep (as in app.official_claim_url). */
const LANGUAGE_OR_INDEX = /^(en|fr|eng|fra|english|francais|index|home|default|accueil|welcome)$/;

/** A deep page on a federal official host (the database's app.vo_citable_official_url decides). */
export function isCitableOfficialUrl(value: unknown): boolean {
  if (typeof value !== "string") return false;
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    return false;
  }
  if (url.protocol !== "https:" || url.username || url.password || url.port) return false;
  const host = url.hostname.toLowerCase().replace(/\.$/, "");
  if (!FEDERAL_SUFFIXES.some((suffix) => host === suffix || host.endsWith(`.${suffix}`))) return false;
  const page = url.pathname.replace(/^\/+|\/+$/g, "").toLowerCase();
  if (page === "" || LANDING.has(page)) return false;
  // SRC-01 homepage rule (app.official_claim_url, claimUrlProblem): at least two path segments
  // besides language folders and index pages.
  const meaningful = page
    .split("/")
    .map((part) => part.replace(/\.(html?|aspx?|php)$/, ""))
    .filter((part) => part !== "" && !LANGUAGE_OR_INDEX.test(part));
  return meaningful.length >= 2;
}

const ADVICE =
  /(?:(?:\$|\bCAD\b|\bUSD\b)\s?\d|\d\s?(?:\$|\bCAD\b|\bdollars?\b)|\bfees?\b|\bfrais\b|\b(?:in)?eligib|\b(?:in)?admissib|(?:^|[^\p{L}])éligib|\bqualif|\brequirements?\b|\brequired\b|\bexigences?\b|\bprocessing\s+times?\b|(?:^|[^\p{L}])délais?\s+de\s+traitement|\bIRPA\b|\bIRPR\b|\bLIPR\b|\bRIPR\b|\bregulations?\b|(?:^|[^\p{L}])règlements?(?![\p{L}])|\byou\s+should\b|\bwe\s+(?:recommend|advise)|\bI\s+(?:recommend|advise)|\bvous\s+devriez\b|\bnous\s+(?:recommandons|conseillons)|\bchances?\b|\bguarantee|\bgaranties?\b)/iu;

/**
 * Advice-like text (fees and amounts, eligibility, admissibility, requirements, processing times,
 * the Act or Regulations, recommendations, chances, guarantees): a Vo draft like this is sent only
 * by a licensed member (public.send_vo_draft uses app.vo_advice_like, the same test).
 */
export function adviceLike(text: string): boolean {
  return ADVICE.test(text);
}

/** Where a citation opens: the matter tab that holds the record, or the official page itself. */
export function citationHref(ref: Pick<VoSourceRef, "kind" | "url">, at: { matterId: string; threadId?: string | null }): string | null {
  if (ref.kind === "official") return isCitableOfficialUrl(ref.url) ? new URL(String(ref.url).trim()).toString() : null;
  if (!/^[0-9a-f-]{36}$/i.test(at.matterId)) return null;
  const base = `/sheet/matters/${at.matterId}`;
  switch (ref.kind) {
    case "matter":
      return base;
    case "task":
    case "deadline":
      return `${base}?tab=tasks`;
    case "document_request":
    case "document_version":
      return `${base}?tab=documents`;
    case "fact":
      return `${base}?tab=intake`;
    case "message":
      return at.threadId && /^[0-9a-f-]{36}$/i.test(at.threadId) ? `${base}?tab=messages&thread=${at.threadId}` : `${base}?tab=messages`;
    default:
      return null;
  }
}

const SOURCE_KIND: Record<string, string> = {
  fee: "IRCC fee",
  submission_requirement: "Submission step",
  renewal_timing: "Renewal timing",
  follow_up_step: "Step after approval",
  rule_version: "Program rule",
};

/** An approved official item's kind in words. */
export function officialKindLabel(kind: string | undefined): string {
  return SOURCE_KIND[kind ?? ""] ?? "Official source";
}

/**
 * The source of an approved official item in words, next to its value: section, form number and
 * date modified, date checked, current-to date, page fingerprint. Dates are shown as stored (the
 * firm's own dates); a date the page didn't state is not shown, the date checked says Unknown.
 */
export function officialDetail(item: {
  section?: string | null;
  formNumber?: string | null;
  formModifiedOn?: string | null;
  checkedOn?: string | null;
  currentTo?: string | null;
  sha256?: string | null;
}): string {
  return [
    item.section ? `section: ${item.section}` : null,
    item.formNumber ? `form ${item.formNumber}${item.formModifiedOn ? `, date modified ${item.formModifiedOn}` : ""}` : null,
    item.checkedOn ? `checked ${item.checkedOn}` : "date checked Unknown",
    item.currentTo ? `current to ${item.currentTo}` : null,
    item.sha256 && /^[0-9a-f]{64}$/i.test(item.sha256) ? `page fingerprint (SHA-256) ${item.sha256.slice(0, 12)}…` : null,
  ]
    .filter((part): part is string => Boolean(part))
    .join(" · ");
}

export type GroundedAnswer =
  | { kind: "answer"; text: string; cited: VoSourceRef[]; dropped: string[]; leftOut: number }
  | { kind: "abstain"; reason: VoAbstainReason; dropped: string[] }
  | { kind: "empty" };

/** Sentences of one line; markers written after a full stop ("… overdue. [R1] Next…") belong to the sentence before. */
function sentencesOf(line: string): string[] {
  const parts = line.split(/(?<=[.!?])\s+(?=\S)/).filter((part) => part.trim());
  const out: string[] = [];
  for (const part of parts) {
    const lead = /^((?:\s*\[[RFS]\d{1,3}\][.,;]?)+)\s*/.exec(part);
    if (lead && out.length) {
      out[out.length - 1] = `${out[out.length - 1]} ${lead[1].trim()}`;
      const rest = part.slice(lead[0].length);
      if (rest.trim()) out.push(rest);
    } else {
      out.push(part);
    }
  }
  return out;
}

/**
 * Guards an Ask Vo answer against the run's allowed set (`allowed`: marker to the record it was
 * handed out for). Pure; whatever the model returned is untrusted.
 */
export function guardGroundedAnswer(raw: unknown, allowed: ReadonlyMap<string, VoSourceRef>): GroundedAnswer {
  if (typeof raw !== "string") return { kind: "empty" };
  const text = clean(raw);
  if (!text) return { kind: "empty" };
  const bare = text.replace(/^["“”«»\s]+|["“”«»\s.]+$/g, "").toLowerCase();
  if (bare.startsWith(NEEDS_CONSULTANT.toLowerCase())) return { kind: "abstain", reason: "consultant", dropped: [] };

  const dropped: string[] = [];
  const used: string[] = [];
  let leftOut = 0;
  const lines = text.split("\n").map((line) =>
    sentencesOf(line)
      .map((sentence) => {
        const kept = sentence.replace(MARKER, (marker, prefix: string, n: string) => {
          const ref = `${prefix}${n}`;
          if (allowed.has(ref)) return marker;
          if (!dropped.includes(ref)) dropped.push(ref);
          return "";
        });
        const cites = [...kept.matchAll(MARKER)].map((match) => `${match[1]}${match[2]}`);
        const lower = kept.toLowerCase();
        const official = cites.some((ref) => ref.startsWith("S"));
        const regulated = MONEY.test(kept) || REGULATED.test(kept);
        const placeholder = lower.includes(NEEDS_RULE.toLowerCase()) || lower.includes(NEEDS_CONSULTANT.toLowerCase());
        // Unsupported, a removed link or contact detail, a placeholder, or a rule without an
        // approved official source: the sentence is left out.
        if (!cites.length || kept.includes(REMOVED) || placeholder || (regulated && !official)) {
          leftOut += 1;
          return "";
        }
        for (const ref of cites) if (!used.includes(ref)) used.push(ref);
        return kept
          .replace(/[ \t]{2,}/g, " ")
          .replace(/[ \t]+([.,;:!?])/g, "$1")
          .trim();
      })
      .filter(Boolean)
      .join(" "),
  );
  let out = lines
    .filter((line) => line.trim())
    .join("\n")
    .trim();
  if (out.length > MAX_ANSWER_CHARS) out = out.slice(0, MAX_ANSWER_CHARS).trimEnd();
  const cited = used.filter((ref) => out.includes(`[${ref}]`)).map((ref) => ({ ...allowed.get(ref)!, marker: ref }));
  if (!out || !cited.length) return { kind: "abstain", reason: "unsupported", dropped };
  return { kind: "answer", text: out, cited, dropped, leftOut };
}

/** A citation as the page shows it: its link (null when there is nothing to open). */
export type VoCitation = VoSourceRef & { href: string | null };

/** Links for a run's citations; an official citation whose page isn't a deep federal official page is not shown. */
export function citationsFor(refs: VoSourceRef[], at: { matterId: string; threadId?: string | null }): VoCitation[] {
  return refs
    .filter((ref) => ref.kind !== "official" || isCitableOfficialUrl(ref.url))
    .map((ref) => ({ ...ref, href: citationHref(ref, at) }));
}

/** A citation as public.finish_vo_run takes it (official content names what it is). */
export function dbSource(ref: VoSourceRef): Record<string, string> {
  const out: Record<string, string> = { kind: ref.kind, id: ref.id, label: ref.label.slice(0, 120) || ref.kind };
  if (ref.kind === "official" && ref.sourceKind) out.source_kind = ref.sourceKind;
  return out;
}
