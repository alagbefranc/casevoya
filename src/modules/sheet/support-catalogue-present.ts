/**
 * SRC-12: pure helpers for "What Casevoya supports" (the staff Sheet page and the public page).
 * The input is public.support_catalogue's JSON. Support is never claimed here: a row reads
 * Supported only when the database found a live (app.rule_pack_is_live), sourced rule pack.
 * A program shows IRCC's official name, linked to its official page with the retrieval date, only
 * when that page's snapshot was captured; otherwise it is listed with "Source not captured".
 */
import { longDate } from "@/modules/sheet/matter-present";
import { programLabel } from "@/modules/sheet/matters-present";
import { dayInZone, shortHash } from "@/modules/renewals/present";

export type CatalogueBadge = { tone: string; label: string };

export type CatalogueRow = {
  key: string;
  name: string;
  href: string | null;
  facts: string[];
  badge: CatalogueBadge;
  detail: string;
};

export type SupportCatalogueData = {
  intro: string;
  jurisdictions: CatalogueRow[];
  programs: CatalogueRow[];
  caseTypes: CatalogueRow[];
  notes: string[];
  /** Staff only: the firm's own jurisdictions, from its profile. */
  firm: string | null;
  publicHref: string;
  unavailable?: boolean;
};

type Official = { name?: unknown; url?: unknown; section?: unknown; retrieved_at?: unknown; modified_on?: unknown; content_hash?: unknown; reviewed?: unknown };
type ProgramRow = {
  key?: unknown;
  label?: unknown;
  jurisdiction?: unknown;
  case_type?: unknown;
  supported?: unknown;
  pack_version?: unknown;
  pack_scope?: unknown;
  official?: Official | null;
};
type ScopeRow = { key?: unknown; label?: unknown; note?: unknown; supported?: unknown; firm_practises?: unknown };

export type SupportCatalogueJson = {
  programs?: unknown;
  jurisdictions?: unknown;
  case_types?: unknown;
  firm_jurisdictions?: unknown;
};

export const SUPPORT_PUBLIC_HREF = "/supported";
export const SUPPORT_SHEET_HREF = "/sheet/templates?tab=support";

const text = (value: unknown): string | null => (typeof value === "string" && value.trim() ? value.trim() : null);
const list = <T>(value: unknown): T[] => (Array.isArray(value) ? (value as T[]) : []);

const SUPPORTED: CatalogueBadge = { tone: "ok", label: "Supported" };
const NOT_SUPPORTED: CatalogueBadge = { tone: "unv", label: "Not supported" };

function withAnchor(url: string, section: string | null): string {
  if (!section || url.includes("#")) return url;
  return /^[A-Za-z][\w-]*$/.test(section) ? `${url}#${section}` : url;
}

export function programRow(row: ProgramRow, timeZone: string): CatalogueRow | null {
  const key = text(row.key);
  if (!key) return null;
  const supported = row.supported === true;
  const official = row.official ?? null;
  const url = text(official?.url);
  const reviewed = official?.reviewed === true;
  const officialName = text(official?.name);
  const label = text(row.label) ?? programLabel(key);
  const facts: string[] = [];
  const jurisdiction = text(row.jurisdiction);
  if (jurisdiction) facts.push(jurisdiction);
  let name = label;
  let href: string | null = null;
  let source: string;
  if (url && reviewed && officialName) {
    name = officialName;
    href = withAnchor(url, text(official?.section));
    const retrieved = text(official?.retrieved_at);
    if (retrieved) facts.push(`retrieved ${longDate(dayInZone(retrieved, timeZone))}`);
    const modified = text(official?.modified_on);
    facts.push(`date modified ${modified ?? "Unknown"}`);
    const hash = shortHash(text(official?.content_hash));
    if (hash) facts.push(hash);
    source = "IRCC’s name for the program, from its official page.";
  } else if (url) {
    source = "Official page captured; its name and link show once the capture is reviewed.";
  } else {
    source = "Source not captured: the program’s official page hasn’t been captured yet.";
  }
  const version = typeof row.pack_version === "number" ? row.pack_version : null;
  const scope = text(row.pack_scope) === "firm" ? "your firm’s pack" : "Casevoya pack";
  return {
    key,
    name,
    href,
    facts,
    badge: supported ? SUPPORTED : NOT_SUPPORTED,
    detail: supported
      ? `Approved, sourced rule pack v${version ?? "?"} (${scope}). ${source}`
      : `No approved, sourced rule pack. A matter for it opens with no checklist or rules, and nothing is taken from another program. ${source}`,
  };
}

function scopeRow(row: ScopeRow, kind: "jurisdiction" | "case_type"): CatalogueRow | null {
  const key = text(row.key);
  const label = text(row.label);
  if (!key || !label) return null;
  const supported = row.supported === true;
  const facts = kind === "jurisdiction" ? [key] : [];
  if (row.firm_practises === true) facts.push("your firm practises here");
  const note = text(row.note);
  return {
    key,
    name: label,
    href: null,
    facts,
    badge: supported ? SUPPORTED : NOT_SUPPORTED,
    detail: `${note ? `${note} ` : ""}${supported ? "At least one program here has an approved, sourced rule pack." : "No program here has an approved, sourced rule pack yet."}`,
  };
}

export function supportCatalogue(json: SupportCatalogueJson | null, input: { timeZone: string; staff: boolean }): SupportCatalogueData {
  const programs = list<ProgramRow>(json?.programs)
    .map((row) => programRow(row, input.timeZone))
    .filter((row): row is CatalogueRow => Boolean(row));
  const jurisdictions = list<ScopeRow>(json?.jurisdictions)
    .map((row) => scopeRow(row, "jurisdiction"))
    .filter((row): row is CatalogueRow => Boolean(row));
  const caseTypes = list<ScopeRow>(json?.case_types)
    .map((row) => scopeRow(row, "case_type"))
    .filter((row): row is CatalogueRow => Boolean(row));
  const firmCodes = list<unknown>(json?.firm_jurisdictions).filter((code): code is string => typeof code === "string");
  return {
    intro: input.staff
      ? "Where Casevoya has an approved, sourced rule pack, and where it doesn’t. It counts the platform’s packs and your firm’s own approved packs."
      : "Where Casevoya has an approved, sourced rule pack, and where it doesn’t.",
    jurisdictions,
    programs,
    caseTypes,
    notes: [
      "Supported means a rule pack built from official IRCC or Government of Canada pages, each claim with its page, section, retrieval date and snapshot hash, approved by a licensed consultant. Anything else is not supported.",
      "Countries other than Canada are not supported.",
      "A matter for an unsupported program, province, tribunal or case type opens with no checklist or rules, and never takes them from another program.",
      "Casevoya doesn’t submit to IRCC or any other government, has no government integration, doesn’t verify licences on its own (firms record their College register checks), and doesn’t promise any approval or processing time.",
    ],
    firm: input.staff && json?.firm_jurisdictions != null ? (firmCodes.length ? firmCodes.join(", ") : "None recorded on the firm profile") : null,
    publicHref: SUPPORT_PUBLIC_HREF,
  };
}
