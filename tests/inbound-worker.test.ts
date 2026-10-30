import { describe, expect, it, vi } from "vitest";
import { verifyPayload } from "@/modules/email/sign";
import { handleInboundEmail, senderVerified, type InboundEmailMessage } from "../workers/inbound-email/src/index";

const RAW = [
  "From: Client <client@example.test>",
  "To: northline@docs.casevoya.ca",
  "Subject: Passport",
  "Message-ID: <abc@example.test>",
  "MIME-Version: 1.0",
  "Content-Type: text/plain; charset=utf-8",
  "",
  "Please file this.",
  "",
].join("\r\n");

function fakeMessage(overrides: Partial<InboundEmailMessage> = {}) {
  let readers = 0;
  const setReject = vi.fn();
  const message: InboundEmailMessage & { readers: () => number } = {
    to: "northline@docs.casevoya.ca",
    from: "client@example.test",
    rawSize: RAW.length,
    setReject,
    raw: {
      getReader() {
        readers += 1;
        const bytes = new TextEncoder().encode(RAW);
        let sent = false;
        return {
          async read() {
            if (sent) return { done: true as const, value: undefined };
            sent = true;
            return { done: false as const, value: bytes };
          },
          releaseLock() {},
          cancel() {
            return Promise.resolve();
          },
        } as ReadableStreamDefaultReader<Uint8Array>;
      },
    } as ReadableStream<Uint8Array>,
    readers: () => readers,
    ...overrides,
  };
  return { message, setReject };
}

describe("inbound email worker", () => {
  it("reads the raw message once and signs the webhook body", async () => {
    const { message } = fakeMessage();
    let signed = "";
    let posted = "";
    const fetchImpl = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      posted = String(init?.body ?? "");
      const headers = new Headers(init?.headers);
      signed = headers.get("x-casevoya-signature") ?? "";
      const timestamp = headers.get("x-casevoya-timestamp") ?? "";
      expect(await verifyPayload("hook-secret", timestamp, posted, signed)).toBe(true);
      return new Response("{}", { status: 200 });
    });
    await handleInboundEmail(
      message,
      {
        INBOUND_WEBHOOK_URL: "https://app.example/api/email/inbound",
        INBOUND_WEBHOOK_SECRET: "hook-secret",
        INBOUND_EMAIL_DOMAIN: "docs.casevoya.ca",
      },
      fetchImpl,
    );
    expect(message.readers()).toBe(1);
    const body = JSON.parse(posted) as { to: string; messageId: string; text: string; senderVerified: boolean };
    expect(body.senderVerified).toBe(false);
    expect(body.to).toBe("northline@docs.casevoya.ca");
    expect(body.messageId).toContain("abc@example.test");
    expect(body.text).toContain("Please file this.");
  });

  it("rejects with a temporary reason when the app refuses the message for rate or size limits", async () => {
    const env = { INBOUND_WEBHOOK_URL: "https://app.example/api/email/inbound", INBOUND_WEBHOOK_SECRET: "hook-secret", INBOUND_EMAIL_DOMAIN: "docs.casevoya.ca" };
    const limited = fakeMessage();
    await handleInboundEmail(limited.message, env, vi.fn<typeof fetch>(async () => new Response("{}", { status: 429 })));
    expect(limited.setReject).toHaveBeenCalledWith(expect.stringMatching(/try again later/i));

    const tooBig = fakeMessage();
    await handleInboundEmail(tooBig.message, env, vi.fn<typeof fetch>(async () => new Response("{}", { status: 413 })));
    expect(tooBig.setReject).toHaveBeenCalledWith(expect.stringMatching(/again later/i));

    const failed = fakeMessage();
    await expect(
      handleInboundEmail(failed.message, env, vi.fn<typeof fetch>(async () => new Response("{}", { status: 500 }))),
    ).rejects.toThrow(/500/);
    expect(failed.setReject).not.toHaveBeenCalled();
  });

  it("rejects another domain and an oversized message before reading", async () => {
    const wrong = fakeMessage({ to: "northline@in.casevoya.ca" });
    await handleInboundEmail(wrong.message, {
      INBOUND_WEBHOOK_URL: "https://app.example/api/email/inbound",
      INBOUND_WEBHOOK_SECRET: "hook-secret",
    });
    expect(wrong.setReject).toHaveBeenCalled();
    expect(wrong.message.readers()).toBe(0);

    const huge = fakeMessage({ rawSize: 26 * 1024 * 1024 });
    await handleInboundEmail(huge.message, {
      INBOUND_WEBHOOK_URL: "https://app.example/api/email/inbound",
      INBOUND_WEBHOOK_SECRET: "hook-secret",
      INBOUND_EMAIL_DOMAIN: "docs.casevoya.ca",
    });
    expect(huge.setReject).toHaveBeenCalled();
    expect(huge.message.readers()).toBe(0);
  });
});

describe("inbound email worker: no automatic replies (OPS-06)", () => {
  it("never replies to or forwards mail from an unknown sender; it only posts the signed webhook", async () => {
    const { message, setReject } = fakeMessage({ from: "stranger@unknown.example" });
    const reply = vi.fn();
    const forward = vi.fn();
    // Cloudflare's ForwardableEmailMessage also has reply() and forward(); the worker must use neither.
    Object.assign(message, { reply, forward });
    const fetchImpl = vi.fn<typeof fetch>(async () => new Response("{}", { status: 200 }));
    await handleInboundEmail(
      message,
      { INBOUND_WEBHOOK_URL: "https://app.example/api/email/inbound", INBOUND_WEBHOOK_SECRET: "hook-secret", INBOUND_EMAIL_DOMAIN: "docs.casevoya.ca" },
      fetchImpl,
    );
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(String(fetchImpl.mock.calls[0][0])).toBe("https://app.example/api/email/inbound");
    expect(reply).not.toHaveBeenCalled();
    expect(forward).not.toHaveBeenCalled();
    expect(setReject).not.toHaveBeenCalled();
  });

  it("rejects a wrong domain with a reason that names no firm, matter or file", async () => {
    const { message, setReject } = fakeMessage({ to: "northline+0123456789abcdef0123456789abcdef@other.example" });
    await handleInboundEmail(message, { INBOUND_WEBHOOK_URL: "https://app.example/api/email/inbound", INBOUND_WEBHOOK_SECRET: "hook-secret" });
    expect(setReject).toHaveBeenCalledWith("Unknown recipient domain");
  });
});

describe("sender verification", () => {
  const stamped = (value: string) => [
    { key: "authentication-results", value },
    { key: "authentication-results", value: "attacker.example; dmarc=pass header.from=example.test" },
  ];

  it("trusts only an aligned DMARC pass from the configured receiver", () => {
    expect(
      senderVerified(stamped("mx.cloudflare.net; spf=pass; dmarc=pass header.from=example.test"), "client@example.test", "mx.cloudflare.net"),
    ).toBe(true);
  });

  it("ignores a forged header below the receiver's own", () => {
    expect(
      senderVerified(stamped("mx.cloudflare.net; dmarc=fail header.from=example.test"), "client@example.test", "mx.cloudflare.net"),
    ).toBe(false);
  });

  it("rejects a pass for a different From domain, another receiver, or no configured id", () => {
    const headers = stamped("mx.cloudflare.net; dmarc=pass header.from=other.test");
    expect(senderVerified(headers, "client@example.test", "mx.cloudflare.net")).toBe(false);
    expect(
      senderVerified([{ key: "Authentication-Results", value: "attacker.example; dmarc=pass header.from=example.test" }], "client@example.test", "mx.cloudflare.net"),
    ).toBe(false);
    expect(
      senderVerified(stamped("mx.cloudflare.net; dmarc=pass header.from=example.test"), "client@example.test", undefined),
    ).toBe(false);
  });
});
