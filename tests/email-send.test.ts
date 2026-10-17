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
      },
    );
    expect(result.status).toBe("duplicate");
    expect(puts).toEqual([]);
  });
});
