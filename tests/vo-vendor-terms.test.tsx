import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { SheetAi } from "@/components/sheet/designer/ai";
import { aiPage, aiSettings, effectiveSettings, type VoViewer } from "@/modules/sheet/vo-present";
import { NOT_STATED, VO_TERMS_DIALOG, vendorTermsPanel } from "@/modules/sheet/vo-vendor-terms-present";
import { unstatedFields, VENDOR_FIELDS, VO_VENDOR_TERMS } from "@/modules/vo/vendor-terms";

/**
 * AI-06: the AI vendor terms panel (Settings > Vo) and the owner's acknowledgement before Vo is
 * turned on. The content is the vendors' own words with page, section, page date, retrieval date
 * and page hash; nothing is shown that a vendor page doesn't state.
 */
const ORG = "00000000-0000-4000-8000-000000000001";
const viewer: VoViewer = { organizationId: ORG, firmName: "Synthetic Firm", isOwner: true, sampleMode: false, agentReady: true, timeZone: "America/Toronto" };
const ALLOWED_HOSTS = ["www.anthropic.com", "privacy.claude.com", "platform.claude.com", "developers.cloudflare.com", "www.cloudflare.com"];

describe("reviewed vendor terms configuration", () => {
  it("cites a vendor page for every value, with section, retrieval date and page hash", () => {
    expect(VO_VENDOR_TERMS.version).toMatch(/^\d{4}-\d{2}-\d{2}\.\d{1,3}$/);
    expect(VO_VENDOR_TERMS.reviewedOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(VO_VENDOR_TERMS.vendors.map((vendor) => vendor.key)).toEqual(["anthropic", "cloudflare"]);
    for (const vendor of VO_VENDOR_TERMS.vendors) {
      expect(Object.keys(vendor.fields).sort()).toEqual([...VENDOR_FIELDS].sort());
      for (const link of vendor.terms) expect(ALLOWED_HOSTS).toContain(new URL(link.url).host);
      for (const field of VENDOR_FIELDS) {
        for (const statement of vendor.fields[field]) {
          expect(statement.quote.trim().length).toBeGreaterThan(10);
          const url = new URL(statement.source.url);
          expect(url.protocol).toBe("https:");
          expect(ALLOWED_HOSTS).toContain(url.host);
          expect(statement.source.section.trim()).not.toBe("");
          expect(statement.source.retrievedOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);
          expect(statement.source.sha256).toMatch(/^[0-9a-f]{64}$/);
        }
      }
    }
  });

  it("writes each of Casevoya's commitments to a quoted CICC Code section on Justice Laws, marked approved by Casevoya", () => {
    const { commitments } = VO_VENDOR_TERMS;
    expect(commitments.status).toBe("Casevoya’s terms, written to the CICC Code; approved by Casevoya on 25 Oct 2026");
    expect(commitments.source).toMatchObject({ currentTo: "2026-09-30", retrievedOn: "2026-10-25" });
    expect(commitments.source.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(commitments.items.map((item) => item.obligation.section)).toEqual(["28(1)", "28(3)", "24(3)(q)", "38(2)", "19(2)(e)", "37"]);
    for (const item of commitments.items) {
      const url = new URL(item.obligation.url);
      expect(`${url.host}${url.pathname}`).toBe("laws-lois.justice.gc.ca/eng/regulations/SOR-2022-128/FullText.html");
      expect(url.hash).toMatch(/^#(s-\d+|\d{7})$/);
      expect(item.obligation.quote.length).toBeGreaterThan(40);
      expect(item.commitment.length).toBeGreaterThan(0);
    }
    // Only the signed agreement's existence and date are recorded, never its contents.
    for (const vendor of VO_VENDOR_TERMS.vendors) expect(vendor.agreement).toMatchObject({ effectiveOn: "2026-10-20", note: "On file with Casevoya; available on request." });
  });

  it("lists exactly what the vendors' published pages don't state", () => {
    expect(unstatedFields()).toEqual(["Cloudflare: Processing region"]);
  });

  it("has the same version as the latest migration that defines app.vo_vendor_terms_version()", () => {
    const dir = path.join(process.cwd(), "supabase", "migrations");
    const files = readdirSync(dir)
      .filter((file) => file.endsWith(".sql"))
      .sort()
      .filter((file) => /function app\.vo_vendor_terms_version\(\)/.test(readFileSync(path.join(dir, file), "utf8")));
    expect(files.length).toBeGreaterThan(0);
    const sql = readFileSync(path.join(dir, files[files.length - 1]), "utf8");
    const match = /function app\.vo_vendor_terms_version\(\)[\s\S]*?select '([^']+)'::text/.exec(sql);
    expect(match?.[1]).toBe(VO_VENDOR_TERMS.version);
  });
});

describe("AI vendor terms panel", () => {
  it("asks the owner to acknowledge the current version before Vo is first turned on", () => {
    const panel = vendorTermsPanel({ organizationId: ORG, isOwner: true, enabled: false, timeZone: viewer.timeZone, acks: [] });
    expect(panel.acknowledged).toBe(false);
    expect(panel.status.badge).toMatchObject({ label: "Not acknowledged" });
    expect(panel.action).toEqual({ label: "Review and acknowledge", attrs: { "data-dlg": VO_TERMS_DIALOG } });
    expect(panel.dialog?.accept).toEqual({
      label: "Acknowledge and turn Vo on",
      attrs: { "data-vo-terms-ack": VO_VENDOR_TERMS.version, "data-turn-on": "1", "data-org": ORG },
    });
    expect(panel.dialog?.points.map((point) => point.title)).toEqual([
      "Anthropic: Claude API",
      "Cloudflare: Workers AI",
      `${NOT_STATED} (vendor’s public pages)`,
      "Casevoya’s commitments",
    ]);
    expect(panel.dialog?.points[0].detail).toContain("Signed agreement with Casevoya, effective 20 Oct 2026. On file with Casevoya; available on request.");
    // Every vendor field is either quoted with its source or said to be not stated.
    for (const vendor of panel.vendors) {
      expect(vendor.rows.map((row) => row.term)).toEqual(["Data use (training)", "Retention", "Processing region", "Subprocessors", "Deletion"]);
      for (const row of vendor.rows) expect(row.quotes.length > 0 || row.unstated === NOT_STATED).toBe(true);
      expect(vendor.reviewed).toBe("25 Oct 2026, Casevoya platform team");
      // Francis: a signed agreement with each vendor; its text isn't reproduced, only that it exists.
      expect(vendor.agreement).toEqual({
        title: `Signed agreement between ${vendor.vendor} and Casevoya`,
        text: "Signed agreement with Casevoya, effective 20 Oct 2026. On file with Casevoya; available on request.",
        precedence: "It takes precedence over the vendor’s published terms below.",
      });
      expect(vendor.published.term).toBe("Vendor’s published terms (for reference)");
    }
    const anthropic = panel.vendors[0].rows[0].quotes[0];
    expect(anthropic.cite).toMatchObject({ href: "https://www.anthropic.com/legal/commercial-terms#b-customer-content", detail: "B. Customer Content · Effective Jun 17, 2025 · retrieved 24 Oct 2026" });
    expect(panel.vendors[1].rows[2]).toEqual({ term: "Processing region", quotes: [], unstated: NOT_STATED });
  });

  it("shows who acknowledged and when, in the firm's time zone, and asks again after the terms change", () => {
    const done = vendorTermsPanel({ organizationId: ORG, isOwner: true, enabled: true, timeZone: "America/Toronto", acks: [{ version: VO_VENDOR_TERMS.version, at: "2026-10-25T02:30:00Z", by: "Amara Osei" }] });
    expect(done.acknowledged).toBe(true);
    expect(done.status.badge).toEqual({ tone: "ok", label: "Acknowledged", detail: "24 Oct 2026" });
    expect(done.status.text).toContain("Amara Osei acknowledged these terms on 24 Oct 2026");
    expect(done.action).toBeNull();
    expect(done.dialog).toBeNull();
    const changed = vendorTermsPanel({ organizationId: ORG, isOwner: true, enabled: false, timeZone: "America/Toronto", acks: [{ version: "2026-01-01.1", at: "2026-01-02T15:00:00Z", by: "Amara Osei" }] });
    expect(changed.status.badge.label).toBe("Terms changed");
    expect(changed.status.text).toContain("acknowledged terms version 2026-01-01.1 on 2 Jan 2026");
    expect(changed.dialog?.accept.attrs["data-turn-on"]).toBe("1");
  });

  it("lets only the owner acknowledge; with Vo already on, acknowledging doesn't change the switch", () => {
    const staff = vendorTermsPanel({ organizationId: ORG, isOwner: false, enabled: false, timeZone: viewer.timeZone, acks: [] });
    expect(staff.action).toBeNull();
    expect(staff.dialog).toBeNull();
    const on = vendorTermsPanel({ organizationId: ORG, isOwner: true, enabled: true, timeZone: viewer.timeZone, acks: [] });
    expect(on.status.text).toContain("Vo was turned on before this panel existed");
    expect(on.dialog?.accept).toMatchObject({ label: "Acknowledge", attrs: { "data-turn-on": "0" } });
  });
});

describe("Settings > Vo", () => {
  const off = effectiveSettings({ enabled: false }, false);
  const unacked = vendorTermsPanel({ organizationId: ORG, isOwner: true, enabled: false, timeZone: viewer.timeZone, acks: [] });
  const acked = vendorTermsPanel({ organizationId: ORG, isOwner: true, enabled: false, timeZone: viewer.timeZone, acks: [{ version: VO_VENDOR_TERMS.version, at: "2026-10-24T15:00:00Z", by: "Amara Osei" }] });

  it("turning Vo on opens the acknowledgement until the current version is acknowledged", () => {
    expect(aiSettings(viewer, off, unacked).firm[0].attrs).toEqual({ "data-vo-terms": "1", "data-org": ORG });
    expect(aiSettings(viewer, off, acked).firm[0].attrs).toEqual({ "data-vo-setting": "enabled", "data-org": ORG });
    // Turning Vo off never asks.
    expect(aiSettings(viewer, effectiveSettings({ enabled: true }, false), unacked).firm[0].attrs).toEqual({ "data-vo-setting": "enabled", "data-org": ORG });
    expect(aiSettings({ ...viewer, isOwner: false }, off, unacked).firm[0].attrs).toMatchObject({ disabled: true });
  });

  it("no longer shows the placeholder vendor line", () => {
    const settings = aiSettings(viewer, off, unacked);
    expect(JSON.stringify(settings.dataUse)).not.toMatch(/Pending|in review/);
    expect(settings.dataUse.map((row) => row.term)).not.toContain("Vendor retention");
  });

  it("renders the panel with the vendors' words, their sources and the dialog", () => {
    const names = { matter: () => "Matter", reference: () => "—", person: () => "—" };
    const data = aiPage({ tab: "settings", viewer, settings: off, runs: [], drafts: [], sources: [], names, vendorTerms: unacked });
    const html = renderToStaticMarkup(createElement(SheetAi, { data }));
    expect(html).toContain("AI vendor terms");
    expect(html).toContain("Anthropic may not train models on Customer Content from Services.");
    expect(html).toContain(`href="https://developers.cloudflare.com/workers-ai/platform/data-usage/#our-commitments-for-customer-content"`);
    expect(html).toContain(NOT_STATED);
    expect(html).toContain(`id="${VO_TERMS_DIALOG}"`);
    expect(html).toContain(`data-vo-terms-ack="${VO_VENDOR_TERMS.version}"`);
    expect(html).toContain('<details class="src" open="">');
    expect(html).not.toContain("Pending the AI vendor review");
    expect(html).toContain("Signed agreement between Anthropic and Casevoya");
    expect(html).toContain("Vendor’s published terms (for reference)");
    expect(html).toContain("Casevoya’s commitments");
    expect(html).toContain("Casevoya’s terms, written to the CICC Code; approved by Casevoya on 25 Oct 2026");
    expect(html).toContain('href="https://laws-lois.justice.gc.ca/eng/regulations/SOR-2022-128/FullText.html#s-28"');
    expect(html).toContain("section 28(1) · current to 30 Sep 2026 · retrieved 25 Oct 2026");
  });
});
