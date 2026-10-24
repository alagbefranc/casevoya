import vm from "node:vm";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EnquiryShareDialog, ShareEnquiryButton } from "@/components/sheet/designer/enquiry-share";
import { EnquiryLive } from "@/components/sheet/enquiry-live";
import { IntakeHeader } from "@/components/sheet/designer/intake-builder";
import { applyFraming, framingHeaders, isEmbeddablePath } from "@/lib/security/framing";
import { ENQUIRY_MIN_FORM_MS, enquiryPagePath, enquiryStatements, parsePublicFirm, readEnquiry } from "@/modules/leads/enquiry";
import { enquiryPageBase } from "@/modules/leads/enquiry-present";
import { ENQUIRY_HEIGHT_MESSAGE, bookingLinks, enquiryEmbedScript, enquiryLinks, escapeHtml, type EnquiryShareData } from "@/modules/leads/share";

// The firm's public enquiry page, its embed and the Sheet's share dialog (CRM-01): route answers,
// framing headers, the embed script's origin check, and the snippets the dialog hands out.

const rpc = vi.fn();
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ rpc }) }));
vi.mock("@supabase/ssr", () => ({
  createServerClient: () => ({ auth: { getClaims: async () => ({ data: null }) }, rpc }),
}));

const ORIGIN = "https://app.casevoya.ca";

beforeEach(() => {
  rpc.mockReset();
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://example.supabase.test");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "sb_publishable_test");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("enquiry paths and the public firm", () => {
  it("recognises the hosted page and the embed, and refuses a malformed slug", () => {
    expect(enquiryPagePath("/enquiry/maple")).toEqual({ firm: "maple", embed: false });
    expect(enquiryPagePath("/embed/enquiry/Maple-Law/")).toEqual({ firm: "maple-law", embed: true });
    expect(enquiryPagePath("/enquiry/bad_slug!")).toEqual({ firm: "", embed: false });
    expect(enquiryPagePath("/enquiry")).toBeNull();
    expect(enquiryPagePath("/embed/enquiry.js")).toBeNull();
    expect(enquiryPagePath("/enquiry/maple/extra")).toBeNull();
    expect(parsePublicFirm({ firm_name: "Maple", firm_slug: "maple", practice: true, staff: false })).toEqual({ firmName: "Maple", firmSlug: "maple", practice: true, staff: false, open: true });
    expect(parsePublicFirm(null)).toBeNull();
    expect(parsePublicFirm({ firm_name: "Maple", firm_slug: "../x" })).toBeNull();
  });

  it("checks the form timer and names the firm in the stored wording", () => {
    const base = { name: "Wei", contact: "wei@example.test", reply: true, key: "k-12345678" };
    expect(readEnquiry(base)).toEqual({ error: "invalid" });
    expect(readEnquiry({ ...base, elapsedMs: ENQUIRY_MIN_FORM_MS - 1 })).toEqual({ error: "too_fast" });
    expect(readEnquiry({ ...base, elapsedMs: ENQUIRY_MIN_FORM_MS, source: "web_form" })).toMatchObject({ input: { source: "web_form" } });
    const statements = enquiryStatements("  Maple   Immigration ");
    expect(statements.reply).toBe("Maple Immigration may use these details to reply to my enquiry");
    expect(statements.marketing).toBe("Send me Maple Immigration news. Separate from replies about your enquiry. You can stop any time.");
    expect(statements.reply).not.toMatch(/news/i);
  });
});

describe("framing", () => {
  it("lets only the embedded form be framed by other sites", () => {
    expect(framingHeaders("/embed/enquiry/maple")).toEqual({ "Content-Security-Policy": "frame-ancestors *" });
    for (const path of ["/enquiry/maple", "/embed/enquiry.js", "/api/enquiry/maple", "/sheet", "/portal", "/sign-in", "/embed/enquiry/maple/x", "/"]) {
      expect(isEmbeddablePath(path)).toBe(false);
      expect(framingHeaders(path)).toEqual({ "X-Frame-Options": "SAMEORIGIN" });
    }
    const headers = new Headers({ "X-Frame-Options": "DENY" });
    applyFraming(headers, "/embed/enquiry/maple");
    expect(headers.get("X-Frame-Options")).toBeNull();
    expect(headers.get("Content-Security-Policy")).toBe("frame-ancestors *");
    const sheet = new Headers();
    applyFraming(sheet, "/sheet/pipeline");
    expect(sheet.get("X-Frame-Options")).toBe("SAMEORIGIN");
    expect(sheet.get("Content-Security-Policy")).toBeNull();
  });

  it("answers 404 for an unknown firm before the page streams, and frames only the embed", async () => {
    const { proxy } = await import("@/proxy");
    rpc.mockResolvedValue({ data: null, error: null });
    const missing = await proxy(new NextRequest("https://app.casevoya.ca/enquiry/no-such-firm"));
    expect(missing.status).toBe(404);
    expect(missing.headers.get("x-middleware-rewrite")).toContain("/_enquiry/unavailable");
    expect(missing.headers.get("X-Frame-Options")).toBe("SAMEORIGIN");
    expect(rpc).toHaveBeenCalledWith("enquiry_public_firm", { p_firm_slug: "no-such-firm" });

    const embedMissing = await proxy(new NextRequest("https://app.casevoya.ca/embed/enquiry/no-such-firm"));
    expect(embedMissing.status).toBe(404);
    expect(embedMissing.headers.get("Content-Security-Policy")).toBe("frame-ancestors *");

    rpc.mockResolvedValue({ data: { firm_name: "Maple", firm_slug: "maple", practice: false, staff: false }, error: null });
    const found = await proxy(new NextRequest("https://app.casevoya.ca/embed/enquiry/maple"));
    expect(found.status).toBe(200);
    expect(found.headers.get("Content-Security-Policy")).toBe("frame-ancestors *");
    expect(found.headers.get("X-Frame-Options")).toBeNull();
    expect(found.headers.get("Cache-Control")).toBe("private, no-store");
    const hosted = await proxy(new NextRequest("https://app.casevoya.ca/enquiry/maple"));
    expect(hosted.status).toBe(200);
    expect(hosted.headers.get("X-Frame-Options")).toBe("SAMEORIGIN");
    expect(hosted.headers.get("Content-Security-Policy")).toBeNull();

    rpc.mockClear();
    const malformed = await proxy(new NextRequest("https://app.casevoya.ca/enquiry/Bad_Slug"));
    expect(malformed.status).toBe(404);
    expect(rpc).not.toHaveBeenCalled();
  });
});

describe("POST /api/enquiry/<firm>", () => {
  const post = async (firm: string, body: unknown) => {
    const { POST } = await import("@/app/api/enquiry/[firm]/route");
    return POST(new Request(`https://app.casevoya.ca/api/enquiry/${firm}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }), {
      params: Promise.resolve({ firm }),
    });
  };
  const form = { name: "Wei Zhang", contact: "wei@example.test", reply: true, marketing: true, key: "k-12345678", elapsedMs: 9000, source: "web_form" };

  it("answers 404 for an unknown firm without trying to submit", async () => {
    rpc.mockResolvedValue({ data: null, error: null });
    const response = await post("no-such-firm", form);
    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({ error: "form_unavailable" });
    expect(rpc).toHaveBeenCalledTimes(1);
    expect((await post("Bad_Slug", form)).status).toBe(404);
  });

  it("refuses a form sent too fast and a filled honeypot before any database call", async () => {
    expect((await post("maple", { ...form, elapsedMs: 100 })).status).toBe(429);
    expect((await post("maple", { ...form, website: "spam" })).status).toBe(400);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("stores the wording the page showed, naming the firm, with the version and the embed's source", async () => {
    rpc.mockImplementation(async (name: string) =>
      name === "enquiry_public_firm" ? { data: { firm_name: "Maple Immigration", firm_slug: "maple", practice: true, staff: true }, error: null } : { data: { ok: true }, error: null },
    );
    const response = await post("maple", form);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, practice: true });
    const [, args] = rpc.mock.calls.find(([name]) => name === "submit_enquiry") ?? [];
    expect(args).toMatchObject({
      p_firm_slug: "maple",
      p_reply_statement: "Maple Immigration may use these details to reply to my enquiry",
      p_marketing_statement: "Send me Maple Immigration news. Separate from replies about your enquiry. You can stop any time.",
      p_consent_version: "enquiry-v2",
      p_source: "web_form",
    });
  });
});

type FakeFrame = { src: string; title: string; style: Record<string, string>; attrs: Record<string, string>; contentWindow: object; setAttribute(name: string, value: string): void };

function runScript(script: string, slugs: string[]) {
  const listeners: Record<string, ((event: unknown) => void)[]> = {};
  const nodes = slugs.map((slug) => {
    const attrs: Record<string, string> = { "data-casevoya-enquiry": slug };
    return {
      attrs,
      children: [] as FakeFrame[],
      getAttribute: (name: string) => attrs[name] ?? null,
      setAttribute: (name: string, value: string) => void (attrs[name] = value),
      appendChild(child: FakeFrame) {
        this.children.push(child);
      },
    };
  });
  const document = {
    readyState: "complete",
    querySelectorAll: () => nodes,
    addEventListener: () => undefined,
    createElement: (): FakeFrame => {
      const attrs: Record<string, string> = {};
      return { src: "", title: "", style: {}, attrs, contentWindow: {}, setAttribute: (name, value) => void (attrs[name] = value) };
    },
  };
  const window: Record<string, unknown> = {
    addEventListener: (type: string, listener: (event: unknown) => void) => (listeners[type] ??= []).push(listener),
  };
  const context = vm.createContext({ window, document });
  vm.runInContext(script, context);
  return { nodes, listeners, again: () => vm.runInContext(script, context) };
}

describe("the embed script", () => {
  const script = enquiryEmbedScript(ORIGIN);

  it("mounts the firm's embedded form once per placeholder, and skips a bad slug", () => {
    const { nodes, again } = runScript(script, ["maple", "bad slug<"]);
    expect(nodes[0].children).toHaveLength(1);
    expect(nodes[0].children[0].src).toBe("https://app.casevoya.ca/embed/enquiry/maple");
    expect(nodes[1].children).toHaveLength(0);
    again();
    expect(nodes[0].children).toHaveLength(1);
  });

  it("resizes only for height messages from the app's origin and from its own iframe", () => {
    const { nodes, listeners } = runScript(script, ["maple"]);
    const frame = nodes[0].children[0];
    const send = (event: object) => listeners.message.forEach((listener) => listener(event));
    send({ origin: "https://evil.example", source: frame.contentWindow, data: { type: ENQUIRY_HEIGHT_MESSAGE, height: 700 } });
    expect(frame.style.height).toBeUndefined();
    send({ origin: ORIGIN, source: {}, data: { type: ENQUIRY_HEIGHT_MESSAGE, height: 700 } });
    expect(frame.style.height).toBeUndefined();
    send({ origin: ORIGIN, source: frame.contentWindow, data: { type: "other", height: 700 } });
    expect(frame.style.height).toBeUndefined();
    send({ origin: ORIGIN, source: frame.contentWindow, data: { type: ENQUIRY_HEIGHT_MESSAGE, height: 712.4 } });
    expect(frame.style.height).toBe("713px");
    send({ origin: ORIGIN, source: frame.contentWindow, data: { type: ENQUIRY_HEIGHT_MESSAGE, height: 1e9 } });
    expect(frame.style.height).toBe("8000px");
  });

  it("is served as JavaScript built from the app origin, not the request", async () => {
    vi.stubEnv("APP_URL", "https://app.casevoya.ca");
    vi.doMock("next/server", async (original) => ({ ...(await original<typeof import("next/server")>()), connection: async () => undefined }));
    const { GET } = await import("@/app/embed/enquiry.js/route");
    const response = await GET();
    expect(response.headers.get("Content-Type")).toBe("text/javascript; charset=utf-8");
    const body = await response.text();
    expect(body).toContain('var ORIGIN = "https://app.casevoya.ca";');
    expect(body).toContain("event.origin !== ORIGIN");
    vi.doUnmock("next/server");
  });

  it("refuses a non-https origin", () => {
    expect(() => enquiryEmbedScript("http://app.casevoya.ca")).toThrow();
    expect(enquiryEmbedScript("http://localhost:3000")).toContain('"http://localhost:3000"');
  });
});

describe("share dialog", () => {
  const links = enquiryLinks(ORIGIN, "maple", `Maple & Co "Immigration" <Toronto>`);
  const data: EnquiryShareData = {
    firmName: "Maple & Co",
    links,
    qr: "data:image/svg+xml;utf-8,%3Csvg%3E%3C%2Fsvg%3E",
    practice: false,
    privacyMissing: false,
    bookings: bookingLinks(ORIGIN, "maple", [
      { title: "Practice call", slug: "practice", is_sample: true },
      { title: "Initial consultation", slug: "initial", is_sample: false },
      { title: "Broken", slug: "../x", is_sample: false },
    ]),
  };

  it("builds the snippets from the app origin and the firm's slug, escaped", () => {
    expect(links.page).toBe("https://app.casevoya.ca/enquiry/maple");
    expect(links.scriptSnippet).toBe(
      '<div data-casevoya-enquiry="maple" data-title="Enquiry form: Maple &amp; Co &quot;Immigration&quot; &lt;Toronto&gt;"></div>\n<script async src="https://app.casevoya.ca/embed/enquiry.js"></script>',
    );
    expect(links.iframeSnippet).toContain('<iframe src="https://app.casevoya.ca/embed/enquiry/maple" title="Enquiry form: Maple &amp; Co');
    expect(links.iframeSnippet).not.toMatch(/<Toronto>/);
    expect(() => enquiryLinks(ORIGIN, "maple\"><script>", "x")).toThrow();
    expect(escapeHtml(`<a href="x">'&`)).toBe("&lt;a href=&quot;x&quot;&gt;&#39;&amp;");
    expect(data.bookings.map((b) => b.url)).toEqual(["https://app.casevoya.ca/book/maple/initial", "https://app.casevoya.ca/book/maple/practice"]);
  });

  it("renders the Designer's dialog parts with the link, QR, both snippets, Preview and the booking links", () => {
    const html = renderToStaticMarkup(createElement(EnquiryShareDialog, { data }));
    expect(html).toMatch(/^<dialog class="dlg wide" id="dlgShare" aria-labelledby="dlgShareH"><div class="dh"><h2 id="dlgShareH">Share your enquiry form<\/h2>/);
    expect(html).toContain('data-toast="Link copied" data-copy="https://app.casevoya.ca/enquiry/maple"');
    expect(html).toContain('data-copy="&lt;div data-casevoya-enquiry=&quot;maple&quot;');
    expect(html).toContain('data-copy="&lt;iframe src=&quot;https://app.casevoya.ca/embed/enquiry/maple&quot;');
    expect(html).toContain('<img src="data:image/svg+xml;utf-8,%3Csvg%3E%3C%2Fsvg%3E" alt="QR code for https://app.casevoya.ca/enquiry/maple"');
    expect(html).toContain('download="enquiry-form-qr.svg"');
    expect(html).toContain('href="https://app.casevoya.ca/enquiry/maple" target="_blank" rel="noopener noreferrer"');
    expect(html).toContain("Practice call · Practice page");
    expect(html).not.toContain("<script");
    expect(html).not.toMatch(/alert warn|alert info/);
    expect(renderToStaticMarkup(createElement(ShareEnquiryButton))).toBe(
      '<button class="btn s sm" type="button" data-open="dlgShare"><svg class="ic s" aria-hidden="true"><use href="/assets/icons-coreui/sprite.svg#i-share"></use></svg>Share enquiry form</button>',
    );
  });

  it("adds Share enquiry form to the Intake forms header only when asked, before Preview", () => {
    const data = {
      tab: "build" as const,
      title: "Intake",
      pills: [],
      publishLabel: "Publish",
      section: { left: "", right: "" },
      palette: [],
      rows: [],
      settings: { label: "", toggles: [] },
      vo: null,
    };
    const plain = renderToStaticMarkup(createElement(IntakeHeader, { data }));
    const shared = renderToStaticMarkup(createElement(IntakeHeader, { data, share: true }));
    expect(plain).not.toContain("dlgShare");
    expect(shared).toContain('<span class="acts"><button class="btn s sm" type="button" data-open="dlgShare">');
    expect(shared.replace(/<button class="btn s sm" type="button" data-open="dlgShare">.*?Share enquiry form<\/button>/, "")).toBe(plain);
  });

  it("says when the form is off (no privacy notice), when the pages are practice pages, and when nothing is bookable", () => {
    const html = renderToStaticMarkup(createElement(EnquiryShareDialog, { data: { ...data, privacyMissing: true, practice: true, bookings: [] } }));
    expect(html).toContain("The form is off until you publish a privacy notice");
    expect(html).toContain('href="/sheet/settings?tab=portal"');
    expect(html).toContain("Sample mode · practice records are marked sample");
    expect(html).toContain("No booking page is published yet.");
  });
});

describe("live enquiry page", () => {
  const base = enquiryPageBase({ firmName: "Maple Immigration", logo: null, embedded: false, snippet: null, practice: null });

  it("shows a visitor the firm's form with no website card, no privacy link and no demo firm", () => {
    const html = renderToStaticMarkup(createElement(EnquiryLive, { base, firmSlug: "maple", firmName: "Maple Immigration" }));
    expect(html).toContain('<form id="f" data-live="1" noValidate="">');
    expect(html).toContain("<header><span>Maple Immigration</span></header>");
    expect(html).toContain("Maple Immigration may use these details to reply to my enquiry");
    expect(html).toContain('id="ew" tabindex="-1"');
    expect(html).toContain('name="website"');
    expect(html).toContain('<div class="errsum" id="es" hidden="" tabindex="-1" role="alert">');
    expect(html).not.toMatch(/Northline|fictional|Put this form on your own website|Privacy notice|embed\.js/);
  });

  it("shows the firm's own staff the website card with the real snippet, and marks a practice page", () => {
    const snippet = enquiryLinks(ORIGIN, "maple", "Maple Immigration").scriptSnippet;
    const html = renderToStaticMarkup(
      createElement(EnquiryLive, {
        base: enquiryPageBase({ firmName: "Maple Immigration", logo: "https://storage.test/logo.png", embedded: false, snippet, practice: { label: "Sample mode", detail: "practice records are marked sample", note: "Practice page." } }),
        firmSlug: "maple",
        firmName: "Maple Immigration",
      }),
    );
    expect(html).toContain('<img src="https://storage.test/logo.png" alt="Maple Immigration" height="32"');
    expect(html).toContain("Put this form on your own website");
    expect(html).toContain("&lt;div data-casevoya-enquiry=&quot;maple&quot;");
    expect(html).toMatch(/<\/header><div class="card" role="note"[^>]*><b class="demo"[^>]*>Sample mode · practice records are marked sample<\/b>/);
  });

  it("embeds the form alone on a transparent page", () => {
    const html = renderToStaticMarkup(
      createElement(EnquiryLive, { base: enquiryPageBase({ firmName: "Maple Immigration", logo: null, embedded: true, snippet: null, practice: null }), firmSlug: "maple", firmName: "Maple Immigration" }),
    );
    expect(html).toContain('<div class="pb pb-e"><main id="m"><form id="f" data-live="1"');
    expect(html).toContain("html,body{background:transparent!important");
    expect(html).not.toContain("<header>");
    expect(html).not.toContain("<h1>");
    expect(html).toContain("<span>Powered by Casevoya</span>");
  });
});
