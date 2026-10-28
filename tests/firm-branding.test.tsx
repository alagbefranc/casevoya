import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh() {}, push() {}, replace() {} }) }));

import { LivePortal } from "@/components/portal/live";
import { SheetSettingsLanguage } from "@/components/sheet/designer/settings-firm";
import { EMAIL_TEMPLATES, renderTemplate, type TemplateId } from "@/modules/email/designs/catalog";
import { firmHeaderPreviewHtml, renderCopy } from "@/modules/email/designs/layout";
import { buildLocalized } from "@/modules/email/designs/localized";
import { TAGLINES } from "@/modules/email/designs/taglines";
import { dispatchOutbound, firmLookContext, type DispatchDeps } from "@/modules/email/dispatch";
import { renderEmail } from "@/modules/email/templates";
import { accentInk, firmLogoPublicPath } from "@/modules/firm-onboarding/firm-logo";
import type { PortalViewer } from "@/modules/portal/load";
import { brandingPage, languagePage, settingsHeader } from "@/modules/sheet/settings-firm-present";

// ORG-01 (#175): the firm's logo or initials on its colour in the portal and on its emails, a
// per-template email tagline, and the firm's default language for new clients. Synthetic data.

const ORG = "00000000-0000-4000-8000-000000000001";
const FILE = "11111111-1111-4111-8111-111111111111";
const ORIGIN = "https://app.casevoya.ca";

const viewer: PortalViewer = {
  organizationId: ORG,
  organizationName: "Test Firm",
  organizationSlug: "test-firm",
  timezone: "America/Toronto",
  role: "client",
  person: null,
  matters: [],
  people: [],
  grants: [],
  shares: [],
  prefs: null,
  sections: [],
};

const portal = (props: Record<string, unknown>) => renderToStaticMarkup(createElement(LivePortal, { page: "family", viewer, ...props } as never));

describe("portal firm tile", () => {
  it("shows the initials on the firm colour, with readable text, and buttons stay blue", () => {
    const page = portal({ logo: null, accent: "#0A4B93" });
    expect(page).toContain('<span class="firmlogo" style="background:#0A4B93;color:#ffffff">TF</span>');
    expect(renderToStaticMarkup(createElement(LivePortal, { page: "family", viewer, logo: null, accent: "#F5D90A" } as never))).toContain("background:#F5D90A;color:#111111");
    expect(page).not.toMatch(/\.btn[^{]*\{[^}]*#0A4B93/);
  });

  it("shows the logo on white when there is one, and plain initials with neither", () => {
    expect(portal({ logo: "https://storage.example.test/logo.png", accent: "#0A4B93" })).toContain('<span class="firmlogo"><img src="https://storage.example.test/logo.png"');
    expect(portal({ logo: null, accent: null })).toContain('<span class="firmlogo">TF</span>');
  });

  it("picks white or near-black text for any colour", () => {
    expect(accentInk("#000000")).toBe("#ffffff");
    expect(accentInk("#FFFFFF")).toBe("#111111");
    expect(accentInk("#0A4B93")).toBe("#ffffff");
  });
});

describe("email header", () => {
  it("gives every firm email its own tagline, never the old one-for-all line", () => {
    const firmIds = (Object.keys(EMAIL_TEMPLATES) as TemplateId[]).filter((id) => EMAIL_TEMPLATES[id].brand === "firm" && !/^EM14/.test(id));
    for (const id of firmIds) {
      expect(TAGLINES[id], id).toBeTruthy();
      const html = renderCopy(renderTemplate(id, EMAIL_TEMPLATES[id].sample as never, ORIGIN), ORIGIN).html;
      expect(html, id).toContain(`>${TAGLINES[id]}</td>`);
      expect(html, id).not.toContain("Your immigration file");
    }
    expect(renderEmail({ template: "document_request", firm: "Test Firm" }).html).toContain(">Documents</td>");
    expect(renderEmail({ template: "something_new", firm: "Test Firm" }).html).toContain(">Updates on your file</td>");
  });

  it("keeps the approved shared tagline in French", () => {
    const fr = buildLocalized("EM06", "fr", EMAIL_TEMPLATES.EM06.sample as never, ORIGIN);
    expect(fr.shell?.tagline).toBeTruthy();
    expect(fr.tagline).toBeUndefined();
  });

  it("draws the firm's logo from its public link, or its initial on the firm colour", () => {
    const logo = `${ORIGIN}${firmLogoPublicPath(`${ORG}/${FILE}.png`)}`;
    const withLogo = renderEmail({ template: "document_request", firm: "Test Firm", firm_logo_url: logo, firm_accent: "#0A4B93" }).html;
    expect(withLogo).toContain(`<img src="${logo}" width="40" height="40" alt="Test Firm"`);
    const tinted = renderEmail({ template: "document_request", firm: "Test Firm", firm_accent: "#F5D90A" }).html;
    expect(tinted).toContain("background:#F5D90A;border-radius:10px;color:#111111");
    expect(tinted).toContain(">T</td>");
  });

  it("ignores a logo link that isn't the app's own logo route", () => {
    const html = renderEmail({ template: "document_request", firm: "Test Firm", firm_logo_url: "https://evil.example/x.png" }).html;
    expect(html).not.toContain("evil.example");
    expect(renderEmail({ template: "document_request", firm: "Test Firm", firm_logo_url: `${ORIGIN}/assets/x.png` }).html).not.toContain("/assets/x.png\" width=\"40\"");
  });

  it("builds the logo link only from the firm's own stored logo", () => {
    expect(firmLookContext({ organization_id: ORG, logo_locator: `firm-logos/${ORG}/${FILE}.png`, accent: "#0A4B93" }, ORIGIN)).toEqual({
      firm_logo_url: `${ORIGIN}/api/firm/logo/${ORG}/${FILE}.png`,
      firm_accent: "#0A4B93",
    });
    const other = "00000000-0000-4000-8000-000000000002";
    expect(firmLookContext({ organization_id: ORG, logo_locator: `firm-logos/${other}/${FILE}.png`, accent: "red" }, ORIGIN)).toEqual({});
    expect(firmLookContext(undefined, ORIGIN)).toEqual({});
  });

  it("the mail worker puts the firm look on the email and drops any look from the context", async () => {
    const html: string[] = [];
    const deps: DispatchDeps = {
      claim: async () => [{ id: "event-1" }],
      prepare: async () => ({
        action: "send",
        messages: [
          {
            delivery_id: "d1",
            to: "client@example.test",
            from_address: "notices@casevoya.ca",
            from_name: "Test Firm",
            reply_to_address: "test@docs.casevoya.ca",
            reply_to_name: "Test Firm",
            template: "document_request",
            context: { firm: "Test Firm", template: "document_request", firm_logo_url: "https://evil.example/x.png" },
          },
        ],
      }),
      brands: async () => ({ d1: { organization_id: ORG, logo_locator: `firm-logos/${ORG}/${FILE}.png`, accent: "#0A4B93" } }),
      send: async (message) => {
        html.push(message.html);
        return { ok: true, messageId: "m1", delivered: [message.to], queued: [], permanentBounces: [], suppressed: [] };
      },
      finish: async () => {},
    };
    await dispatchOutbound(deps, { worker: "test", limit: 1, inboundDomain: "docs.casevoya.ca", fromAddress: "notices@casevoya.ca", appOrigin: ORIGIN });
    expect(html[0]).toContain(`${ORIGIN}/api/firm/logo/${ORG}/${FILE}.png`);
    expect(html[0]).not.toContain("evil.example");
  });
});

describe("Settings", () => {
  it("Branding says the portal and emails show the logo, and previews the real header", () => {
    const data = brandingPage({ firmName: "Test Firm", branding: { accent: "#0A4B93" }, logoUrl: null, owner: true });
    expect(data.note).not.toMatch(/don’t show them yet/);
    expect(data.note).toContain("client portal and at the top of your emails");
    expect(data.preview).toMatchObject({ kind: "html" });
    expect(data.preview.kind === "html" && data.preview.html).toContain("background:#0A4B93");
    expect(firmHeaderPreviewHtml("Test Firm", { tagline: "Documents" })).toContain(">Documents</td>");
  });

  it("Language and time shows the firm's default language and offers owners a change", () => {
    const data = languagePage([], "America/Toronto", "fr-CA");
    expect(data.firmLanguage).toBe("Français");
    expect(renderToStaticMarkup(createElement(SheetSettingsLanguage, { data }))).toContain("New clients start in <b>Français</b>.");
    expect(languagePage([], "America/Toronto", null).firmLanguage).toBe("English");
    expect(settingsHeader("language", "Test Firm", null, true).act?.label).toBe("Change language or time");
    expect(settingsHeader("language", "Test Firm", null, false).act?.label).toBe("Change my timezone");
  });
});

describe("firm default language", () => {
  const sql = readFileSync("supabase/migrations/20261024100000_firm_default_locale.sql", "utf8");

  it("saves through update_firm_profile, en-CA or fr-CA only, and new invites read it", () => {
    expect(sql).toContain("'timezone', 'default_locale'");
    expect(sql).toContain("if value not in ('en-CA', 'fr-CA') then");
    expect(sql).toContain("default_locale = firm.default_locale");
    expect(sql).toContain("'default_locale', firm.default_locale");
    expect(sql).toContain("coalesce(person_locale.locale, staff_locale.locale, firm.default_locale, 'en-CA')");
  });

  it("the invite page presses the firm's language on the Language switch", () => {
    const wire = readFileSync("src/components/port/wire.ts", "utf8");
    expect(wire).toContain("presetPortalLocale(event.root, loaded.preview?.organization?.default_locale);");
  });
});
