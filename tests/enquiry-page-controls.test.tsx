import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { EnquiryShareDialog } from "@/components/sheet/designer/enquiry-share";
import { pageAttribution } from "@/components/sheet/enquiry-live";
import { ENQUIRY_MESSAGES, parsePublicFirm, readAttribution, readEnquiry } from "@/modules/leads/enquiry";
import { ENQUIRY_CLOSED_COPY, enquiryClosedTitle, enquiryPageBase } from "@/modules/leads/enquiry-present";
import { attributionItems } from "@/modules/leads/present";
import { parsePrivacyNotice, privacyPath } from "@/modules/leads/privacy";
import { enquiryEmbedScript, enquiryLinks, type EnquiryShareData } from "@/modules/leads/share";

// CRM-01 (#176): the enquiry page's privacy link, on/off switch and source attribution. Synthetic.

const ORIGIN = "https://app.casevoya.ca";

describe("privacy notice link", () => {
  it("links the enquiry page's footer to the firm's public notice", () => {
    expect(privacyPath("maple-test")).toBe("/privacy/maple-test");
    const base = enquiryPageBase({ firmName: "Maple Test", logo: null, embedded: false, snippet: null, practice: null, privacyHref: privacyPath("maple-test") });
    expect(base.footer.privacyHref).toBe("/privacy/maple-test");
    expect(enquiryPageBase({ firmName: "Maple Test", logo: null, embedded: false, snippet: null, practice: null }).footer.privacyHref).toBeNull();
  });

  it("reads the published notice and refuses anything incomplete", () => {
    expect(parsePrivacyNotice({ firm_name: "Maple Test", firm_slug: "maple-test", title: "Privacy notice", version_label: "v2", body: "Text", published_at: "2026-10-20T15:00:00Z" })).toEqual({
      firmName: "Maple Test",
      firmSlug: "maple-test",
      title: "Privacy notice",
      version: "v2",
      body: "Text",
      publishedOn: "2026-10-20",
    });
    expect(parsePrivacyNotice({ firm_name: "Maple Test" })).toBeNull();
    expect(parsePrivacyNotice(null)).toBeNull();
  });
});

describe("enquiry page on/off", () => {
  it("knows when the page is closed, and says so politely", () => {
    expect(parsePublicFirm({ firm_name: "Maple Test", firm_slug: "maple-test", open: false })).toMatchObject({ open: false });
    expect(parsePublicFirm({ firm_name: "Maple Test", firm_slug: "maple-test" })).toMatchObject({ open: true });
    expect(enquiryClosedTitle("Maple Test")).toBe("Maple Test isn’t taking enquiries online right now");
    expect(ENQUIRY_CLOSED_COPY).toMatch(/contact the firm directly/i);
    expect(ENQUIRY_MESSAGES.form_closed).toBe("This firm isn’t taking enquiries online right now.");
  });

  const share: EnquiryShareData = {
    firmName: "Maple Test",
    links: enquiryLinks(ORIGIN, "maple-test", "Maple Test"),
    qr: null,
    practice: false,
    privacyMissing: false,
    bookings: [],
  };

  it("puts the switch in Share your enquiry form: the owner can turn it off or on, others see the state", () => {
    const on = renderToStaticMarkup(createElement(EnquiryShareDialog, { data: { ...share, page: { enabled: true, owner: true, organizationId: "org-1" } } }));
    expect(on).toContain("Your enquiry page is on");
    expect(on).toContain('data-enquiry-toggle="off" data-org="org-1">Turn off</button>');
    const off = renderToStaticMarkup(createElement(EnquiryShareDialog, { data: { ...share, page: { enabled: false, owner: false, organizationId: "org-1" } } }));
    expect(off).toContain("Your enquiry page is off");
    expect(off).toContain("The firm owner can change this.");
    expect(off).not.toContain("data-enquiry-toggle");
    expect(renderToStaticMarkup(createElement(EnquiryShareDialog, { data: share }))).not.toContain("Your enquiry page is");
  });
});

describe("source attribution", () => {
  it("collects utm_* and the referrer on the hosted page, and the website for the embed", () => {
    expect(pageAttribution(false, { search: "?utm_source=test&utm_medium=email&other=x", hostname: "app.casevoya.ca" }, "https://www.google.com/search?q=visa")).toEqual({
      utm_source: "test",
      utm_medium: "email",
      referrer_host: "www.google.com",
    });
    expect(pageAttribution(false, { search: "", hostname: "app.casevoya.ca" }, "https://app.casevoya.ca/enquiry/x")).toEqual({});
    expect(pageAttribution(true, { search: "?utm_campaign=fall&cv_host=maple.example&cv_ref=news.example", hostname: "app.casevoya.ca" }, "https://maple.example/contact")).toEqual({
      utm_campaign: "fall",
      embed_host: "maple.example",
      referrer_host: "news.example",
    });
  });

  it("keeps only the known keys on the server too", () => {
    expect(readAttribution({ utm_source: " test ", gclid: "x", embed_host: 5 })).toEqual({ utm_source: "test" });
    const read = readEnquiry({ name: "Wei", contact: "wei@example.test", reply: true, key: "k-12345678", elapsedMs: 9000, attribution: { utm_source: "flyer" } });
    expect("input" in read && read.input.attribution).toEqual({ utm_source: "flyer" });
  });

  it("the embed script passes the website page's utm_* and host into the form", () => {
    const script = enquiryEmbedScript(ORIGIN);
    expect(script).toContain('frame.src = ORIGIN + "/embed/enquiry/" + slug + attribution();');
    expect(script).toContain('"cv_host=" + encodeURIComponent(window.location.hostname)');
  });

  it("shows on the Lead page what was recorded, and nothing otherwise", () => {
    expect(attributionItems({ utm_source: "test", utm_campaign: "fall", referrer_host: "www.google.com", embed_host: "maple.example" })).toEqual([
      { term: "Campaign", value: "source test · campaign fall" },
      { term: "Came from", value: "www.google.com" },
      { term: "Website", value: "maple.example" },
    ]);
    expect(attributionItems({})).toEqual([]);
    expect(attributionItems(null)).toEqual([]);
  });
});
