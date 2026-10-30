import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { fetchOfficialPage, readBodyCapped } from "@/modules/content-governance/official-fetch";
import { runSourceRechecks } from "@/modules/content-governance/source-recheck-run";
import { captureClaimPage } from "@/modules/content-governance/claim-page";
import { readIssuerPage } from "@/modules/government/issuer-page";
import { snapshotOfficialPage } from "@/modules/submissions/official-page";

/**
 * The shared official-page fetch (security review, SSRF pass 2): redirects checked hop by hop
 * against the official-source allowlist, a Content-Length pre-check and a streamed size cap, and a
 * source re-check runner that records a blocked or moved page and keeps going. Synthetic pages only.
 */

type Route = (url: string, init?: RequestInit) => Response;

function server(routes: Record<string, Route>) {
  const calls: { url: string; redirect: RequestRedirect | undefined }[] = [];
  const fetcher = (async (input: string, init?: RequestInit) => {
    calls.push({ url: input, redirect: init?.redirect });
    const route = routes[input];
    if (!route) throw new Error(`unexpected fetch ${input}`);
    return route(input, init);
  }) as unknown as typeof fetch;
  return { fetcher, calls };
}

const redirect = (location: string, status = 302): Route => () => new Response(null, { status, headers: { location } });
const page = (body: string, headers: Record<string, string> = {}): Route => () => new Response(body, { status: 200, headers });

describe("fetchOfficialPage", () => {
  it("follows a redirect only while every hop is on an allowlisted federal host", async () => {
    const ok = server({
      "https://canada.ca/en/a.html": redirect("https://www.canada.ca/en/a.html"),
      "https://www.canada.ca/en/a.html": page("synthetic page"),
    });
    const fetched = await fetchOfficialPage("https://canada.ca/en/a.html#s1", ok.fetcher);
    expect(fetched).toMatchObject({ ok: true, status: 200, finalUrl: "https://www.canada.ca/en/a.html" });
    expect(ok.calls.every((call) => call.redirect === "manual")).toBe(true);

    for (const location of ["https://example.com/x", "http://www.canada.ca/en/a.html", "https://www.canada.ca:8443/x", "https://www.tbs-sct.gc.ca/x"]) {
      const hop = server({ "https://www.canada.ca/en/a.html": redirect(location) });
      const blocked = await fetchOfficialPage("https://www.canada.ca/en/a.html", hop.fetcher);
      expect(blocked).toMatchObject({ ok: false, result: "blocked", code: "off_allowlist" });
      // The off-list hop is never requested.
      expect(hop.calls.map((call) => call.url)).toEqual(["https://www.canada.ca/en/a.html"]);
    }

    const loop = server({ "https://www.canada.ca/en/a.html": redirect("https://www.canada.ca/en/a.html") });
    expect(await fetchOfficialPage("https://www.canada.ca/en/a.html", loop.fetcher)).toMatchObject({ ok: false, code: "too_many_redirects" });
    expect(loop.calls).toHaveLength(5);
  });

  it("refuses a declared or streamed body over the limit without reading it all", async () => {
    const declared = server({ "https://www.canada.ca/en/a.html": page("small", { "content-length": "999999999" }) });
    expect(await fetchOfficialPage("https://www.canada.ca/en/a.html", declared.fetcher, { maxBytes: 1000 })).toMatchObject({ ok: false, code: "too_large" });

    let served = 0;
    const endless = new ReadableStream<Uint8Array>({
      pull(controller) {
        served += 1024;
        controller.enqueue(new Uint8Array(1024));
      },
    });
    expect(await readBodyCapped(new Response(endless), 4096)).toBeNull();
    expect(served).toBeLessThan(16 * 1024);

    const exact = await readBodyCapped(new Response(new Uint8Array(4096)), 4096);
    expect(exact?.byteLength).toBe(4096);
  });

  it("is used by the claim, submission and issuer captures", async () => {
    const moved = server({ "https://www.canada.ca/en/x/y.html": redirect("https://example.com/y") });
    expect((await captureClaimPage("https://www.canada.ca/en/x/y.html#s1", moved.fetcher)).snapshot).toBeNull();
    expect((await snapshotOfficialPage("https://www.canada.ca/en/x/y.html", moved.fetcher)).snapshot).toBeNull();
    expect(await readIssuerPage(moved.fetcher, "https://www.canada.ca/en/x/y.html", "Synthetic Office")).toBeNull();
    expect(moved.calls.some((call) => call.url.includes("example.com"))).toBe(false);

    const issuer = server({
      "https://www.canada.ca/en/office.html": redirect("https://www.canada.ca/en/office-moved.html", 301),
      "https://www.canada.ca/en/office-moved.html": page("<h1>Synthetic Office</h1>", { "content-type": "text/html" }),
    });
    const read = await readIssuerPage(issuer.fetcher, "https://www.canada.ca/en/office.html", "Synthetic Office");
    expect(read).toMatchObject({ nameOnPage: true, finalUrl: "https://www.canada.ca/en/office-moved.html", httpStatus: 200 });
  });
});

describe("runSourceRechecks", () => {
  it("records a blocked or moved page against the source's own URL and keeps checking the others", async () => {
    const sha = (text: string) => createHash("sha256").update(text).digest("hex");
    const sources = [
      { source_id: "s1", url: "https://www.canada.ca/en/a.html", content_hash: null, claims: [] },
      { source_id: "s2", url: "https://www.canada.ca/en/b.html", content_hash: null, claims: [] },
      { source_id: "s3", url: "https://www.canada.ca/en/c.html", content_hash: sha("c"), claims: [] },
      { source_id: "s4", url: "https://www.canada.ca/en/d.html", content_hash: sha("d"), claims: [] },
    ];
    const { fetcher, calls } = server({
      "https://www.canada.ca/en/a.html": redirect("https://example.com/a"),
      "https://www.canada.ca/en/b.html": redirect("https://ircc.canada.ca/b"),
      "https://ircc.canada.ca/b": page("b"),
      "https://www.canada.ca/en/c.html": page("c"),
      "https://www.canada.ca/en/d.html": page("d"),
    });
    const recorded: Record<string, unknown>[] = [];
    const summary = await runSourceRechecks(
      {
        due: async () => sources,
        record: async (payload) => {
          const body = payload as Record<string, unknown>;
          recorded.push(body);
          if (body.source_id === "s3" && body.result === "unchanged") throw new Error("refused");
          return { result: body.result };
        },
        fetch: fetcher,
      },
      5,
    );
    expect(summary).toEqual({ checked: 4, unchanged: 1, changed: 0, partial: 0, failed: 3 });
    expect(calls.some((call) => call.url.includes("example.com"))).toBe(false);
    expect(recorded.map((body) => [body.source_id, body.result, body.error_code ?? null, body.final_url])).toEqual([
      ["s1", "blocked", "off_allowlist", "https://www.canada.ca/en/a.html"],
      ["s2", "blocked", "moved_off_host", "https://www.canada.ca/en/b.html"],
      ["s3", "unchanged", null, "https://www.canada.ca/en/c.html"],
      ["s3", "failed", "record_refused", "https://www.canada.ca/en/c.html"],
      ["s4", "unchanged", null, "https://www.canada.ca/en/d.html"],
    ]);
  });
});
