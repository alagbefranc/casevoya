/**
 * Language-parametric email builders: the same branches as catalog.ts, with every sentence taken
 * from a string table instead of written inline. English comes from i18n-source.json and French
 * from fr-drafts.json, under the same keys and {placeholders}; merge values come from the same
 * typed contexts and are formatted for the language (dates and times through format.ts, in the
 * same time zone as English).
 *
 * tests/email-french.test.ts proves that buildLocalized(id, "en", …) is identical to the approved
 * English builder in catalog.ts for every template and variant, so English copy has one wording
 * and the French builders cannot drift from its branches. Links come from the same fixed app
 * paths (appLink / safeUrl) as English; nothing here is taken from the translation as a link.
 *
 * Which language is SENT is decided in french.ts (recipient preference AND an approved review).
 */
import source from "@/modules/email/designs/i18n-source.json";
import drafts from "@/modules/email/designs/fr-drafts.json";
import { PATHS, type EmailContexts, type TemplateId } from "@/modules/email/designs/catalog";
import { appLink, cleanText, safeUrl, type Brand, type EmailCopy, type ShellText, type Spot } from "@/modules/email/designs/layout";
import {
  bookingRefOrNull,
  countOrNull,
  dateTimeIn,
  dateTimeInFr,
  dayDate,
  dayDateFr,
  documentNumber,
  longDate,
  longDateFr,
  shortDate,
  shortDateFr,
  uuidOrNull,
} from "@/modules/email/designs/format";

export type Lang = "en" | "fr";

/**
 * The ids that have a string table: every catalog template except the EM14 French previews and
 * EX15 (a staff member's own words, sent as written: its few shell lines stay English until the
 * owner decides how a staff email should read in French), plus "generic".
 */
export type LocalizedId = Exclude<TemplateId, "EM14a" | "EM14b" | "EM14c" | "EX15"> | "generic";

type Table = Record<string, Record<string, string>>;
export type DraftString = { en: string; fr: string; origin: "machine" | "hand" | "reviewer"; note?: string };
export type DraftStatus = "machine_draft" | "in_review" | "approved" | "rejected";
export type DraftEntry = {
  status: DraftStatus;
  reviewer: string | null;
  reviewedOn: string | null;
  model: string | null;
  promptVersion: string | null;
  draftedOn: string | null;
  sourceHash: string;
  strings: Record<string, DraftString>;
};
export type DraftFile = { _readme?: string; templates: Record<string, DraftEntry> };

export const EN_SOURCE = source as Table;
export const FR_DRAFTS = drafts as DraftFile;

/** The table for one language: English source, or the French drafts' fr strings. */
function tableFor(lang: Lang, drafted: DraftFile = FR_DRAFTS): Table {
  if (lang === "en") return EN_SOURCE;
  const out: Table = {};
  for (const [id, entry] of Object.entries(drafted.templates)) {
    out[id] = Object.fromEntries(Object.entries(entry.strings).map(([key, value]) => [key, value.fr]));
  }
  return out;
}

/** Replaces {name} with values in one pass, so braces inside a value are never read as placeholders. */
export function fill(template: string, values: Record<string, string | number> = {}): string {
  return template.replace(/\{([a-z_]+)\}/g, (whole, name: string) => (name in values ? String(values[name]) : whole));
}

type T = (key: string, values?: Record<string, string | number>) => string;

function translator(table: Table, id: string): T {
  return (key, values) => {
    const [group, name] = key.startsWith("_shared.") ? ["_shared", key.slice(8)] : [id, key];
    const text = table[group]?.[name];
    if (typeof text !== "string") throw new Error(`Missing email string ${group}.${name}`);
    return fill(text, values);
  };
}

type Fmt = {
  longDate: (value: unknown) => string | null;
  dayDate: (value: unknown) => string | null;
  shortDate: (value: unknown) => string | null;
  dateTimeIn: (value: unknown, zone: unknown) => string | null;
};

const FORMATS: Record<Lang, Fmt> = {
  en: { longDate, dayDate, shortDate, dateTimeIn },
  fr: { longDate: longDateFr, dayDate: dayDateFr, shortDate: shortDateFr, dateTimeIn: dateTimeInFr },
};

type Kit = { t: T; f: Fmt; lang: Lang; origin: string; drafted: DraftFile };

function firm(kit: Kit, context: { firmName: string }): string {
  return cleanText(context.firmName) || kit.t("_shared.your_firm");
}

function name(value: string | null | undefined): string {
  return cleanText(value ?? "", 80);
}

function firmBrand(kit: Kit, context: { firmName: string }): Brand {
  return { kind: "firm", firmName: firm(kit, context) };
}

const PLATFORM: Brand = { kind: "platform" };

function cta(label: string, href: string | null): EmailCopy["cta"] {
  return href ? { label, href } : null;
}

function copy(kit: Kit, parts: Omit<EmailCopy, "cta" | "lang"> & { cta?: EmailCopy["cta"] }): EmailCopy {
  const out: EmailCopy = { cta: null, ...parts };
  // English copy carries no lang or shell (the renderer's English defaults), exactly as catalog.ts.
  if (kit.lang === "fr") {
    out.lang = "fr";
    out.shell = shellText("fr", kit.drafted);
  }
  return out;
}

/** "Toronto time" / "heure de Toronto" (« heure d’ » before a vowel). */
function zoneLabel(kit: Kit, zone: string | null | undefined): string {
  const city = cleanText(zone ?? "", 60).split("/").pop()?.replaceAll("_", " ") || "Toronto";
  const label = kit.t("_shared.zone_label", { city });
  return kit.lang === "fr" ? label.replace(/\bde ([AEIOUYÀÂÉÈÊÎÔÛaeiouyh])/u, "d’$1") : label;
}

const ROLES = ["firm_owner", "licensed_consultant", "case_manager", "assistant", "finance_user"];

function rolePhrase(kit: Kit, role: string | null | undefined): string {
  return kit.t(`_shared.role_${typeof role === "string" && ROLES.includes(role) ? role : "other"}`);
}

function invoiceHref(origin: string, invoiceId: string | null | undefined): string | null {
  const id = uuidOrNull(invoiceId);
  return appLink(origin, id ? `${PATHS.portalPayments}?invoice=${id}` : PATHS.portalPayments);
}

const FIRM_SLUG = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/;

function bookingPageHref(origin: string, firmSlug: string | null | undefined): string | null {
  const slug = typeof firmSlug === "string" ? firmSlug.trim() : "";
  return FIRM_SLUG.test(slug) ? appLink(origin, `${PATHS.book}/${slug}`) : null;
}

const AGREEMENT_KINDS = ["service", "consultation", "amendment", "consent", "quote"];

type Ctx<K extends keyof EmailContexts> = EmailContexts[K];
type GenericContext = { firmName: string };
type Builders = {
  [K in LocalizedId]: (kit: Kit, context: K extends keyof EmailContexts ? Ctx<K> : GenericContext) => EmailCopy;
};

function spot(value: Spot): Spot {
  return value;
}

const BUILDERS: Builders = {
  EM01(kit, context) {
    const { t } = kit;
    const firmName = firm(kit, context);
    const inviter = name(context.inviterName);
    const link = safeUrl(context.acceptUrl);
    const lead = t("lead", { role_phrase: rolePhrase(kit, context.role) });
    const subject = inviter ? t("subject_inviter", { inviter_name: inviter, firm_name: firmName }) : t("subject", { firm_name: firmName });
    return copy(kit, {
      subject,
      preheader: t("preheader", { firm_name: firmName }),
      heading: subject,
      body: `${lead} ${link ? t("_shared.invite_expiry") : t("_shared.invite_without_link")}`,
      cta: cta(t("cta"), link),
      spot: spot("staff-invite"),
      brand: PLATFORM,
    });
  },
  EM02(kit, context) {
    const { t } = kit;
    const firmName = firm(kit, context);
    const inviter = name(context.inviterName);
    const invited = inviter ? t("invited_inviter", { inviter_name: inviter, firm_name: firmName }) : t("invited", { firm_name: firmName });
    const link = safeUrl(context.acceptUrl);
    return copy(kit, {
      subject: t("subject", { firm_name: firmName }),
      preheader: t("preheader"),
      heading: t("subject", { firm_name: firmName }),
      body: link ? `${invited} ${t("first_step")} ${t("_shared.invite_expiry")}` : `${invited} ${t("_shared.invite_without_link")}`,
      cta: cta(t("cta"), link),
      spot: "client-invite",
      brand: firmBrand(kit, context),
    });
  },
  EM05(kit) {
    const { t } = kit;
    return copy(kit, { subject: t("subject"), preheader: t("preheader"), heading: t("subject"), body: t("body"), spot: "sign-in-code", brand: PLATFORM });
  },
  EM06(kit, context) {
    const { t, f, origin } = kit;
    const firmName = firm(kit, context);
    const due = f.longDate(context.dueOn);
    return copy(kit, {
      subject: t("subject", { firm_name: firmName }),
      preheader: t("preheader"),
      heading: t("subject", { firm_name: firmName }),
      body: due ? t("body_due", { due_date: due }) : t("body"),
      cta: cta(t("cta"), appLink(origin, PATHS.portalDocuments)),
      spot: "document-requested",
      brand: firmBrand(kit, context),
    });
  },
  EM07(kit, context) {
    const { t, f, origin } = kit;
    const short = f.shortDate(context.dueOn);
    const day = f.dayDate(context.dueOn);
    return copy(kit, {
      subject: short ? t("subject_due", { short_date: short }) : t("subject", { firm_name: firm(kit, context) }),
      preheader: t("preheader"),
      heading: short ? t("heading_due", { short_date: short }) : t("heading"),
      body: day ? t("body_due", { day_date: day }) : t("body"),
      cta: cta(t("cta"), appLink(origin, PATHS.portal)),
      spot: "reminder",
      brand: firmBrand(kit, context),
    });
  },
  EM08(kit, context) {
    const { t, origin } = kit;
    const firmName = firm(kit, context);
    const kind = typeof context.agreementKind === "string" && AGREEMENT_KINDS.includes(context.agreementKind) ? `body_${context.agreementKind}` : "body";
    const ref = bookingRefOrNull(context.signingRef);
    if (ref) {
      return copy(kit, {
        subject: t("subject", { firm_name: firmName }),
        preheader: t("preheader_booking"),
        heading: t("heading"),
        body: t("body_booking", { firm_name: firmName }),
        cta: cta(t("cta"), appLink(origin, `${PATHS.consultation}/${ref}/agreement`)),
        spot: "agreement",
        brand: firmBrand(kit, context),
      });
    }
    return copy(kit, {
      subject: t("subject", { firm_name: firmName }),
      preheader: t("preheader"),
      heading: t("heading"),
      body: t(kind, { firm_name: firmName }),
      cta: cta(t("cta"), appLink(origin, PATHS.portalAgreements)),
      spot: "agreement",
      brand: firmBrand(kit, context),
    });
  },
  "EM08-staff"(kit, context) {
    const { t, origin } = kit;
    const firmName = firm(kit, context);
    return copy(kit, {
      subject: t("subject", { firm_name: firmName }),
      preheader: t("preheader"),
      heading: t("heading"),
      body: t("body", { firm_name: firmName }),
      cta: cta(t("cta"), appLink(origin, PATHS.sheetAgreements)),
      spot: "agreement",
      brand: PLATFORM,
    });
  },
  EM09(kit, context) {
    const { t, origin } = kit;
    const firmName = firm(kit, context);
    return copy(kit, {
      subject: t("subject", { firm_name: firmName }),
      preheader: t("preheader"),
      heading: t("heading"),
      body: t("body", { firm_name: firmName }),
      cta: cta(t("cta"), appLink(origin, PATHS.portalAgreements)),
      spot: "agreement",
      brand: firmBrand(kit, context),
    });
  },
  "EM09-staff"(kit, context) {
    const { t, origin } = kit;
    const firmName = firm(kit, context);
    return copy(kit, {
      subject: t("subject", { firm_name: firmName }),
      preheader: t("preheader"),
      heading: t("heading"),
      body: t("body"),
      cta: cta(t("cta"), appLink(origin, PATHS.sheetAgreements)),
      spot: "agreement",
      brand: PLATFORM,
    });
  },
  EM10(kit, context) {
    const { t, f, origin } = kit;
    const firmName = firm(kit, context);
    const number = documentNumber(context.invoiceNumber, "INV");
    const due = f.longDate(context.dueOn);
    const key = number ? (due ? "body_number_due" : "body_number") : due ? "body_due" : "body";
    return copy(kit, {
      subject: t("subject", { firm_name: firmName }),
      preheader: t("preheader"),
      heading: t("subject", { firm_name: firmName }),
      body: t(key, { invoice_number: number ?? "", due_date: due ?? "" }),
      cta: cta(t("cta"), invoiceHref(origin, context.invoiceId)),
      spot: "invoice",
      brand: firmBrand(kit, context),
    });
  },
  EM11(kit, context) {
    const { t, origin } = kit;
    const firmName = firm(kit, context);
    const number = documentNumber(context.receiptNumber, "PR") ?? documentNumber(context.receiptNumber, "RC");
    const key = `body${context.advance ? "_advance" : ""}${number ? "_number" : ""}`;
    return copy(kit, {
      subject: t("subject", { firm_name: firmName }),
      preheader: t("preheader"),
      heading: t("heading"),
      body: t(key, { firm_name: firmName, receipt_number: number ?? "" }),
      cta: cta(t("cta"), appLink(origin, PATHS.portalPayments)),
      spot: "receipt",
      brand: firmBrand(kit, context),
    });
  },
  EM12(kit, context) {
    const { t, origin } = kit;
    const reference = cleanText(context.matterReference ?? "", 40);
    return copy(kit, {
      subject: t("subject"),
      preheader: t("preheader"),
      heading: t("heading"),
      body: reference ? t("body_reference", { matter_reference: reference }) : t("body"),
      cta: cta(t("cta"), appLink(origin, PATHS.sheetTasks)),
      spot: "reminder",
      brand: PLATFORM,
    });
  },
  EM15(kit, context) {
    const { t, origin } = kit;
    const firmName = firm(kit, context);
    const consultant = name(context.consultantName);
    return copy(kit, {
      subject: t("subject"),
      preheader: t("preheader"),
      heading: t("subject"),
      body: consultant ? t("body_consultant", { firm_name: firmName, consultant_name: consultant }) : t("body", { firm_name: firmName }),
      cta: cta(t("cta"), appLink(origin, PATHS.portal)),
      spot: "receipt",
      brand: firmBrand(kit, context),
    });
  },
  EM16a(kit, context) {
    const { t, f, origin } = kit;
    const firmName = firm(kit, context);
    const when = f.dateTimeIn(context.startsAt, context.timeZone);
    const consultant = name(context.consultantName);
    const values = { date_time: when ?? "", time_zone_label: zoneLabel(kit, context.timeZone), consultant_name: consultant, firm_name: firmName };
    const lead = when ? t(consultant ? "when_consultant" : "when", values) : t(consultant ? "consultant" : "plain", values);
    let meet = "";
    switch (context.locationKind) {
      case "phone":
        meet = t("meet_phone", values);
        break;
      case "video":
      case "meeting_link":
        meet = t("meet_link", values);
        break;
      case "in_person": {
        const where = cleanText(context.address ?? "", 300).replace(/\.$/, "");
        meet = where ? t("meet_address", { address: where }) : t("meet_confirm_address", values);
        break;
      }
    }
    const parts = [lead, meet, context.portal ? "" : t("_shared.contact_to_change", values)].filter(Boolean);
    return copy(kit, {
      subject: t("subject", values),
      preheader: t("preheader"),
      heading: t("heading"),
      body: parts.join(" "),
      cta: context.portal ? cta(t("cta"), appLink(origin, PATHS.portalAppointments)) : null,
      spot: "reminder",
      brand: firmBrand(kit, context),
    });
  },
  EM16b(kit, context) {
    const { t, f, origin } = kit;
    const firmName = firm(kit, context);
    const when = f.dateTimeIn(context.startsAt, context.timeZone);
    const moved = when ? t("moved_when", { date_time: when, time_zone_label: zoneLabel(kit, context.timeZone) }) : t("moved");
    return copy(kit, {
      subject: t("subject", { firm_name: firmName }),
      preheader: context.portal ? t("preheader_portal") : t("preheader"),
      heading: t("heading"),
      body: context.portal
        ? when
          ? `${moved} ${t("reminders_moved")}`
          : t("portal_no_time")
        : `${moved} ${t("_shared.contact_to_change", { firm_name: firmName })}`,
      cta: context.portal ? cta(t("cta"), appLink(origin, PATHS.portalAppointments)) : null,
      spot: "reminder",
      brand: firmBrand(kit, context),
    });
  },
  EM16c(kit, context) {
    const { t, f, origin } = kit;
    const firmName = firm(kit, context);
    const when = f.dateTimeIn(context.startsAt, context.timeZone);
    const page = context.portal ? null : bookingPageHref(origin, context.bookingPage);
    const href = context.portal ? appLink(origin, PATHS.portalAppointments) : page;
    // Who cancelled: the attendee from their portal (the _self strings), or the firm.
    const self = context.cancelledBy === "client";
    const which = when
      ? t(self ? "body_when_self" : "body_when", { date_time: when, time_zone_label: zoneLabel(kit, context.timeZone), firm_name: firmName })
      : t(self ? "body_self" : "body", { firm_name: firmName });
    return copy(kit, {
      subject: t(self ? "subject_self" : "subject", { firm_name: firmName }),
      preheader: context.portal ? t("preheader_portal") : page ? t("preheader_page") : t("preheader"),
      heading: t("heading"),
      body: href ? which : `${which} ${t("contact_to_book", { firm_name: firmName })}`,
      cta: href ? cta(t("cta"), href) : null,
      spot: "reminder",
      brand: firmBrand(kit, context),
    });
  },
  EM17(kit, context) {
    const { t, f, origin } = kit;
    const approver = name(context.approverName) || t("default_approver");
    const minutes = countOrNull(context.minutes, 1440);
    const ends = f.dateTimeIn(context.endsAt, context.timeZone);
    const parts = [
      minutes ? t("approved_minutes", { approver_name: approver, minutes }) : t("approved", { approver_name: approver }),
      ends ? t("ends", { date_time: ends }) : "",
      t("audit"),
    ].filter(Boolean);
    return copy(kit, {
      subject: t("subject"),
      preheader: t("preheader"),
      heading: t("subject"),
      body: parts.join(" "),
      cta: cta(t("cta"), appLink(origin, PATHS.sheetGrants)),
      spot: "verify",
      brand: PLATFORM,
    });
  },
  EM18a(kit, context) {
    const { t, origin } = kit;
    return copy(kit, {
      subject: t("subject"),
      preheader: t("preheader"),
      heading: t("subject"),
      body: t("body", { firm_name: firm(kit, context) }),
      cta: cta(t("cta"), appLink(origin, PATHS.sheetSettings)),
      spot: "invoice",
      brand: PLATFORM,
    });
  },
  EM18b(kit, context) {
    const { t, origin } = kit;
    const days = countOrNull(context.daysPastDue, 3650);
    return copy(kit, {
      subject: t("subject", { firm_name: firm(kit, context) }),
      preheader: t("preheader"),
      heading: t("subject", { firm_name: firm(kit, context) }),
      body: days ? t("body_days", { days }) : t("body"),
      cta: cta(t("cta"), appLink(origin, PATHS.sheetSettings)),
      spot: "invoice",
      brand: PLATFORM,
    });
  },
  EM19a(kit, context) {
    const { t, origin } = kit;
    const hours = countOrNull(context.hours, 720);
    return copy(kit, {
      subject: t("subject"),
      preheader: t("preheader"),
      heading: t("subject"),
      body: hours ? t("body_hours", { hours }) : t("body"),
      cta: cta(t("cta"), appLink(origin, PATHS.sheetExports)),
      spot: "sign-in-code",
      brand: PLATFORM,
    });
  },
  EM19b(kit, context) {
    const { t, f, origin } = kit;
    const started = f.shortDate(context.startedOn);
    const hours = countOrNull(context.hoursLeft, 720);
    const key = `expires${started ? "_started" : ""}${hours ? (hours === 1 ? "_hour" : "_hours") : ""}`;
    return copy(kit, {
      subject: t("subject"),
      preheader: t("preheader"),
      heading: t("subject"),
      body: `${t(key, { short_date: started ?? "", hours: hours ?? "" })} ${t("after")}`,
      cta: cta(t("cta"), appLink(origin, PATHS.sheetExports)),
      spot: "sign-in-code",
      brand: PLATFORM,
    });
  },
  EX02(kit, context) {
    const { t, origin } = kit;
    const device = cleanText(context.device ?? "", 80);
    return copy(kit, {
      subject: t("subject"),
      preheader: t("preheader"),
      heading: t("heading"),
      body: device ? t("body_device", { firm_name: firm(kit, context), device }) : t("body", { firm_name: firm(kit, context) }),
      cta: cta(t("cta"), appLink(origin, PATHS.sheetSettings)),
      spot: "sign-in-code",
      brand: PLATFORM,
    });
  },
  EX03(kit, context) {
    const { t } = kit;
    const inviter = name(context.inviterName);
    const firmName = firm(kit, context);
    return copy(kit, {
      subject: t("subject", { firm_name: firmName }),
      preheader: t("preheader"),
      heading: t("heading"),
      body: inviter ? t("body_inviter", { firm_name: firmName, inviter_name: inviter }) : t("body", { firm_name: firmName }),
      spot: "staff-invite",
      brand: PLATFORM,
    });
  },
  EX04(kit, context) {
    const { t } = kit;
    const firmName = firm(kit, context);
    const link = safeUrl(context.acceptUrl);
    const lead = t("lead", { firm_name: firmName });
    return copy(kit, {
      subject: t("subject", { firm_name: firmName }),
      preheader: t("preheader"),
      heading: t("heading"),
      body: `${lead} ${link ? t("_shared.invite_expiry") : t("_shared.invite_without_link")}`,
      cta: cta(t("cta"), link),
      spot: "client-invite",
      brand: firmBrand(kit, context),
    });
  },
  EX05(kit, context) {
    const { t, origin } = kit;
    return copy(kit, {
      subject: t("subject"),
      preheader: t("preheader"),
      heading: t("subject"),
      body: t("body", { firm_name: firm(kit, context) }),
      cta: cta(t("cta"), appLink(origin, PATHS.portalDocuments)),
      spot: "document-requested",
      brand: firmBrand(kit, context),
    });
  },
  EX06(kit, context) {
    const { t, origin } = kit;
    const firmName = firm(kit, context);
    return copy(kit, {
      subject: t("subject"),
      preheader: t("preheader", { firm_name: firmName }),
      heading: t("subject"),
      body: t("body", { firm_name: firmName }),
      cta: cta(t("cta"), appLink(origin, PATHS.portalDocuments)),
      spot: "receipt",
      brand: firmBrand(kit, context),
    });
  },
  "EX06-received"(kit, context) {
    const { t, origin } = kit;
    const firmName = firm(kit, context);
    return copy(kit, {
      subject: t("subject", { firm_name: firmName }),
      preheader: t("preheader"),
      heading: t("heading"),
      body: t("body", { firm_name: firmName }),
      cta: cta(t("cta"), appLink(origin, PATHS.portalDocuments)),
      spot: "receipt",
      brand: firmBrand(kit, context),
    });
  },
  EX07(kit, context) {
    const { t, origin } = kit;
    const firmName = firm(kit, context);
    return copy(kit, {
      subject: t("subject", { firm_name: firmName }),
      preheader: t("preheader"),
      heading: t("heading"),
      body: t("body", { firm_name: firmName }),
      cta: cta(t("cta"), appLink(origin, PATHS.portalMessages)),
      spot: "reminder",
      brand: firmBrand(kit, context),
    });
  },
  EX08(kit, context) {
    const { t, origin } = kit;
    const firmName = firm(kit, context);
    const number = documentNumber(context.invoiceNumber, "INV");
    return copy(kit, {
      subject: t("subject", { firm_name: firmName }),
      preheader: t("preheader"),
      heading: t("heading"),
      body: number ? t("body_number", { firm_name: firmName, invoice_number: number }) : t("body", { firm_name: firmName }),
      cta: cta(t("cta"), invoiceHref(origin, context.invoiceId)),
      spot: "invoice",
      brand: firmBrand(kit, context),
    });
  },
  EX09(kit, context) {
    const { t, origin } = kit;
    const firmName = firm(kit, context);
    return copy(kit, {
      subject: t("subject", { firm_name: firmName }),
      preheader: t("preheader"),
      heading: t("heading"),
      body: t("body", { firm_name: firmName }),
      cta: cta(t("cta"), appLink(origin, PATHS.portalPayments)),
      spot: "receipt",
      brand: firmBrand(kit, context),
    });
  },
  EX10(kit, context) {
    const { t, origin } = kit;
    const firmName = firm(kit, context);
    return copy(kit, {
      subject: t("subject", { firm_name: firmName }),
      preheader: t("preheader"),
      heading: t("heading"),
      body: t("body", { firm_name: firmName }),
      cta: cta(t("cta"), appLink(origin, PATHS.portalPayments)),
      spot: "receipt",
      brand: firmBrand(kit, context),
    });
  },
  EX17(kit, context) {
    const { t, origin } = kit;
    const firmName = firm(kit, context);
    return copy(kit, {
      subject: t("subject", { firm_name: firmName }),
      preheader: t("preheader"),
      heading: t("heading"),
      body: t("body", { firm_name: firmName }),
      cta: cta(t("cta"), appLink(origin, PATHS.portal)),
      spot: "reminder",
      brand: firmBrand(kit, context),
    });
  },
  EX16(kit, context) {
    const { t } = kit;
    const firmName = firm(kit, context);
    const code = typeof context.code === "string" && /^\d{6}$/.test(context.code.trim()) ? context.code.trim() : null;
    return copy(kit, {
      subject: t("subject", { firm_name: firmName }),
      preheader: t("preheader"),
      heading: code ?? t("heading"),
      body: code ? t("body", { firm_name: firmName }) : t("body_missing", { firm_name: firmName }),
      spot: "sign-in-code",
      brand: firmBrand(kit, context),
    });
  },
  EX11(kit, context) {
    const { t, origin } = kit;
    const minutes = countOrNull(context.minutes, 1440);
    const firmName = firm(kit, context);
    return copy(kit, {
      subject: t("subject"),
      preheader: t("preheader"),
      heading: t("heading"),
      body: minutes ? t("body_minutes", { minutes, firm_name: firmName }) : t("body", { firm_name: firmName }),
      cta: cta(t("cta"), appLink(origin, PATHS.sheetGrants)),
      spot: "verify",
      brand: PLATFORM,
    });
  },
  EX12(kit, context) {
    const { t, origin } = kit;
    const consultant = name(context.consultantName);
    return copy(kit, {
      subject: t("subject"),
      preheader: t("preheader"),
      heading: t("subject"),
      body: consultant ? t("body_consultant", { consultant_name: consultant }) : t("body"),
      cta: cta(t("cta"), appLink(origin, PATHS.sheetLicence)),
      spot: "verify",
      brand: PLATFORM,
    });
  },
  EX13(kit, context) {
    const { t, f, origin } = kit;
    const firmName = firm(kit, context);
    const by = f.longDate(context.replyBy);
    return copy(kit, {
      subject: t("subject", { firm_name: firmName }),
      preheader: t("preheader"),
      heading: t("heading"),
      body: by ? t("body_by", { firm_name: firmName, due_date: by }) : t("body", { firm_name: firmName }),
      cta: cta(t("cta"), appLink(origin, PATHS.portal)),
      spot: "verify",
      brand: firmBrand(kit, context),
    });
  },
  EX14(kit, context) {
    const { t, f } = kit;
    const firmName = firm(kit, context);
    const by = f.longDate(context.respondBy);
    const handler = name(context.handlerName);
    const key = `body${by ? "_by" : ""}${handler ? "_handler" : ""}`;
    return copy(kit, {
      subject: t("subject", { firm_name: firmName }),
      preheader: t("preheader"),
      heading: t("heading"),
      body: t(key, { firm_name: firmName, due_date: by ?? "", handler_name: handler }),
      spot: "verify",
      brand: firmBrand(kit, context),
    });
  },
  generic(kit, context) {
    const { t, origin } = kit;
    const firmName = firm(kit, context);
    return copy(kit, {
      subject: t("subject", { firm_name: firmName }),
      preheader: t("preheader"),
      heading: t("heading"),
      body: t("body", { firm_name: firmName }),
      cta: { label: t("cta"), href: appLink(origin, PATHS.portal) ?? "" },
      spot: "reminder",
      brand: firmBrand(kit, context),
    });
  },
};

export const LOCALIZED_IDS = Object.keys(BUILDERS) as LocalizedId[];

/**
 * One email in one language. French uses the drafts as they are, whatever their status: callers
 * that SEND must go through french.ts (chooseEmailLanguage), which only allows approved French.
 */
export function buildLocalized<K extends LocalizedId>(
  id: K,
  lang: Lang,
  context: K extends keyof EmailContexts ? Ctx<K> : GenericContext,
  origin: string,
  drafted: DraftFile = FR_DRAFTS,
): EmailCopy {
  const kit: Kit = { t: translator(tableFor(lang, drafted), id), f: FORMATS[lang], lang, origin, drafted };
  return (BUILDERS[id] as (kit: Kit, context: unknown) => EmailCopy)(kit, context);
}

/** The shell strings (header tagline, footers) in a language, for layout.ts. */
export function shellText(lang: Lang, drafted: DraftFile = FR_DRAFTS): ShellText {
  const t = translator(tableFor(lang, drafted), "_shared");
  return { tagline: t("_shared.tagline"), footerFirm: t("_shared.footer_firm"), footerPlatform: t("_shared.footer_platform") };
}
