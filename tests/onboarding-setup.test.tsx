import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { SETUP_CONNECT, SETUP_COPY, SetupMarkup } from "@/components/port/markup/setup";
import { TwoStepMarkup } from "@/components/port/markup/two-step";
import { SIGNUP_EMAIL_SLOT, showSignupEmail } from "@/components/port/signup-email";
import { STEP_BACK } from "@/components/port/use-port";
import { SAMPLE_COPY, SampleCasePanel, type SampleCaseData } from "@/components/sheet/designer/sample-case";
import { mfaDoneLabel } from "@/lib/auth/mfa-step";
import { FIRM_LOGO_MIN_PX, firmLogoBigEnough, firmLogoSize } from "@/modules/firm-onboarding/firm-logo";
import { officeLine, officeParts, setupSaved, timezoneOption } from "@/modules/firm-onboarding/setup-saved";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh() {}, push() {}, replace() {} }) }));
vi.mock("@/modules/sheet/sample-actions", () => ({ recordSampleStep: async () => ({ ok: true }), switchToLive: async () => ({ ok: true }) }));

const root = path.resolve(import.meta.dirname, "..");

/** The rendered `<input>` (or `<select>`) with this id. */
function control(html: string, id: string): string {
  const at = html.indexOf(`id="${id}"`);
  expect(at, id).toBeGreaterThan(-1);
  const start = html.lastIndexOf("<", at);
  return html.slice(start, html.indexOf(">", at) + 1);
}

/** As renderToStaticMarkup writes text. */
const esc = (text: string) => text.replaceAll("&", "&amp;").replaceAll(">", "&gt;").replaceAll("<", "&lt;");

function css(): { file: string; text: string }[] {
  const out: { file: string; text: string }[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith(".css")) out.push({ file: full, text: readFileSync(full, "utf8") });
    }
  };
  walk(path.join(root, "src"));
  return out;
}

describe("a step panel going back keeps its size (fixes 1 and 6)", () => {
  it("uses a class no global rule styles: the Sheet's `.back` is the 34px arrow link", () => {
    expect(STEP_BACK).not.toBe("back");
    const source = readFileSync(path.join(root, "src/components/port/use-port.ts"), "utf8");
    expect(source).toContain("panel.classList.toggle(STEP_BACK, on && back)");
    expect(source).not.toMatch(/classList\.toggle\("back"/);
    for (const { file, text } of css()) {
      // Every rule naming the class is scoped to a step panel, so it can't size anything else.
      for (const match of text.matchAll(new RegExp(`([^{}]*\\.${STEP_BACK}\\b[^{}]*)\\{`, "g"))) {
        for (const selector of match[1].split(",")) {
          if (selector.includes(`.${STEP_BACK}`)) expect(selector.trim(), file).toMatch(/^\[data-step\]/);
        }
      }
    }
    expect(readFileSync(path.join(root, "src/styles/kit/auth.css"), "utf8")).toContain(`[data-step].on.${STEP_BACK}{animation-name:stback}`);
  });
});

describe("setup steps 1 and 2 come back as saved (fixes 3 and 4)", () => {
  const org = {
    legal_name: "Maple Immigration Inc.",
    display_name: "Maple Immigration",
    timezone: "America/Vancouver",
    billing_contact_name: "Bill Payer",
    billing_contact_email: "billing@maple.test",
    privacy_contact_name: "Pat Privacy",
    privacy_contact_email: "privacy@maple.test",
    subscription_terms_accepted_at: "2026-10-26T12:00:00Z",
  };
  const office = { address_line: "100 King St W", locality: "Toronto", region: "ON", postal_code: "M5X 1A9" };
  const owner = { name: "Casey Owner", email: "casey@maple.test" };

  it("fills the firm name from sign-up as the legal name, and the owner as both contacts, on first arrival", () => {
    const fresh = setupSaved({ legal_name: "Maple Immigration", display_name: "Maple Immigration" }, null, owner);
    expect(fresh).toEqual({
      legalName: "Maple Immigration",
      address: "",
      timezone: null,
      billingName: "Casey Owner",
      billingEmail: "casey@maple.test",
      privacyName: "Casey Owner",
      privacyEmail: "casey@maple.test",
      termsAccepted: false,
    });
    const html = renderToStaticMarkup(<SetupMarkup firmName="Maple Immigration" saved={fresh} />);
    expect(control(html, "ln")).toContain('value="Maple Immigration"');
    expect(control(html, "dn")).toContain('value="Maple Immigration"');
    expect(control(html, "bc")).toContain('value="Casey Owner"');
    expect(control(html, "be")).toContain('value="casey@maple.test"');
    expect(control(html, "pc")).toContain('value="Casey Owner"');
    expect(control(html, "pe")).toContain('value="casey@maple.test"');
    expect(control(html, "t1")).toBe('<input type="checkbox" id="t1"/>');
  });

  it("shows the saved legal name, address, contacts, time zone and accepted terms after a reload", () => {
    const saved = setupSaved(org, office, owner, ["firm_details", "terms_and_privacy"]);
    const html = renderToStaticMarkup(<SetupMarkup firmName="Maple Immigration" saved={saved} />);
    expect(control(html, "ln")).toContain('value="Maple Immigration Inc."');
    expect(control(html, "ad")).toContain('value="100 King St W, Toronto, ON M5X 1A9"');
    expect(control(html, "bc")).toContain('value="Bill Payer"');
    expect(control(html, "be")).toContain('value="billing@maple.test"');
    expect(control(html, "pc")).toContain('value="Pat Privacy"');
    expect(control(html, "pe")).toContain('value="privacy@maple.test"');
    expect(control(html, "t1")).toBe('<input type="checkbox" id="t1" checked=""/>');
    expect(html).toContain('<option selected="">America/Vancouver (Pacific)</option>');
  });

  it("renders the Designer's empty fields when nothing is saved", () => {
    const html = renderToStaticMarkup(<SetupMarkup />);
    for (const id of ["ln", "ad", "bc", "be", "pc", "pe"]) expect(control(html, id)).toContain('value=""');
    expect(html).toContain('<option selected="">America/Toronto (Eastern)</option>');
  });

  it("writes the saved office back as the line that saves to the same pieces", () => {
    for (const typed of ["100 King St W, Toronto, ON M5X 1A9", "Suite 2, 100 King St W, Toronto ON", "100 King St W Toronto ON M5X1A9", "Toronto", "Toronto St, Toronto"]) {
      const parts = officeParts(typed);
      const stored = { address_line: parts.addressLine, locality: parts.locality, region: parts.region || null, postal_code: parts.postal || null };
      const again = officeParts(officeLine(stored));
      expect({ typed, ...again }).toEqual({ typed, ...parts });
    }
    expect(officeLine(null)).toBe("");
  });

  it("maps a saved zone to the screen's option, or keeps the default", () => {
    expect(timezoneOption("America/Halifax")).toBe("America/Halifax (Atlantic)");
    expect(timezoneOption("Europe/Paris")).toBeNull();
  });
});

describe("small copy fixes (fix 8)", () => {
  it("Calendar and Stripe open Settings; Zoom and Calendly say they are coming later before being pressed", () => {
    const html = renderToStaticMarkup(<SetupMarkup firmName="Maple" />);
    expect(html).toContain(`<div>Google Calendar<small>Consultation bookings and deadlines on your calendar${SETUP_CONNECT.calendar.note}</small></div><button class="btn sm" type="button" title="${esc(SETUP_CONNECT.calendar.title)}">`);
    expect(html).toContain(`<div>Zoom<small>Video links added to booked consultations${SETUP_CONNECT.later.note}</small></div><button class="btn sm" type="button" aria-disabled="true" title="${SETUP_CONNECT.later.title}">`);
    expect(html).toContain(`<div>Calendly<small>Keep your existing booking page${SETUP_CONNECT.later.note}</small></div><button class="btn sm" type="button" aria-disabled="true"`);
    expect(html).toContain(`<div>Stripe<small>Card and bank payments for invoices · Maple${SETUP_CONNECT.stripe.note}</small></div><button class="btn sm p" type="button" title="${esc(SETUP_CONNECT.stripe.title)}">`);
    expect(SETUP_CONNECT.stripe.href).toBe("/sheet/settings?tab=billing#card-payments");
    expect(html).not.toContain("not available in this version");
  });

  it("the two-step All set button says where it goes", () => {
    expect(mfaDoneLabel("/setup")).toBe("Continue setup");
    expect(mfaDoneLabel("/setup?step=2")).toBe("Continue setup");
    expect(mfaDoneLabel("/sheet")).toBe("Go to the Sheet");
    expect(mfaDoneLabel(undefined)).toBe("Go to the Sheet");
    const html = renderToStaticMarkup(<TwoStepMarkup activeStep={4} doneLabel={mfaDoneLabel("/setup")} />);
    expect(html).toContain('<button class="btn p blk" data-href="/sheet" data-novalidate="" data-instant=""><span class="lab">Continue setup</span>');
    expect(renderToStaticMarkup(<TwoStepMarkup activeStep={4} />)).toContain('<span class="lab">Go to the Sheet</span>');
  });

  it("the code step names the address the code went to", () => {
    const slot = { textContent: "the work email you entered" };
    const fake = {
      querySelector: (selector: string) =>
        selector === "#wem" ? { value: " owner@maple.test " } : selector === SIGNUP_EMAIL_SLOT ? slot : null,
    } as unknown as ParentNode;
    showSignupEmail(fake);
    expect(slot.textContent).toBe("owner@maple.test");
  });

  it("refuses a logo under 256 px, as the Branding hint says (server and browser share the check)", () => {
    const png = (width: number, height: number) => {
      const bytes = new Uint8Array(33);
      bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
      new DataView(bytes.buffer).setUint32(16, width);
      new DataView(bytes.buffer).setUint32(20, height);
      return bytes;
    };
    // SOI, an APP0 segment, then a baseline frame header (SOF0) with height and width.
    const jpeg = (width: number, height: number) =>
      Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x04, 0x00, 0x00, 0xff, 0xc0, 0x00, 0x11, 0x08, height >> 8, height & 255, width >> 8, width & 255, 0x03]);
    expect(firmLogoSize(png(64, 64), "image/png")).toEqual({ width: 64, height: 64 });
    expect(firmLogoBigEnough(firmLogoSize(png(64, 64), "image/png"))).toBe(false);
    expect(firmLogoBigEnough(firmLogoSize(png(FIRM_LOGO_MIN_PX, 300), "image/png"))).toBe(true);
    expect(firmLogoSize(jpeg(512, 300), "image/jpeg")).toEqual({ width: 512, height: 300 });
    expect(firmLogoBigEnough(firmLogoSize(jpeg(255, 600), "image/jpeg"))).toBe(false);
    expect(firmLogoBigEnough(firmLogoSize(Uint8Array.from([0xff, 0xd8, 0xff]), "image/jpeg"))).toBe(false);
    const route = readFileSync(path.join(root, "src/app/api/firm/logo/route.ts"), "utf8");
    expect(route).toContain("if (!firmLogoBigEnough(firmLogoSize(bytes, type))) return refuse(FIRM_LOGO_TOO_SMALL, 422);");
  });

  it("the sample case doesn't say invitations are open while the portal policies are unpublished", () => {
    const sample: SampleCaseData = {
      applicant: "Priya",
      steps: [{ key: "intake", image: "intake", title: "Send an intake form", note: "Priya fills in her history", href: "/sheet/matters", done: false }],
      licence: null,
      firmLive: true,
      policiesMissing: true,
    };
    const html = renderToStaticMarkup(createElement(SampleCasePanel, { data: sample }));
    expect(html).toContain(`<b>${SAMPLE_COPY.lockedPolicies}</b>`);
    expect(SAMPLE_COPY.lockedPolicies).toBe("Clients can’t accept portal invitations yet");
    expect(html).toContain(SAMPLE_COPY.leadPolicies);
    expect(html).not.toContain(SAMPLE_COPY.lockedLive);
    const published = renderToStaticMarkup(createElement(SampleCasePanel, { data: { ...sample, policiesMissing: false } }));
    expect(published).toContain(`<b>${SAMPLE_COPY.lockedLive}</b>`);
  });

  it("setup's last step says the same until the portal policies are published", () => {
    const missing = renderToStaticMarkup(<SetupMarkup policiesMissing />);
    expect(missing).toContain(`<b>${SETUP_COPY.sampleAlertTitlePolicies}</b>${esc(SETUP_COPY.sampleAlertPolicies)}`);
    expect(missing).not.toContain(SETUP_COPY.sampleAlertTitle);
    expect(missing).not.toContain(SETUP_COPY.sampleLead);
    expect(renderToStaticMarkup(<SetupMarkup />)).toContain(`<b>${SETUP_COPY.sampleAlertTitle}</b>`);
  });
});
