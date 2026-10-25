/**
 * SRC-05: pure helpers for the matter overview's "Rule pack and forms" panel and its Review upgrade
 * dialog. The input is public.matter_rule_state's JSON; every value comes from the pinned binding,
 * the approved packs and the official page snapshots behind them. A form's "date modified" is shown
 * exactly as the page states it (YYYY-MM-DD) or as Unknown; nothing is filled in.
 */
import { safeAccessError } from "@/lib/auth/step-up";
import { longDate } from "@/modules/sheet/matter-present";
import { programLabel } from "@/modules/sheet/matters-present";
import { dayInZone, shortHash } from "@/modules/renewals/present";

export type PinBadge = { tone: string; label: string };
export type PinWire = Record<`data-${string}`, string>;

export type PinForm = { number: string; modified: string; href: string | null; facts: string[] };

export type PinImpactSection = { title: string; empty: string; items: string[] };

export type MatterRulePinData = {
  badge: PinBadge;
  title: string;
  parts: string[];
  forms: PinForm[];
  formsEmpty: string | null;
  note: string | null;
  upgrade: null | {
    title: string;
    summary: string;
    decision: string | null;
    open: PinWire | null;
    dialog: null | {
      intro: string;
      sections: PinImpactSection[];
      accept: PinWire;
      decline: PinWire;
    };
  };
};

type StateForm = {
  form_number?: unknown;
  date_modified?: unknown;
  source_url?: unknown;
  retrieved_at?: unknown;
  content_hash?: unknown;
};

type ImpactRule = { stable_key?: unknown; kind?: unknown; change?: unknown; from_version?: unknown; to_version?: unknown; claim?: unknown };
type ImpactForm = { form_number?: unknown; change?: unknown; from_modified?: unknown; to_modified?: unknown };
type ImpactItem = { label?: unknown; due_on?: unknown };

export type MatterRuleState = {
  matter_version?: unknown;
  scope?: { program_key?: unknown; supported?: unknown } | null;
  binding?: {
    pinned_at?: unknown;
    recheck_required?: unknown;
    program_key?: unknown;
    jurisdiction?: unknown;
    pack_version?: unknown;
    pack_status?: unknown;
    /** SRC-03 live: false when the pack or a rule version in it is no longer live (suspended, expired, superseded). */
    pack_live?: unknown;
    platform?: unknown;
    forms?: unknown;
  } | null;
  newer?: {
    pack_id?: unknown;
    pack_version?: unknown;
    release_notes?: unknown;
    impact?: { rules?: unknown; matter_checklist?: unknown; matter_deadlines?: unknown; forms?: unknown } | null;
    decision?: { decision?: unknown; reason?: unknown; decided_at?: unknown } | null;
  } | null;
};

const text = (value: unknown): string | null => (typeof value === "string" && value.trim() ? value.trim() : null);
const list = <T>(value: unknown): T[] => (Array.isArray(value) ? (value as T[]) : []);
const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** "Form IMM 5483" with its "date modified" as the official page states it, or Unknown. */
export function pinForm(form: StateForm, timeZone: string): PinForm | null {
  const number = text(form.form_number);
  if (!number) return null;
  const modified = text(form.date_modified);
  const url = text(form.source_url);
  const retrieved = text(form.retrieved_at);
  const facts: string[] = [];
  if (retrieved) facts.push(`retrieved ${longDate(dayInZone(retrieved, timeZone))}`);
  const hash = shortHash(text(form.content_hash));
  if (hash) facts.push(hash);
  return {
    number,
    modified: modified && DATE.test(modified) ? `date modified ${modified}` : "date modified Unknown",
    href: url && url.startsWith("https://") ? url : null,
    facts: url ? facts : ["no approved evidence for this form’s page"],
  };
}

const KIND_SECTION: Record<string, string> = {
  checklist_item: "Checklist items",
  field: "Fields",
  deadline: "Deadlines",
  form: "Forms",
  rule: "Other rules",
};

const CHANGE: Record<string, string> = { added: "Added", removed: "Removed", changed: "Changed" };

function versionStep(rule: ImpactRule): string {
  const from = typeof rule.from_version === "number" ? `v${rule.from_version}` : null;
  const to = typeof rule.to_version === "number" ? `v${rule.to_version}` : null;
  return from && to ? `${from} to ${to}` : (to ?? from ?? "");
}

/** The impact preview, grouped: checklist items, fields, deadlines, forms, other rules, then this matter's own items. */
export function impactSections(impact: NonNullable<NonNullable<MatterRuleState["newer"]>["impact"]>): PinImpactSection[] {
  const groups = new Map<string, string[]>(Object.values(KIND_SECTION).map((title) => [title, []]));
  for (const rule of list<ImpactRule>(impact.rules)) {
    const title = KIND_SECTION[text(rule.kind) ?? "rule"] ?? KIND_SECTION.rule;
    const change = CHANGE[text(rule.change) ?? ""] ?? "Changed";
    const claim = text(rule.claim);
    groups.get(title)?.push(`${change}: ${text(rule.stable_key) ?? "rule"} (${versionStep(rule)})${claim ? `. ${claim}` : ""}`);
  }
  for (const form of list<ImpactForm>(impact.forms)) {
    const number = text(form.form_number);
    if (!number) continue;
    const from = text(form.from_modified) ?? "Unknown";
    const to = text(form.to_modified) ?? "Unknown";
    const change = text(form.change);
    groups.get("Forms")?.push(
      change === "added" ? `Added: ${number} (date modified ${to})` : change === "removed" ? `Removed: ${number}` : `Changed: ${number}, date modified ${from} to ${to}`,
    );
  }
  const sections: PinImpactSection[] = [...groups.entries()].map(([title, items]) => ({ title, empty: "No change", items }));
  sections.push({
    title: "This matter’s checklist items from a changed rule",
    empty: "None",
    items: list<ImpactItem>(impact.matter_checklist).map((item) => text(item.label) ?? "Checklist item"),
  });
  sections.push({
    title: "This matter’s deadlines from a changed rule",
    empty: "None",
    items: list<ImpactItem>(impact.matter_deadlines).map((item) => {
      const due = text(item.due_on);
      return `${text(item.label) ?? "Deadline"}${due && DATE.test(due) ? `, due ${longDate(due)}` : ""}`;
    }),
  });
  return sections;
}

/**
 * The overview panel. `canDecide`: a licensed consultant or the firm owner (the database checks
 * again, and asks for a step-up to accept).
 */
export function matterRulePin(
  state: MatterRuleState | null,
  input: { organizationId: string; matterId: string; timeZone: string; canDecide: boolean },
): MatterRulePinData | null {
  if (!state) return null;
  const binding = state.binding;
  const scope = state.scope;
  if (!binding) {
    const program = text(scope?.program_key);
    const unsupported = Boolean(program) && scope?.supported === false;
    return {
      badge: { tone: unsupported ? "chg" : "unv", label: unsupported ? "Not supported" : "No rule pack" },
      title: "No approved rule pack",
      parts: program ? [programLabel(program)] : [],
      forms: [],
      formsEmpty: null,
      note: unsupported
        ? `${programLabel(program)} is not supported yet: there is no approved, sourced rule pack for it. This matter has no checklist, rules or form versions from Casevoya, and none are taken from another program. Work it manually.`
        : "This matter was opened without a program rule pack, so Casevoya applies no checklist, rules or form versions to it.",
      upgrade: null,
    };
  }
  const version = typeof binding.pack_version === "number" ? binding.pack_version : null;
  const program = text(binding.program_key);
  const pinned = text(binding.pinned_at);
  const forms = list<StateForm>(binding.forms)
    .map((form) => pinForm(form, input.timeZone))
    .filter((form): form is PinForm => Boolean(form));
  const recheck = binding.recheck_required === true;
  const status = text(binding.pack_status);
  const notLive = binding.pack_live === false;
  const parts = [
    program ? programLabel(program) : null,
    text(binding.jurisdiction),
    binding.platform === true ? "Casevoya pack" : "Firm pack",
    pinned ? `pinned ${longDate(dayInZone(pinned, input.timeZone))}` : null,
  ].filter((part): part is string => Boolean(part));

  let upgrade: MatterRulePinData["upgrade"] = null;
  const newer = state.newer;
  const nextVersion = newer && typeof newer.pack_version === "number" ? newer.pack_version : null;
  const packId = text(newer?.pack_id);
  if (newer && nextVersion && packId) {
    const decided = newer.decision;
    const decidedOn = text(decided?.decided_at);
    const decision =
      decided && text(decided.decision) === "declined"
        ? `Declined${decidedOn ? ` ${longDate(dayInZone(decidedOn, input.timeZone))}` : ""}: ${text(decided.reason) ?? ""}`.trim()
        : null;
    const wire = (act: string): PinWire => ({
      "data-pin": act,
      "data-org": input.organizationId,
      "data-matter": input.matterId,
      "data-pack": packId,
      "data-version": String(typeof state.matter_version === "number" ? state.matter_version : ""),
    });
    upgrade = {
      title: `Version ${nextVersion} is approved`,
      summary: `This matter stays on version ${version ?? "?"} until a licensed consultant or the firm owner reviews the changes and accepts. Earlier exports and packages keep the versions they were made with.`,
      decision,
      open: input.canDecide ? { "data-open": "dPinUp" } : null,
      dialog: input.canDecide
        ? {
            intro: `What changes if this matter moves from version ${version ?? "?"} to version ${nextVersion}.${text(newer.release_notes) ? ` Release notes: ${text(newer.release_notes)}` : ""}`,
            sections: impactSections(newer.impact ?? {}),
            accept: wire("accept"),
            decline: wire("decline"),
          }
        : null,
    };
  }

  return {
    badge: recheck
      ? { tone: "chg", label: "Source changed: recheck" }
      : status === "review_due"
        ? { tone: "chg", label: "Review due" }
        : notLive
          ? { tone: "chg", label: "No longer live" }
        : { tone: "ok", label: "Pinned" },
    title: `Rule pack v${version ?? "?"}`,
    parts,
    forms,
    formsEmpty: forms.length ? null : "This pack lists no IRCC form versions.",
    note: recheck
      ? "An official page this pack cites has changed since it was approved. The pin stays as it is until a newer version is approved and accepted."
      : notLive
        ? "A rule in this pack is no longer live (suspended, expired or replaced). The pin stays as it is until a newer version is approved and accepted."
        : null,
    upgrade,
  };
}

/** Plain words for a refused upgrade decision. Never passes a database message through. */
export function ruleUpgradeError(message: string): string {
  if (/version conflict/i.test(message)) return "This matter changed since you opened it. Reload the page and try again.";
  if (/not a newer version/i.test(message)) return "That isn’t a newer version of this matter’s rule pack. Reload the page.";
  if (/not approved for this firm/i.test(message)) return "That version is no longer approved for this firm. Reload the page.";
  if (/no pinned rule pack/i.test(message)) return "This matter has no pinned rule pack to upgrade.";
  if (/say why/i.test(message)) return "Say why, in 3 to 500 characters.";
  if (/staff access denied|upgrade decision denied/i.test(message)) return "Only a licensed consultant or the firm owner can decide an upgrade.";
  if (/sample mode/i.test(message)) return "This firm is in sample mode; only sample matters accept new work.";
  return safeAccessError(message);
}
