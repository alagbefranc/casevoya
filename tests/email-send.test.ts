import { describe, expect, it, vi } from "vitest";
import { cloudflareSendBody, sendCloudflareEmail, type OutboundEmail } from "@/modules/email/cloudflare";
import { dispatchOutbound, type DispatchDeps, type PreparedMail } from "@/modules/email/dispatch";
import { processInboundEmail, type InboundDeps } from "@/modules/email/inbound";

const email: OutboundEmail = {
  to: "client@example.test",
  fromAddress: "notices@casevoya.ca",
  fromName: "Northline",
  replyToAddress: "northline@docs.casevoya.ca",
  replyToName: "Northline",
  subject: "Invitation from Northline",
  html: "<p>Hello</p>",
  text: "Hello\n",
};

describe("cloudflare email sending", () => {
  it("posts from and reply_to as address objects and maps bounces", async () => {
    const fetchImpl = vi.fn(async (_url: string, init: { body: string }) => {
      const body = JSON.parse(init.body) as Record<string, unknown>;
      expect(body.from).toEqual({ address: "notices@casevoya.ca", name: "Northline" });
      expect(body.reply_to).toEqual({ address: "northline@docs.casevoya.ca", name: "Northline" });
      expect(body.html).toBe("<p>Hello</p>");
      expect(body.text).toBe("Hello\n");
      return {
        ok: true,
        status: 200,
        json: async () => ({
          success: true,
          result: {
            delivered: [],
            permanent_bounces: ["client@example.test"],
            queued: [],
            suppressed_recipients: [],
            message_id: "msg-1",
          },
        }),
      };
    });
    expect(cloudflareSendBody(email).from).toEqual({ address: "notices@casevoya.ca", name: "Northline" });
    const result = await sendCloudflareEmail(email, {
      accountId: "c8010438fc56280e3ea5747a123e818a",
      token: "test-token",
      fetchImpl,
    });
    expect(result).toMatchObject({ ok: true, messageId: "msg-1", permanentBounces: ["client@example.test"] });
  });

  it("retries throttling and stops on a rejected token", async () => {
    const throttled = await sendCloudflareEmail(email, {
      accountId: "account",
      token: "token",
      fetchImpl: async () => ({
        ok: false,
        status: 429,
        json: async () => ({ success: false, errors: [{ code: 10004, message: "throttled" }] }),
      }),
    });
    expect(throttled).toEqual({ ok: false, retry: true, error: "throttled" });
    const denied = await sendCloudflareEmail(email, {
      accountId: "account",
      token: "token",
      fetchImpl: async () => ({
        ok: false,
        status: 401,
        json: async () => ({ success: false, errors: [{ code: 10000, message: "unauthorized" }] }),
      }),
    });
    expect(denied).toEqual({ ok: false, retry: false, error: "unauthorized" });
  });
});

describe("dispatch", () => {
  it("sends once and does not send a prepared done event again", async () => {
    const sent: string[] = [];
    const finished: string[] = [];
    let prepares = 0;
    const deps: DispatchDeps = {
      claim: async () => [{ id: "event-1" }],
      prepare: async () => {
        prepares += 1;
        const prepared: PreparedMail =
          prepares === 1
            ? {
                action: "send",
                messages: [
                  {
                    delivery_id: "delivery-1",
                    to: email.to,
                    from_address: email.fromAddress,
                    from_name: email.fromName,
                    reply_to_address: email.replyToAddress,
                    reply_to_name: email.replyToName,
                    template: "invite",
                    context: { firm: "Northline", kind: "portal", template: "invite" },
                  },
                ],
              }
            : { action: "done", messages: [] };
        return prepared;
      },
      send: async (message) => {
        sent.push(message.to);
        return {
          ok: true,
          messageId: "msg-1",
          delivered: [message.to],
          queued: [],
          permanentBounces: [],
          suppressed: [],
        };
      },
      finish: async (deliveryId) => {
        finished.push(deliveryId);
      },
    };
    const first = await dispatchOutbound(deps, {
      worker: "test",
      limit: 10,
      inboundDomain: "docs.casevoya.ca",
      fromAddress: "notices@casevoya.ca",
    });
    const second = await dispatchOutbound(deps, {
      worker: "test",
      limit: 10,
      inboundDomain: "docs.casevoya.ca",
      fromAddress: "notices@casevoya.ca",
    });
    expect(first.sent).toBe(1);
    expect(second.sent).toBe(0);
    expect(sent).toEqual(["client@example.test"]);
    expect(finished).toEqual(["delivery-1"]);
  });

  it("asks for a retry when the provider throttles", async () => {
    const outcomes: string[] = [];
    await dispatchOutbound(
      {
        claim: async () => [{ id: "event-1" }],
        prepare: async () => ({
          action: "send",
          messages: [
            {
              delivery_id: "delivery-1",
              to: email.to,
              from_address: email.fromAddress,
              from_name: email.fromName,
              reply_to_address: email.replyToAddress,
              reply_to_name: email.replyToName,
              template: "reminder",
              context: { firm: "Northline", template: "reminder" },
            },
          ],
        }),
        send: async () => ({ ok: false, retry: true, error: "throttled" }),
        finish: async (_id, _worker, outcome) => {
          outcomes.push(outcome);
        },
      },
      { worker: "test", limit: 1, inboundDomain: "docs.casevoya.ca", fromAddress: "notices@casevoya.ca" },
    );
    expect(outcomes).toEqual(["retry"]);
  });
});

describe("inbound orchestration", () => {
  it("files a known sender through upload intent and an unknown sender in the inbox", async () => {
    const puts: string[] = [];
    const pdf = Buffer.from("%PDF-1.4\n");
    const deps = (person: string | null): InboundDeps => ({
      domain: "docs.casevoya.ca",
      begin: async () => ({
        status: "accepted",
        inbound_email_id: "mail-1",
        matter_id: person ? "matter-1" : null,
        person_id: person,
      }),
      createIntent: async () => ({ storage_key: "org/quarantine/version/key", declared_media_type: "application/pdf" }),
      completeUpload: async () => undefined,
      openUnsorted: async () => ({ storage_key: "org/inbox/item/key" }),
      finishUnsorted: async () => undefined,
      putObject: async (input) => {
        puts.push(input.key);
      },
      finishMessage: async () => undefined,
      abandonMessage: async () => undefined,
    });
    const known = await processInboundEmail(
      {
        from: "client@example.test",
        to: "northline@docs.casevoya.ca",
        messageId: "<a@example.test>",
        attachments: [{ filename: "scan.pdf", mimeType: "application/pdf", contentBase64: pdf.toString("base64") }],
      },
      deps("person-1"),
    );
    const unsorted = await processInboundEmail(
      {
        from: "stranger@example.test",
        to: "northline@docs.casevoya.ca",
        messageId: "<b@example.test>",
        attachments: [{ filename: "scan.pdf", mimeType: "application/pdf", contentBase64: pdf.toString("base64") }],
      },
      deps(null),
    );
    expect(known.status).toBe("accepted");
    expect(unsorted.status).toBe("accepted");
    expect(puts).toEqual(["org/quarantine/version/key", "org/inbox/item/key"]);
  });

  it("drops a duplicate without storing another file", async () => {
    const puts: string[] = [];
    const result = await processInboundEmail(
      { from: "a@example.test", to: "northline@docs.casevoya.ca", messageId: "<a>", attachments: [] },
      {
        domain: "docs.casevoya.ca",
        begin: async () => ({ status: "duplicate", inbound_email_id: "mail-1", attachments_done: true }),
        createIntent: async () => ({ storage_key: "unused" }),
        completeUpload: async () => undefined,
        openUnsorted: async () => ({ storage_key: "unused" }),
        finishUnsorted: async () => undefined,
        putObject: async (input) => {
          puts.push(input.key);
        },
        finishMessage: async () => undefined,
        abandonMessage: async () => undefined,
      },
    );
    expect(result.status).toBe("duplicate");
    expect(puts).toEqual([]);
  });
});

describe("inbound resume binding and attachment close-out", () => {
  const pdf = Buffer.from("%PDF-1.4\n%synthetic\n");
  const zip = Buffer.from([0x50, 0x4b, 0x03, 0x04, ...new Array(40).fill(0)]);

  function linkedDeps(over: Partial<InboundDeps> = {}) {
    const calls = {
      digests: [] as string[],
      completed: [] as { mediaType: string | null; byteSize: number; sha256: string }[],
      abandoned: [] as string[],
      finished: 0,
    };
    const deps: InboundDeps = {
      domain: "docs.casevoya.ca",
      begin: async (input) => {
        calls.digests.push(input.contentDigest);
        return { status: "accepted", inbound_email_id: "mail-1", matter_id: "matter-1", person_id: "person-1" };
      },
      createIntent: async () => ({ storage_key: "org/quarantine/version/key", declared_media_type: "application/pdf" }),
      completeUpload: async (input) => {
        calls.completed.push({ mediaType: input.mediaType, byteSize: input.byteSize, sha256: input.sha256 });
      },
      openUnsorted: async () => ({ storage_key: "org/inbox/item/key" }),
      finishUnsorted: async () => undefined,
      putObject: async () => undefined,
      finishMessage: async () => {
        calls.finished += 1;
      },
      abandonMessage: async (_id, reason) => {
        calls.abandoned.push(reason);
      },
      ...over,
    };
    return { deps, calls };
  }

  const message = (subject: string, files: Buffer[]) => ({
    from: "client@example.test",
    to: "northline@docs.casevoya.ca",
    messageId: "<m@example.test>",
    subject,
    text: "Please file these.",
    attachments: files.map((bytes, index) => ({ filename: `file${index}.pdf`, mimeType: "application/pdf", contentBase64: bytes.toString("base64") })),
  });

  it("passes a digest of subject, text and attachment hashes that changes with the content", async () => {
    const { deps, calls } = linkedDeps();
    await processInboundEmail(message("Passport", [pdf]), deps);
    await processInboundEmail(message("Passport", [pdf]), deps);
    await processInboundEmail(message("Passport", [zip]), deps);
    await processInboundEmail(message("Other", [pdf]), deps);
    expect(calls.digests[0]).toMatch(/^[0-9a-f]{64}$/);
    expect(calls.digests[1]).toBe(calls.digests[0]);
    expect(calls.digests[2]).not.toBe(calls.digests[0]);
    expect(calls.digests[3]).not.toBe(calls.digests[0]);
  });

  it("completes with server-measured values; a plain ZIP has no media type", async () => {
    const { deps, calls } = linkedDeps();
    await processInboundEmail(message("Files", [pdf, zip]), deps);
    expect(calls.completed.map((row) => row.mediaType)).toEqual(["application/pdf", null]);
    expect(calls.completed[0].byteSize).toBe(pdf.byteLength);
    expect(calls.finished).toBe(1);
  });

  it("closes the message when an attachment step fails", async () => {
    const failing = linkedDeps({
      createIntent: async () => {
        throw new Error("file is above the upload limit");
      },
    });
    await expect(processInboundEmail(message("Files", [pdf]), failing.deps)).rejects.toThrow(/upload limit/);
    expect(failing.calls.abandoned).toEqual(["attachment_error"]);
    expect(failing.calls.finished).toBe(0);

    const capped = linkedDeps({
      createIntent: async () => {
        throw new Error("inbound attachment limit reached for this hour");
      },
    });
    expect(await processInboundEmail(message("Files", [pdf]), capped.deps)).toEqual({ status: "attachments_refused" });
    expect(capped.calls.abandoned).toEqual(["attachment_limit"]);
  });

  it("leaves the message open on a temporary error so the retry resumes", async () => {
    let attempts = 0;
    const flaky = linkedDeps({
      putObject: async () => {
        attempts += 1;
        if (attempts === 1) throw new Error("fetch failed: ECONNRESET");
      },
    });
    await expect(processInboundEmail(message("Files", [pdf]), flaky.deps)).rejects.toThrow(/ECONNRESET/);
    expect(flaky.calls.abandoned).toEqual([]);
    expect(flaky.calls.finished).toBe(0);
    // The retry is not closed, so it stores the attachment and finishes.
    expect(await processInboundEmail(message("Files", [pdf]), flaky.deps)).toEqual({ status: "accepted" });
    expect(flaky.calls.completed).toHaveLength(1);
    expect(flaky.calls.finished).toBe(1);

    const storage = linkedDeps({
      completeUpload: async () => {
        throw new Error("stored object was not found");
      },
    });
    await expect(processInboundEmail(message("Files", [pdf]), storage.deps)).rejects.toThrow(/not found/);
    expect(storage.calls.abandoned).toEqual([]);
  });
});
