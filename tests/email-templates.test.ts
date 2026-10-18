import { describe, expect, it } from "vitest";
import { RESERVED_FIRM_SLUGS, firmSlug } from "@/lib/auth/slug";
import { DEFAULT_INBOUND_EMAIL_DOMAIN, firmAddress, parseInboundAddress } from "@/modules/email/addresses";
import { renderEmail } from "@/modules/email/templates";
import { signPayload, verifyPayload } from "@/modules/email/sign";

describe("inbound addresses", () => {
  it("uses docs.casevoya.ca and reserves the platform slugs", () => {
    expect(DEFAULT_INBOUND_EMAIL_DOMAIN).toBe("docs.casevoya.ca");
    expect(parseInboundAddress("northline@docs.casevoya.ca")).toEqual({
      ok: true,
      slug: "northline",
      token: null,
      domain: "docs.casevoya.ca",
    });
    expect(parseInboundAddress("northline+abcdef0123456789abcdef0123456789@docs.casevoya.ca")).toMatchObject({
      ok: true,
      slug: "northline",
      token: "abcdef0123456789abcdef0123456789",
    });
    expect(parseInboundAddress("northline@in.casevoya.ca").ok).toBe(false);
    for (const slug of RESERVED_FIRM_SLUGS) {
      expect(parseInboundAddress(`${slug}@docs.casevoya.ca`)).toMatchObject({ ok: false, reason: "reserved" });
      expect(firmSlug(slug, "abc123")).not.toBe(slug);
    }
    expect(firmAddress("northline", "docs.casevoya.ca", "abcdef0123456789abcdef0123456789")).toBe(
      "northline+abcdef0123456789abcdef0123456789@docs.casevoya.ca",
    );
  });
});

describe("email templates", () => {
  it("renders html and text without a private link or markup injection", () => {
    const invite = renderEmail({ template: "invite", firm: "North <script>", kind: "portal" });
    expect(invite.html).toContain("&lt;script&gt;");
    expect(invite.html).not.toContain("<script>");
    expect(invite.text).toContain("The private link is not in this email");
    expect(invite.text.length).toBeGreaterThan(20);
    // A request's purpose names the document: it never reaches the email, even if a context has it.
    const request = renderEmail({ template: "document_request", firm: "Northline", purpose: "Passport scan", due_on: "2026-11-01" });
    expect(request.html).not.toContain("Passport scan");
    expect(request.text).not.toContain("Passport scan");
    expect(request.text).toContain("by 1 November 2026");
    expect(request.subject).toContain("Northline");
    for (const template of ["invite", "reminder", "agreement", "signature", "document_request", "document_receipt"]) {
      const rendered = renderEmail({ template, firm: "Northline" });
      expect(rendered.html).toContain("<h1 ");
      expect(rendered.text.trim().length).toBeGreaterThan(10);
    }
  });
});

describe("inbound signatures", () => {
  it("accepts a fresh signature and rejects a skew or a tampered body", async () => {
    const body = '{"messageId":"abc"}';
    const timestamp = "1700000000";
    const signature = await signPayload("secret", timestamp, body);
    expect(await verifyPayload("secret", timestamp, body, signature, 1700000000 * 1000)).toBe(true);
    expect(await verifyPayload("secret", timestamp, body + " ", signature, 1700000000 * 1000)).toBe(false);
    expect(await verifyPayload("secret", timestamp, body, signature, (1700000000 + 301) * 1000)).toBe(false);
  });
});
