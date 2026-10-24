/**
 * Settings > Vo: the AI vendor terms panel and the owner's acknowledgement before Vo is turned on
 * (PRD AI-06). The content is the reviewed configuration in src/modules/vo/vendor-terms.ts, shown
 * as the vendors' own words with the page, section, page date, retrieval date and page hash next to
 * each value. Pure, so the copy and the rules are tested.
 */
import type { Attrs } from "@/components/sheet/designer/drafts";
import type { MatterBadge } from "@/components/sheet/designer/matters";
import { VENDOR_FIELD_LABEL, VENDOR_FIELDS, VO_VENDOR_TERMS, type VendorSource, type VoVendorTerms } from "@/modules/vo/vendor-terms";

export const VO_TERMS_DIALOG = "dlgVoTerms";
export const NOT_STATED = "Not stated in the published terms";

/** One acknowledgement row (vo_vendor_terms_acknowledgements), with the person's name. */
export type VendorTermsAckRow = { version: string; at: string; by: string };

export type VendorCite = { label: string; href: string; detail: string; hash: string };
export type VendorQuote = { text: string[]; cite: VendorCite };
export type VendorTermsRow = { term: string; quotes: VendorQuote[]; unstated: string | null };

export type VendorTermsVendor = {
  key: string;
  vendor: string;
  service: string;
  usedFor: string;
  setup: string[];
  rows: VendorTermsRow[];
  reviewed: string;
  terms: { label: string; href: string }[];
};

export type VendorTermsDialogData = {
  id: string;
  title: string;
  lead: string;
  points: { title: string; detail: string }[];
  links: { label: string; href: string }[];
  accept: { label: string; attrs: Attrs };
};

export type AiVendorTermsData = {
  intro: string;
  status: { badge: MatterBadge; text: string };
  /** The owner's "Review and acknowledge" when the current version isn't acknowledged. */
  action: { label: string; attrs: Attrs } | null;
  vendors: VendorTermsVendor[];
  note: string;
  dialog: VendorTermsDialogData | null;
  /** Whether the firm acknowledged the version shown (the firm switch asks first when not). */
  acknowledged: boolean;
};

const MONTH = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** A calendar day (YYYY-MM-DD) as "24 Oct 2026", without a time zone shift. */
export function calendarDay(day: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
  if (!match) return day;
  return `${Number(match[3])} ${MONTH[Number(match[2]) - 1]} ${match[1]}`;
}

/** An instant as "24 Oct 2026" in the firm's time zone. */
export function firmDay(iso: string, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "numeric", day: "numeric" }).formatToParts(new Date(iso));
  const get = (type: string) => Number(parts.find((part) => part.type === type)?.value ?? 0);
  return `${get("day")} ${MONTH[get("month") - 1]} ${get("year")}`;
}

function cite(source: VendorSource): VendorCite {
  const detail = [source.section, source.pageDate, `retrieved ${calendarDay(source.retrievedOn)}`].filter(Boolean).join(" · ");
  return { label: source.title, href: source.url, detail, hash: source.sha256 };
}

function status(
  acks: VendorTermsAckRow[],
  version: string,
  enabled: boolean,
  timeZone: string,
): { badge: MatterBadge; text: string; acknowledged: boolean } {
  const current = acks.find((ack) => ack.version === version);
  if (current) {
    const day = firmDay(current.at, timeZone);
    return { badge: { tone: "ok", label: "Acknowledged", detail: day }, text: `${current.by} acknowledged these terms on ${day} (terms version ${version}).`, acknowledged: true };
  }
  const earlier = [...acks].sort((a, b) => b.at.localeCompare(a.at))[0];
  if (earlier) {
    return {
      badge: { tone: "chg", label: "Terms changed" },
      text: `${earlier.by} acknowledged terms version ${earlier.version} on ${firmDay(earlier.at, timeZone)}. The terms changed since: the firm owner acknowledges version ${version} before Vo can be turned on again.`,
      acknowledged: false,
    };
  }
  return {
    badge: { tone: "rev", label: "Not acknowledged" },
    text: enabled
      ? `Vo was turned on before this panel existed. The firm owner acknowledges terms version ${version} here; Vo can’t be turned on again without it.`
      : `The firm owner acknowledges terms version ${version} before turning Vo on for the first time.`,
    acknowledged: false,
  };
}

export function vendorTermsPanel(input: {
  organizationId: string;
  isOwner: boolean;
  enabled: boolean;
  timeZone: string;
  acks: VendorTermsAckRow[];
  terms?: VoVendorTerms;
}): AiVendorTermsData {
  const terms = input.terms ?? VO_VENDOR_TERMS;
  const state = status(input.acks, terms.version, input.enabled, input.timeZone);
  const reviewed = `${calendarDay(terms.reviewedOn)}, ${terms.reviewedBy}`;
  const vendors: VendorTermsVendor[] = terms.vendors.map((vendor) => ({
    key: vendor.key,
    vendor: vendor.vendor,
    service: vendor.service,
    usedFor: vendor.usedFor,
    setup: vendor.setup,
    rows: VENDOR_FIELDS.map((field) => ({
      term: VENDOR_FIELD_LABEL[field],
      quotes: vendor.fields[field].map((statement) => ({ text: statement.quote.split("\n"), cite: cite(statement.source) })),
      unstated: vendor.fields[field].length ? null : NOT_STATED,
    })),
    reviewed,
    terms: vendor.terms.map((link) => ({ label: link.label, href: link.url })),
  }));
  const unstated = terms.vendors.flatMap((vendor) =>
    VENDOR_FIELDS.filter((field) => vendor.fields[field].length === 0).map((field) => `${vendor.vendor} (${vendor.service}): ${VENDOR_FIELD_LABEL[field].toLowerCase()}`),
  );
  const ownerCanAcknowledge = input.isOwner && !state.acknowledged;
  const turnOn = !input.enabled;
  return {
    intro:
      "What each AI vendor Casevoya uses says about your data, quoted from its published terms. Each value names the page, section, page date and the day Casevoya retrieved it. A signed agreement with a vendor would take precedence over these published terms.",
    status: { badge: state.badge, text: state.text },
    action: ownerCanAcknowledge ? { label: "Review and acknowledge", attrs: { "data-dlg": VO_TERMS_DIALOG } } : null,
    vendors,
    note: `Terms version ${terms.version}, last reviewed ${reviewed}. Casevoya doesn’t sync these terms automatically: they are re-read from each vendor’s page and reviewed before a new version is published.`,
    acknowledged: state.acknowledged,
    dialog: ownerCanAcknowledge
      ? {
          id: VO_TERMS_DIALOG,
          title: turnOn ? "Acknowledge the AI vendor terms to turn Vo on" : "Acknowledge the AI vendor terms",
          lead: `Vo sends the records it reads to the AI vendors below. Read what their published terms say about data use, retention, processing region, subprocessors and deletion in the AI vendor terms panel. Casevoya records that you acknowledged terms version ${terms.version}, and when.`,
          points: [
            ...terms.vendors.map((vendor) => ({ title: `${vendor.vendor}: ${vendor.service}`, detail: vendor.usedFor })),
            ...(unstated.length ? [{ title: NOT_STATED, detail: `${unstated.join("; ")}.` }] : []),
          ],
          links: terms.vendors.flatMap((vendor) => vendor.terms.map((link) => ({ label: link.label, href: link.url }))),
          accept: {
            label: turnOn ? "Acknowledge and turn Vo on" : "Acknowledge",
            attrs: { "data-vo-terms-ack": terms.version, "data-turn-on": turnOn ? "1" : "0", "data-org": input.organizationId },
          },
        }
      : null,
  };
}
