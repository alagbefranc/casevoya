/**
 * French email copy: parallel builders, the sending gate, and stale-draft detection.
 *
 * - buildLocalized(id, "en") equals the approved English builder for every template and branch,
 *   so the French builders share the English branches and English output cannot change.
 * - French builders keep placeholders filled, escape merge values, and link only where English
 *   links (the same fixed app paths).
 * - French is chosen only when the recipient prefers French AND the template is approved with a
 *   reviewer and date, the shared shell is approved, the English is unchanged and the
 *   placeholders match. Committed drafts are all machine drafts, so production sends English.
 * - The English-source hash: this suite FAILS when i18n-source.json changes and fr-drafts.json
 *   was not re-drafted (node scripts/i18n/draft-email-fr.mjs --check reports the same thing).
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { EMAIL_TEMPLATES, type EmailContexts, type TemplateId } from "@/modules/email/designs/catalog";
import { chooseEmailLanguage, frenchApproved, frenchBlocker } from "@/modules/email/designs/french";
import { renderCopy } from "@/modules/email/designs/layout";
import {
  EN_SOURCE,
  FR_DRAFTS,
  LOCALIZED_IDS,
  buildLocalized,
  fill,
  type DraftFile,
  type LocalizedId,
} from "@/modules/email/designs/localized";
import { dateTimeInFr, dayDateFr, longDateFr, shortDateFr } from "@/modules/email/designs/format";
import { renderEmail } from "@/modules/email/templates";
import { dispatchOutbound, type DispatchDeps } from "@/modules/email/dispatch";
import { frTypography, placeholders, samePlaceholders } from "@/modules/i18n/typography";
import { sourceHash, staleDrafts } from "../scripts/i18n/source-hash.mjs";

const ORIGIN = "https://app.casevoya.ca";
const FIRM = "Maple Example Immigration";
const INVOICE = "00000000-0000-4000-8000-000000000010";
const ACCEPT = "https://app.casevoya.ca/accept/client?token=" + "0".repeat(64);

type Catalogued = Exclude<LocalizedId, "generic">;

/** Every branch of every builder, with synthetic values only. */
const VARIANTS: { [K in Catalogued]: EmailContexts[K][] } = {
  EM01: [
    { firmName: FIRM, inviterName: "Sam Example", role: "case_manager", acceptUrl: ACCEPT },
    { firmName: FIRM, role: "assistant" },
    { firmName: "", inviterName: null, role: "nonsense", acceptUrl: "javascript:alert(1)" },
    ...["firm_owner", "licensed_consultant", "finance_user"].map((role) => ({ firmName: FIRM, role })),
  ],
  EM02: [{ firmName: FIRM, inviterName: "Sam Example", acceptUrl: ACCEPT }, { firmName: FIRM }, { firmName: FIRM, acceptUrl: ACCEPT }],
  EM05: [{}],
  EM06: [{ firmName: FIRM, dueOn: "2026-11-06" }, { firmName: FIRM }, { firmName: FIRM, dueOn: "2026-02-31" }],
  EM07: [{ firmName: FIRM, dueOn: "2026-10-30" }, { firmName: FIRM, dueOn: "2026-05-01" }, { firmName: FIRM }],
  EM08: [...["service", "consultation", "amendment", "consent", "quote", "other"].map((agreementKind) => ({ firmName: FIRM, agreementKind })), { firmName: FIRM }, { firmName: FIRM, agreementKind: "consultation", signingRef: "abcdefghijklmnopqrstuvwxyz" }],
  "EM08-staff": [{ firmName: FIRM }],
  EM09: [{ firmName: FIRM }],
  "EM09-staff": [{ firmName: FIRM }],
  EM10: [
    { firmName: FIRM, invoiceId: INVOICE, invoiceNumber: "INV-0001", dueOn: "2026-11-06" },
    { firmName: FIRM, invoiceNumber: "INV-0001" },
    { firmName: FIRM, invoiceId: "not-a-uuid", dueOn: "2026-11-06" },
    { firmName: FIRM, invoiceNumber: "bogus" },
  ],
  EM11: [
    { firmName: FIRM, receiptNumber: "PR-0001" },
    { firmName: FIRM, receiptNumber: "RC-0091", advance: true },
    { firmName: FIRM, advance: true },
    { firmName: FIRM },
  ],
  EM12: [{ matterReference: "CA-2026-0001" }, {}],
  EM15: [{ firmName: FIRM, consultantName: "Sam Example" }, { firmName: FIRM }],
  EM16a: [
    { firmName: FIRM, startsAt: "2026-10-22T14:30:00Z", timeZone: "America/Toronto", consultantName: "Sam Example", portal: true, locationKind: "phone" },
    { firmName: FIRM, startsAt: "2026-10-22T14:00:00Z", timeZone: "America/Edmonton", portal: false, locationKind: "video" },
    { firmName: FIRM, startsAt: "2026-10-22T14:30:00Z", timeZone: "America/Vancouver", portal: false, locationKind: "in_person", address: "1 Example Street." },
    { firmName: FIRM, consultantName: "Sam Example", portal: false, locationKind: "in_person" },
    { firmName: FIRM, portal: true, locationKind: "meeting_link" },
    { firmName: FIRM },
  ],
  EM16b: [
    { firmName: FIRM, startsAt: "2026-10-27T14:30:00Z", timeZone: "America/Toronto", portal: true },
    { firmName: FIRM, portal: true },
    { firmName: FIRM, startsAt: "2026-10-27T14:30:00Z", timeZone: "America/Montreal", portal: false },
    { firmName: FIRM, portal: false },
  ],
  EM16c: [
    { firmName: FIRM, startsAt: "2026-10-27T14:30:00Z", timeZone: "America/Toronto", portal: true },
    { firmName: FIRM, startsAt: "2026-10-27T14:30:00Z", timeZone: "America/Toronto", portal: true, cancelledBy: "client" },
    { firmName: FIRM, portal: false, cancelledBy: "client" },
    { firmName: FIRM, startsAt: "2026-10-27T14:30:00Z", timeZone: "America/Toronto", portal: false, bookingPage: "maple-example" },
    { firmName: FIRM, portal: false, bookingPage: "../evil" },
    { firmName: FIRM, portal: false },
  ],
  EM17: [
    { firmName: FIRM, approverName: "Sam Example", minutes: 60, endsAt: "2026-10-22T15:40:00Z", timeZone: "America/Toronto" },
    { firmName: FIRM },
  ],
  EM18a: [{ firmName: FIRM }],
  EM18b: [{ firmName: FIRM, daysPastDue: 21 }, { firmName: FIRM }],
  EM19a: [{ hours: 24 }, {}],
  EM19b: [
    { startedOn: "2026-10-16", hoursLeft: 2 },
    { startedOn: "2026-10-16", hoursLeft: 1 },
    { startedOn: "2026-10-16" },
    { hoursLeft: 2 },
    { hoursLeft: 1 },
    {},
  ],
  EX02: [{ firmName: FIRM, device: "Chrome on Windows" }, { firmName: FIRM }],
  EX03: [{ firmName: FIRM, inviterName: "Sam Example" }, { firmName: FIRM }],
  EX04: [{ firmName: FIRM, acceptUrl: ACCEPT }, { firmName: FIRM }],
  EX05: [{ firmName: FIRM }],
  EX06: [{ firmName: FIRM }],
  "EX06-received": [{ firmName: FIRM }],
  EX07: [{ firmName: FIRM }],
  EX08: [{ firmName: FIRM, invoiceId: INVOICE, invoiceNumber: "INV-0001" }, { firmName: FIRM }],
  EX09: [{ firmName: FIRM }],
  EX10: [{ firmName: FIRM }],
  EX11: [{ firmName: FIRM, minutes: 60 }, { firmName: FIRM }],
  EX12: [{ firmName: FIRM, consultantName: "Sam Example" }, { firmName: FIRM }],
  EX13: [{ firmName: FIRM, replyBy: "2026-11-11" }, { firmName: FIRM }],
  EX14: [
    { firmName: FIRM, respondBy: "2026-10-23", handlerName: "Sam Example" },
    { firmName: FIRM, respondBy: "2026-10-23" },
    { firmName: FIRM, handlerName: "Sam Example" },
    { firmName: FIRM },
  ],
};

const CATALOGUED = LOCALIZED_IDS.filter((id): id is Catalogued => id !== "generic");

function hrefs(html: string): string[] {
  return [...html.matchAll(/href="([^"]*)"/g)].map((match) => match[1]);
}

/** A copy of the committed drafts with the given templates (and _shared) approved by a named reviewer. */
function approved(ids: string[], drafted: DraftFile = FR_DRAFTS): DraftFile {
  const copy: DraftFile = structuredClone(drafted);
  for (const id of ["_shared", ...ids]) {
    const entry = copy.templates[id];
    entry.status = "approved";
    entry.reviewer = "Synthetic Reviewer, OTTIAQ";
    entry.reviewedOn = "2026-10-20";
    // A reviewer fixes placeholder problems before approving; mirror that for the synthetic copy.
    for (const item of Object.values(entry.strings)) if (!samePlaceholders(item.en, item.fr)) item.fr = item.en;
  }
  return copy;
}

describe("localized builders", () => {
  it("cover every catalog template except the EM14 French previews and EX15 (a staff member's own words)", () => {
    const catalog = (Object.keys(EMAIL_TEMPLATES) as TemplateId[]).filter((id) => !id.startsWith("EM14") && id !== "EX15");
    expect([...CATALOGUED].sort()).toEqual([...catalog].sort());
    expect(Object.keys(EN_SOURCE).sort()).toEqual(["_shared", ...LOCALIZED_IDS].sort());
  });

  it.each(CATALOGUED)("%s in English equals the approved English builder in every branch", (id) => {
    for (const context of VARIANTS[id]) {
      const english = (EMAIL_TEMPLATES[id].build as (c: unknown, o: string) => unknown)(context, ORIGIN);
      expect(buildLocalized(id, "en", context as never, ORIGIN), JSON.stringify(context)).toEqual(english);
    }
  });

  it("the English generic notice equals renderEmail's fallback", () => {
    const viaWorker = renderEmail({ template: "something_new", firm: FIRM });
    const parallel = renderCopy(buildLocalized("generic", "en", { firmName: FIRM }, ORIGIN), ORIGIN);
    expect(parallel).toEqual({ subject: viaWorker.subject, preheader: viaWorker.preheader, html: viaWorker.html, text: viaWorker.text });
  });

  it.each(CATALOGUED)("%s in French fills every placeholder and links where English links", (id) => {
    // A draft whose placeholders differ from the English can leave one unfilled; the gate never
    // sends it (asserted in "stale drafts" below), so only well-formed drafts are checked here.
    const wellFormed = [id, "_shared"].every((key) =>
      Object.values(FR_DRAFTS.templates[key].strings).every((item) => samePlaceholders(item.en, item.fr)),
    );
    for (const context of VARIANTS[id]) {
      const fr = renderCopy(buildLocalized(id, "fr", context as never, ORIGIN), ORIGIN);
      const en = renderCopy((EMAIL_TEMPLATES[id].build as (c: unknown, o: string) => never)(context, ORIGIN), ORIGIN);
      if (wellFormed) for (const part of [fr.subject, fr.preheader, fr.text]) expect(part).not.toMatch(/\{[a-z_]+\}/);
      expect(fr.html).toContain('<html lang="fr"');
      expect(hrefs(fr.html)).toEqual(hrefs(en.html));
      expect(fr.html).not.toContain("Your immigration file");
    }
  });

  it("French escapes merge values like English and drops unsafe links", () => {
    const hostile = `<img src=x onerror=alert(1)>"'&\nBcc: x@evil.test`;
    for (const id of ["EM02", "EM06", "EM16a", "EX14"] as const) {
      const context = { ...VARIANTS[id][0], firmName: hostile, consultantName: hostile, handlerName: hostile, acceptUrl: "javascript:alert(1)" };
      const email = renderCopy(buildLocalized(id, "fr", context as never, ORIGIN), ORIGIN);
      expect(email.html).not.toContain("<img src=x");
      expect(email.html).toContain("&lt;img src=x onerror=alert(1)&gt;");
      expect(email.subject).not.toMatch(/[\n\r]/);
      expect(email.html).not.toContain("javascript:");
    }
  });

  it("formats French dates and times the OQLF way, in the same zone as English", () => {
    expect(longDateFr("2026-11-06")).toBe("6 novembre 2026");
    expect(longDateFr("2026-05-01")).toBe("1er mai 2026");
    expect(dayDateFr("2026-10-20")).toBe("mardi 20 octobre 2026");
    expect(shortDateFr("2026-10-30")).toBe("30 oct.");
    expect(dateTimeInFr("2026-10-22T14:30:00Z", "America/Toronto")).toBe("jeudi 22 octobre 2026 à 10 h 30");
    expect(dateTimeInFr("2026-10-22T14:00:00Z", "America/Vancouver")).toBe("jeudi 22 octobre 2026 à 7 h");
    expect(dateTimeInFr("2026-10-23T03:30:00Z", "America/Toronto")).toBe("jeudi 22 octobre 2026 à 23 h 30");
    expect(dateTimeInFr("not a date", "America/Toronto")).toBeNull();
    const fr = buildLocalized("EM16a", "fr", VARIANTS.EM16a[1], ORIGIN);
    expect(fr.body).toContain("heure d’Edmonton");
  });

  it("fill replaces placeholders once and never reads braces inside a value", () => {
    expect(fill("{a} and {b}", { a: "{b}", b: "x" })).toBe("{b} and x");
    expect(fill("{missing}", {})).toBe("{missing}");
  });
});

describe("French sending gate", () => {
  it("every committed draft is a machine or hand draft: nothing is approved yet", () => {
    for (const [id, entry] of Object.entries(FR_DRAFTS.templates)) {
      expect(entry.status, id).toBe("machine_draft");
      expect(entry.reviewer, id).toBeNull();
      expect(frenchApproved(id), id).toBe(false);
    }
  });

  it("production is unchanged: a French-preferring recipient still gets the English email", () => {
    const contexts = [
      { template: "document_request", firm: FIRM, due_on: "2026-11-06" },
      { template: "invoice", firm: FIRM, invoice_id: INVOICE, invoice_number: "INV-0001", due_on: "2026-11-06" },
      { template: "consultation_booked", firm: FIRM, starts_at: "2026-10-22T14:30:00Z", time_zone: "America/Toronto", portal: true, location_kind: "phone" },
      { template: "something_new", firm: FIRM },
    ];
    for (const context of contexts) {
      const english = renderEmail(context);
      const french = renderEmail({ ...context, locale: "fr-CA" });
      expect(french).toEqual(english);
      expect(french.lang).toBe("en");
    }
  });

  it("chooses French only when the recipient prefers it AND the template is approved", () => {
    const drafts = approved(["EM06"]);
    expect(chooseEmailLanguage("EM06", "fr-CA", drafts)).toBe("fr");
    expect(chooseEmailLanguage("EM06", "en-CA", drafts)).toBe("en");
    expect(chooseEmailLanguage("EM06", undefined, drafts)).toBe("en");
    expect(chooseEmailLanguage("EM06", "es", drafts)).toBe("en");
    expect(chooseEmailLanguage("EM07", "fr-CA", drafts)).toBe("en");
  });

  it("refuses approval without a named reviewer and date, with a draft shell, when stale, or with broken placeholders", () => {
    const base = approved(["EM06"]);
    expect(frenchBlocker("EM06", base)).toBeNull();

    const noReviewer = structuredClone(base);
    noReviewer.templates.EM06.reviewer = null;
    expect(frenchBlocker("EM06", noReviewer)).toBe("no_reviewer");

    const noDate = structuredClone(base);
    noDate.templates.EM06.reviewedOn = "soon";
    expect(frenchBlocker("EM06", noDate)).toBe("no_review_date");

    const shellDraft = structuredClone(base);
    shellDraft.templates._shared.status = "machine_draft";
    expect(frenchApproved("EM06", shellDraft)).toBe(false);

    const stale = structuredClone(base);
    stale.templates.EM06.strings.body.en = "An older English sentence.";
    expect(frenchBlocker("EM06", stale)).toBe("stale");

    const broken = structuredClone(base);
    broken.templates.EM06.strings.body_due.fr = "Veuillez téléverser un document.";
    expect(frenchBlocker("EM06", broken)).toBe("placeholders");
  });

  it("an approved template renders in French through the worker's renderEmail", async () => {
    vi.resetModules();
    vi.doMock("@/modules/email/designs/fr-drafts.json", () => ({ default: approved(["EM06"]) }));
    const { renderEmail: render } = await import("@/modules/email/templates");
    const french = render({ template: "document_request", firm: FIRM, due_on: "2026-11-06", locale: "fr-CA" });
    expect(french.lang).toBe("fr");
    expect(french.html).toContain('<html lang="fr"');
    expect(french.text).toContain("6 novembre 2026");
    expect(hrefs(french.html)).toContain(`${ORIGIN}/portal/documents`);
    // Same template, English-preferring recipient; and an unapproved template for a French one.
    expect(render({ template: "document_request", firm: FIRM, due_on: "2026-11-06", locale: "en-CA" }).lang).toBe("en");
    expect(render({ template: "reminder", firm: FIRM, due_on: "2026-10-30", locale: "fr-CA" }).lang).toBe("en");
  });

  it("the mail worker passes each recipient's locale and sends English when the lookup fails", async () => {
    const sent: { to: string; subject: string; html: string }[] = [];
    const messages = ["a@example.test", "b@example.test"].map((to, index) => ({
      delivery_id: `d${index}`,
      to,
      from_address: "notices@casevoya.ca",
      from_name: FIRM,
      reply_to_address: "reply@docs.casevoya.ca",
      reply_to_name: FIRM,
      template: "document_request",
      context: { firm: FIRM, due_on: "2026-11-06", locale: "fr-CA" },
    }));
    const deps = (locales: DispatchDeps["locales"]): DispatchDeps => ({
      claim: async () => [{ id: "e1" }],
      prepare: async () => ({ action: "send", messages }),
      send: async (email) => {
        sent.push({ to: email.to, subject: email.subject, html: email.html });
        return { ok: true, messageId: "m", queued: [], permanentBounces: [], suppressed: [] } as never;
      },
      finish: async () => {},
      locales,
    });
    const options = { worker: "w", limit: 1, inboundDomain: "docs.casevoya.ca", fromAddress: "notices@casevoya.ca" };
    const seen: string[][] = [];
    await dispatchOutbound(deps(async (ids) => (seen.push(ids), { d0: "fr-CA", d1: "en-CA" })), options);
    expect(seen).toEqual([["d0", "d1"]]);
    await dispatchOutbound(deps(async () => { throw new Error("rpc down"); }), options);
    // Nothing is approved, so every send is the English email, whatever the locale; a stale
    // locale already in the context is never trusted.
    const english = renderEmail({ template: "document_request", firm: FIRM, due_on: "2026-11-06" });
    expect(sent).toHaveLength(4);
    for (const email of sent) expect(email.html).toBe(english.html);
  });

  afterEach(() => {
    vi.doUnmock("@/modules/email/designs/fr-drafts.json");
    vi.resetModules();
  });
});

describe("stale drafts", () => {
  it("every draft matches the current English source (re-draft and re-review when this fails)", () => {
    expect(staleDrafts(EN_SOURCE, FR_DRAFTS)).toEqual([]);
    for (const [id, strings] of Object.entries(EN_SOURCE)) expect(FR_DRAFTS.templates[id].sourceHash, id).toBe(sourceHash(strings));
  });

  it("flags a template whose English changed", () => {
    const source = structuredClone(EN_SOURCE);
    source.EM06.body = "Please upload one document to your file.";
    expect(staleDrafts(source, FR_DRAFTS)).toEqual(["EM06"]);
  });

  it("drafts record model, prompt version and date, and machine drafts are labelled as such", () => {
    for (const [id, entry] of Object.entries(FR_DRAFTS.templates)) {
      expect(entry.model, id).toBe("@cf/meta/llama-3.3-70b-instruct-fp8-fast");
      expect(entry.promptVersion, id).toMatch(/^fr-ca-/);
      expect(entry.draftedOn, id).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      for (const item of Object.values(entry.strings)) expect(["machine", "hand", "reviewer"]).toContain(item.origin);
    }
  });

  it("lists the drafts whose placeholders differ so the reviewer fixes them first", () => {
    const mismatched = Object.entries(FR_DRAFTS.templates).flatMap(([id, entry]) =>
      Object.entries(entry.strings)
        .filter(([, item]) => !samePlaceholders(item.en, item.fr))
        .map(([key, item]) => {
          expect(item.note, `${id}.${key}`).toMatch(/PLACEHOLDERS/);
          return `${id}.${key}`;
        }),
    );
    // Machine drafts may be wrong; the gate refuses them even if someone approves the template.
    for (const key of mismatched) expect(frenchBlocker(key.split(".")[0], approvedWithoutFix(key.split(".")[0]))).toBe("placeholders");
  });
});

function approvedWithoutFix(id: string): DraftFile {
  const copy: DraftFile = structuredClone(FR_DRAFTS);
  copy.templates[id].status = "approved";
  copy.templates[id].reviewer = "Synthetic Reviewer";
  copy.templates[id].reviewedOn = "2026-10-20";
  return copy;
}

describe("fr-CA typography", () => {
  it("adds OQLF spaces without touching URLs, times or placeholders", () => {
    expect(frTypography("Note: voir « ici » ; vraiment?")).toBe("Note\u00a0: voir «\u00a0ici\u00a0»\u202f; vraiment\u202f?");
    expect(frTypography("https://app.casevoya.ca/portal?invoice=1 à 10:30")).toBe("https://app.casevoya.ca/portal?invoice=1 à 10:30");
    expect(frTypography("l'avance {firm_name}")).toBe("l’avance {firm_name}");
    expect(placeholders("{b} {a} {a}")).toEqual(["{a}", "{a}", "{b}"]);
  });
});
