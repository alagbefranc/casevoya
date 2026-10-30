import { describe, expect, it } from "vitest";
import { INBOUND_BODY_LIMIT_BYTES, inboundResultStatus, readBodyWithLimit } from "@/modules/email/inbound-body";

function streamOf(chunks: Uint8Array[]) {
  let index = 0;
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (index < chunks.length) controller.enqueue(chunks[index++]);
      else controller.close();
    },
  });
}

describe("inbound webhook body limit", () => {
  it("refuses a declared length over the cap without reading the body", async () => {
    const request = new Request("https://app.example/api/email/inbound", {
      method: "POST",
      headers: { "content-length": String(INBOUND_BODY_LIMIT_BYTES + 1) },
      body: streamOf([new Uint8Array(10)]),
      duplex: "half",
    } as RequestInit);
    expect(await readBodyWithLimit(request)).toEqual({ ok: false, status: 413 });
    expect(request.bodyUsed).toBe(false);
  });

  it("stops reading a body without a length once it passes the cap", async () => {
    const chunk = new Uint8Array(64).fill(65);
    const request = new Request("https://app.example/api/email/inbound", {
      method: "POST",
      body: streamOf([chunk, chunk, chunk]),
      duplex: "half",
    } as RequestInit);
    expect(await readBodyWithLimit(request, 100)).toEqual({ ok: false, status: 413 });
  });

  it("returns the text of a body within the cap", async () => {
    const request = new Request("https://app.example/api/email/inbound", { method: "POST", body: '{"a":"é"}' });
    expect(await readBodyWithLimit(request, 100)).toEqual({ ok: true, text: '{"a":"é"}' });
  });

  it("does not acknowledge refusals that did not deliver the message", () => {
    expect(inboundResultStatus("rate_limited")).toBe(429);
    expect(inboundResultStatus("attachments_refused")).toBe(413);
    expect(inboundResultStatus("unknown_firm")).toBe(422);
    expect(inboundResultStatus("accepted")).toBe(200);
    expect(inboundResultStatus("duplicate")).toBe(200);
  });
});
