import { existsSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { EMAIL_TEMPLATES, INVITE_WITHOUT_LINK, renderTemplate, type TemplateId } from "@/modules/email/designs/catalog";
import { firmInitial, renderCopy, safeUrl } from "@/modules/email/designs/layout";
import { dateTimeIn, dayDate, longDate, shortDate } from "@/modules/email/designs/format";
import { designFor, renderEmail } from "@/modules/email/templates";

const ORIGIN = "https://app.casevoya.ca";
const IDS = Object.keys(EMAIL_TEMPLATES) as TemplateId[];
const PUBLIC = path.resolve(__dirname, "..", "public");

// Example data from the Designer export. None of it may reach a real email.
const EXAMPLE_DATA =
  /Northline|Amara|Osei|Rafael|Olena|Kofi|Mensah|Daniel Ruiz|Ana Ferreira|NL-2026|INV-0218|RC-0091|482 913|615 204|police clearance|spousal|sponsorship|nl\.casevoya\.example/i;

function render(id: TemplateId, context = EMAIL_TEMPLATES[id].sample, origin = ORIGIN) {
  return renderCopy(renderTemplate(id, context as never, origin), origin);
}

function hrefs(html: string): string[] {
  return [...html.matchAll(/href="([^"]*)"/g)].map((match) => match[1].replaceAll("&amp;", "&"));
}

function imageUrls(html: string): string[] {
  const src = [...html.matchAll(/src="([^"]*)"/g)].map((match) => match[1]);
  const srcset = [...html.matchAll(/srcset="([^" ]*) 2x"/g)].map((match) => match[1]);
  return [...src, ...srcset];
}

function hostile(sample: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(sample)) {
    if (/url$/i.test(key)) out[key] = "javascript:alert(1)";
    else if (typeof value === "string") out[key] = `<img src=x onerror=alert(1)>"'&\nBcc: x@evil.test`;
    else out[key] = value;
  }
  return out;
}

describe("approved email designs", () => {
  it("covers every Designer email except the Supabase Auth ones, with status and trigger", () => {
    const designerIds = [
      "EM01", "EM02", "EM05", "EM06", "EM07", "EM08", "EM09", "EM10", "EM11", "EM12", "EM14a", "EM14b", "EM14c", "EM15",
      "EM16a", "EM16b", "EM16c", "EM17", "EM18a", "EM18b", "EM19a", "EM19b", "EX02", "EX03", "EX04", "EX05", "EX06",
      "EX07", "EX08", "EX09", "EX10", "EX11", "EX12", "EX13", "EX14",
    ];
    for (const id of designerIds) expect(IDS, id).toContain(id);
    for (const id of IDS) {
      const def = EMAIL_TEMPLATES[id];
      expect(def.id).toBe(id);
      expect(["wired", "ready-not-wired", "deferred"]).toContain(def.status);
      expect(def.trigger.length).toBeGreaterThan(10);
    }
    for (const id of ["EM14a", "EM14b", "EM14c"] as const) expect(EMAIL_TEMPLATES[id].status).toBe("deferred");
    expect(EMAIL_TEMPLATES.EM11.status).toBe("ready-not-wired");
  });

  it.each(IDS)("%s has a subject, preheader, text alternative and no example data", (id) => {
    const email = render(id);
    for (const value of [email.subject, email.preheader]) {
      expect(value.trim().length).toBeGreaterThan(5);
      expect(value.length).toBeLessThanOrEqual(90);
      expect(value).not.toMatch(/[\n\r—]/);
    }
    expect(email.text.trim().length).toBeGreaterThan(30);
    expect(email.text).not.toContain("—");
    expect(email.html).toContain(`<title>`);
    expect(email.html).toContain("display:none");
    expect(email.html).not.toMatch(EXAMPLE_DATA);
    expect(email.text).not.toMatch(EXAMPLE_DATA);
    expect(email.html).not.toContain("header-firm");
  });

  it.each(IDS)("%s links only to absolute app URLs, never #", (id) => {
    const def = EMAIL_TEMPLATES[id];
    const email = render(id);
    const links = hrefs(email.html);
    expect(links).not.toContain("#");
    if (def.ctaTarget) expect(links.length, `${id} has a button`).toBe(1);
    else expect(links).toEqual([]);
    for (const link of links) {
      expect(safeUrl(link)).toBe(link);
      expect(link.startsWith(`${ORIGIN}/`)).toBe(true);
      expect(email.text).toContain(link);
    }
    const target = def.ctaTarget;
    if (target?.startsWith("/")) expect(links[0].startsWith(`${ORIGIN}${target.split("?")[0]}`)).toBe(true);
  });

  it.each(IDS)("%s builds its own links on the origin it is given", (id) => {
    const def = EMAIL_TEMPLATES[id];
    if (!def.ctaTarget?.startsWith("/")) return;
    const email = render(id, def.sample, "https://staging.example.test");
    expect(hrefs(email.html)[0].startsWith("https://staging.example.test/")).toBe(true);
    for (const url of imageUrls(email.html)) expect(url.startsWith("https://staging.example.test/assets/email/")).toBe(true);
  });

  it.each(IDS)("%s loads only images that ship in public/assets/email", (id) => {
    const email = render(id);
    const urls = imageUrls(email.html);
    expect(urls.length).toBeGreaterThanOrEqual(3);
    for (const url of urls) {
      expect(url.startsWith(`${ORIGIN}/assets/email/`), url).toBe(true);
      expect(existsSync(path.join(PUBLIC, new URL(url).pathname)), url).toBe(true);
    }
    // Fonts come from the marketing site, as in the approved export (it serves them with CORS).
    for (const font of email.html.matchAll(/url\((https:[^)]+)\)/g)) {
      expect(font[1], font[1]).toMatch(/^https:\/\/casevoya\.ca\/fonts\/Erode-(Regular|Medium)\.woff2$/);
    }
  });

  it.each(IDS)("%s escapes every merge value and drops unsafe links", (id) => {
    const email = render(id, hostile(EMAIL_TEMPLATES[id].sample as Record<string, unknown>) as never);
    expect(email.html).not.toContain("<img src=x");
    expect(email.html).not.toContain("javascript:");
    expect(email.text).not.toContain("javascript:");
    expect(email.subject).not.toMatch(/[\n\r]/);
    expect(email.html).not.toMatch(/Bcc: x@evil\.test\n/);
    for (const link of hrefs(email.html)) expect(link.startsWith(`${ORIGIN}/`)).toBe(true);
  });

  it("draws the firm header in HTML with the firm's name, and keeps the Casevoya header for platform mail", () => {
    const firm = renderEmail({ template: "invoice", firm: "Maple & Birch Immigration", invoice_number: "INV-0007", due_on: "2026-11-06" });
    expect(firm.html).toContain("Maple &amp; Birch Immigration</td>");
    expect(firm.html).toContain(">M</td>");
    // ORG-01: each firm email says what it is about, not one line for every email.
    expect(firm.html).toContain(">Invoices</td>");
    expect(firm.html).not.toContain("Your immigration file");
    expect(firm.html).toContain("Sent by Maple &amp; Birch Immigration via Casevoya");
    expect(firm.html).not.toContain("header-platform");
    expect(firm.html).not.toContain("header-firm");
    const platform = renderEmail({ template: "invite", kind: "staff", firm: "Maple & Birch Immigration", role: "assistant" });
    expect(platform.html).toContain(`${ORIGIN}/assets/email/header-platform.png`);
    expect(platform.html).toContain(`${ORIGIN}/assets/email/logo.png`);
    expect(platform.text).toContain("You’ve been invited as an Assistant.");
    expect(firmInitial("  élan Conseils")).toBe("É");
    expect(firmInitial("***")).toBe("•");
  });

  it("maps every database template to its design", () => {
    const cases: [Record<string, unknown>, string][] = [
      [{ template: "invite", kind: "staff" }, "EM01"],
      [{ template: "invite", kind: "portal", role: "client" }, "EM02"],
      [{ template: "invite", kind: "portal", role: "sponsor" }, "EM02"],
      [{ template: "invite", kind: "portal", role: "adult_dependant" }, "EX04"],
      [{ template: "reminder" }, "EM07"],
      [{ template: "agreement" }, "EM08"],
      [{ template: "agreement", audience: "staff" }, "EM08-staff"],
      [{ template: "signature" }, "EM09"],
      [{ template: "signature", audience: "staff" }, "EM09-staff"],
      [{ template: "document_request" }, "EM06"],
      [{ template: "document_receipt", status: "accepted" }, "EX06"],
      [{ template: "document_receipt", status: "received" }, "EX06-received"],
      [{ template: "document_receipt" }, "EX06-received"],
      [{ template: "invoice" }, "EM10"],
      [{ template: "payment_failed" }, "EX08"],
      [{ template: "refund_started" }, "EX09"],
      [{ template: "refund_complete" }, "EX10"],
      [{ template: "refund_failed", refund_reason: "lost_or_stolen_card" }, "EX20"],
      [{ template: "payment_receipt" }, "EM11"],
      [{ template: "support_requested", minutes: 60 }, "EX11"],
      [{ template: "support_granted", approver: "Sam Example", minutes: 60, ends_at: "2026-10-22T15:40:00Z", time_zone: "America/Toronto" }, "EM17"],
      [{ template: "something_new" }, "generic"],
    ];
    for (const [context, design] of cases) {
      expect(designFor(context), JSON.stringify(context)).toBe(design);
      const email = renderEmail({ firm: "Maple Example", ...context });
      expect(email.design).toBe(design);
      expect(email.subject.length).toBeGreaterThan(5);
      expect(email.preheader.length).toBeGreaterThan(5);
      expect(email.text).not.toMatch(EXAMPLE_DATA);
      expect(hrefs(email.html)).not.toContain("#");
    }
  });

  it("puts the invoice in the button and its number and due date in the copy, never the amount", () => {
    const invoiceId = "3f0c6a52-1b2d-4e8f-9a7b-0c1d2e3f4a5b";
    const email = renderEmail({
      template: "invoice",
      firm: "Maple Example",
      invoice_id: invoiceId,
      invoice_number: "INV-0042",
      due_on: "2026-11-06",
      amount_cents: 125000,
    });
    expect(email.subject).toBe("New invoice from Maple Example");
    expect(email.text).toContain("Invoice INV-0042 has a balance due on 6 November 2026.");
    expect(email.text).toContain(`View invoice: ${ORIGIN}/portal/payments?invoice=${invoiceId}`);
    expect(email.text).not.toMatch(/1,?250|125000|\$/);
    const odd = renderEmail({ template: "invoice", firm: "Maple Example", invoice_id: "../../x", invoice_number: "<b>9</b>" });
    expect(odd.text).toContain(`View invoice: ${ORIGIN}/portal/payments\n`);
    expect(odd.text).toContain("Your invoice is ready.");
    const failed = renderEmail({ template: "payment_failed", firm: "Maple Example", invoice_id: invoiceId, invoice_number: "INV-0042" });
    expect(failed.text).toContain("for invoice INV-0042 didn’t go through. You haven’t been charged.");
  });

  it("keeps the invitation's sealed link the only link taken from the context", () => {
    const evil = renderEmail({ template: "reminder", firm: "Maple Example", link: "https://evil.example/x", due_on: "2026-10-30" });
    expect(evil.html).not.toContain("evil.example");
    expect(evil.subject).toBe("A step on your file is due 30 Oct");
    expect(evil.text).toContain("due Friday 30 October 2026");
    const invite = renderEmail({ template: "invite", kind: "portal", role: "adult_dependant", firm: "Maple Example", link: `${ORIGIN}/accept/family?token=${"b".repeat(64)}` });
    expect(invite.text).toContain(`Set up your login: ${ORIGIN}/accept/family?token=`);
    const linkless = renderEmail({ template: "invite", kind: "portal", role: "adult_dependant", firm: "Maple Example" });
    expect(linkless.text).toContain(INVITE_WITHOUT_LINK);
    expect(hrefs(linkless.html)).toEqual([]);
  });

  it("formats dates without guessing", () => {
    expect(longDate("2026-11-06")).toBe("6 November 2026");
    expect(dayDate("2026-10-30")).toBe("Friday 30 October 2026");
    expect(shortDate("2026-10-30T12:00:00Z")).toBe("30 Oct");
    expect(longDate("2026-02-30")).toBeNull();
    expect(longDate("tomorrow")).toBeNull();
    expect(dateTimeIn("2026-10-22T14:30:00Z", "America/Toronto")).toBe("Thursday 22 October 2026, 10:30");
    expect(dateTimeIn("2026-10-22T14:30:00Z", "Not/AZone")).toBeNull();
  });
});
