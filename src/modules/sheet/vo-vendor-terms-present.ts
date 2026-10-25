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
  /** "Signed agreement with Casevoya, effective …", or null when there is none. */
  agreement: { title: string; text: string; precedence: string } | null;
  /** The label over the published-terms rows. */
  published: { term: string; text: string };
  rows: VendorTermsRow[];
  reviewed: string;
  terms: { label: string; href: string }[];
};

export type CommitmentData = {
  key: string;
  title: string;
  quote: string;
  cite: VendorCite;
  commitment: string[];
};

export type CommitmentsData = { status: string; intro: string; items: CommitmentData[] };

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
  /** Casevoya's own AI terms, written to the CICC Code (pending Francis's approval). */
  commitments: CommitmentsData;
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
    agreement: vendor.agreement
      ? {
          title: vendor.agreement.title,
          text: `Signed agreement with Casevoya, effective ${calendarDay(vendor.agreement.effectiveOn)}. ${vendor.agreement.note}`,
          precedence: "It takes precedence over the vendor’s published terms below.",
        }
      : null,
    published: {
      term: vendor.agreement ? "Vendor’s published terms (for reference)" : "Vendor’s published terms",
      text: vendor.agreement ? "Quoted from the vendor’s public pages. Where they differ, the signed agreement applies." : "Quoted from the vendor’s public pages.",
    },
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
  const code = terms.commitments.source;
  const agreements = terms.vendors.filter((vendor) => vendor.agreement);
  const commitments: CommitmentsData = {
    status: terms.commitments.status,
    intro:
      "How Casevoya handles your clients’ information when Vo is used. Each term is written to an obligation in the College of Immigration and Citizenship Consultants’ Code of Professional Conduct, quoted from Justice Laws above it.",
    items: terms.commitments.items.map((item) => ({
      key: item.key,
      title: `Section ${item.obligation.section}: ${item.obligation.heading}`,
      quote: item.obligation.quote,
      cite: {
        label: code.title,
        href: item.obligation.url,
        detail: [`section ${item.obligation.section}`, `current to ${calendarDay(code.currentTo)}`, `retrieved ${calendarDay(code.retrievedOn)}`].join(" · "),
        hash: code.sha256,
      },
      commitment: item.commitment,
    })),
  };
  return {
    intro: agreements.length
      ? "Casevoya has a signed agreement with each AI vendor it uses; the agreement takes precedence. Each vendor’s published terms are quoted below it for reference, with the page, section, page date and the day Casevoya retrieved it."
      : "What each AI vendor Casevoya uses says about your data, quoted from its published terms. Each value names the page, section, page date and the day Casevoya retrieved it.",
    status: { badge: state.badge, text: state.text },
    action: ownerCanAcknowledge ? { label: "Review and acknowledge", attrs: { "data-dlg": VO_TERMS_DIALOG } } : null,
    vendors,
    commitments,
    note: `Terms version ${terms.version}, last reviewed ${reviewed}. Casevoya doesn’t sync these terms automatically: they are re-read from each vendor’s page and reviewed before a new version is published.`,
    acknowledged: state.acknowledged,
    dialog: ownerCanAcknowledge
      ? {
          id: VO_TERMS_DIALOG,
          title: turnOn ? "Acknowledge the AI vendor terms to turn Vo on" : "Acknowledge the AI vendor terms",
          lead: `Vo sends the records it reads to the AI vendors below. Read the AI vendor terms panel first: the signed agreements, each vendor’s published terms on data use, retention, processing region, subprocessors and deletion, and Casevoya’s commitments. Casevoya records that you acknowledged terms version ${terms.version}, and when.`,
          points: [
            ...terms.vendors.map((vendor) => ({
              title: `${vendor.vendor}: ${vendor.service}`,
              detail: vendor.agreement ? `${vendor.usedFor} Signed agreement with Casevoya, effective ${calendarDay(vendor.agreement.effectiveOn)}. ${vendor.agreement.note}` : vendor.usedFor,
            })),
            ...(unstated.length ? [{ title: `${NOT_STATED} (vendor’s public pages)`, detail: `${unstated.join("; ")}.` }] : []),
            { title: "Casevoya’s commitments", detail: `${terms.commitments.items.length} terms, each written to an obligation in the CICC Code of Professional Conduct. ${terms.commitments.status}.` },
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
