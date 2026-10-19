import { afterEach, describe, expect, it, vi } from "vitest";
import { templateRequests, WEBHOOK_EVENTS } from "../scripts/ops/zernio-whatsapp.mjs";
import { integrationsData, type IntegrationsInput, type WhatsAppInput } from "@/modules/sheet/settings-integrations-present";
import { whatsappLine } from "@/modules/messages/present";
import { dispatchWhatsApp, type WhatsAppDispatchDeps } from "@/modules/whatsapp/dispatch";
import { displayPhone, normalizePhoneE164, participantId } from "@/modules/whatsapp/phone";
import { verifyZernioSignature, zernioSignature } from "@/modules/whatsapp/signature";
import {
  assertSafeTemplateParams,
  buildTemplateSend,
  buildTextReply,
  noticeTemplateFor,
  SensitiveContentError,
  templateCreateRequest,
  WHATSAPP_TEMPLATES,
  type PreparedWhatsApp,
  type TemplateName,
} from "@/modules/whatsapp/templates";
import { parseZernioEvent } from "@/modules/whatsapp/webhook";
import { createZernioClient } from "@/modules/whatsapp/zernio";

/**
 * WhatsApp through Zernio, pure parts: phone numbers, the webhook signature, the payload
 * builders and the no-sensitive-content guard, webhook parsing, the worker with a mocked Zernio,
 * and the Settings row. Zernio is never called: every HTTP call goes to a mock fetch.
 */

const PREPARED: PreparedWhatsApp = {
  delivery_id: "00000000-0000-4000-8000-000000000001",
  account_id: "acct123",
  to: "14312753986",
  kind: "template",
  template_name: "casevoya_portal_notice",
  template_language: "en",
  firm_name: "Synthetic Firm",
  body: null,
  conversation_id: null,
};

describe("phone numbers", () => {
  it("normalizes to E.164 the same way the database does", () => {
    expect(normalizePhoneE164("+1 431 275 3986")).toBe("+14312753986");
    expect(normalizePhoneE164("(431) 275-3986")).toBe("+14312753986");
    expect(normalizePhoneE164("1-431-275-3986")).toBe("+14312753986");
    expect(normalizePhoneE164("0044 20 7946 0958")).toBe("+442079460958");
    expect(normalizePhoneE164("+91 98200 41177")).toBe("+919820041177");
    for (const bad of ["", "12", "+0 431 275 3986", "431 CALL NOW", "+1 431 275 3986 1234 5678", "0431 275 3986", null, undefined]) {
      expect(normalizePhoneE164(bad), String(bad)).toBeNull();
    }
    expect(participantId("+1 431 275 3986")).toBe("14312753986");
    expect(() => participantId("nope")).toThrow();
    expect(displayPhone("+14312753986")).toBe("+1 431 275 3986");
    expect(displayPhone("+442079460958")).toBe("+442079460958");
  });
});

describe("webhook signature", () => {
  const SECRET = "synthetic-webhook-secret-for-tests-only";
  const BODY = JSON.stringify({ id: "evt1", event: "message.received" });

  it("accepts the hex HMAC-SHA256 of the raw body and nothing else", async () => {
    const good = await zernioSignature(SECRET, BODY);
    expect(good).toMatch(/^[0-9a-f]{64}$/);
    expect(await verifyZernioSignature(SECRET, BODY, good)).toBe(true);
    expect(await verifyZernioSignature(SECRET, BODY, good.toUpperCase())).toBe(true);
    expect(await verifyZernioSignature(SECRET, `${BODY} `, good)).toBe(false);
    expect(await verifyZernioSignature("another-secret", BODY, good)).toBe(false);
    expect(await verifyZernioSignature(SECRET, BODY, null)).toBe(false);
    expect(await verifyZernioSignature(SECRET, BODY, "sha256=" + good)).toBe(false);
    expect(await verifyZernioSignature("", BODY, good)).toBe(false);
  });

  it("refuses an unsigned or wrongly signed webhook before reading it", async () => {
    vi.stubEnv("ZERNIO_WEBHOOK_SECRET", SECRET);
    vi.stubEnv("SUPABASE_SECRET_KEY", "synthetic-service-key");
    const { POST } = await import("@/app/api/zernio/webhook/route");
    const unsigned = await POST(new Request("https://app.test/api/zernio/webhook", { method: "POST", body: BODY }));
    expect(unsigned.status).toBe(401);
    const wrong = await POST(
      new Request("https://app.test/api/zernio/webhook", { method: "POST", body: BODY, headers: { "X-Zernio-Signature": await zernioSignature("other", BODY) } }),
    );
    expect(wrong.status).toBe(401);
    // A correctly signed test event is acknowledged without touching the database.
    const test = JSON.stringify({ id: "evt0", event: "webhook.test", message: "test" });
    const ok = await POST(new Request("https://app.test/api/zernio/webhook", { method: "POST", body: test, headers: { "X-Zernio-Signature": await zernioSignature(SECRET, test) } }));
    expect(ok.status).toBe(200);
    vi.unstubAllEnvs();
  });
});

describe("templates and the no-sensitive-content guard", () => {
  it("defines UTILITY templates whose only variable is the firm name, with the portal link", () => {
    for (const template of Object.values(WHATSAPP_TEMPLATES)) {
      expect(template.category).toBe("UTILITY");
      expect(template.body.match(/\{\{\d+\}\}/g)).toEqual(["{{1}}"]);
      // Meta refuses a body that starts or ends with a variable.
      expect(template.body.startsWith("{{")).toBe(false);
      expect(template.body.endsWith("}}")).toBe(false);
      expect(template.body).toContain("secure portal");
      const created = templateCreateRequest(template.name, "acct123", "https://app.casevoya.ca");
      expect(created.components[0].text).toContain("https://app.casevoya.ca/portal");
    }
    expect(noticeTemplateFor("reminder")).toBe("casevoya_portal_reminder");
    expect(noticeTemplateFor("consultation_booked")).toBe("casevoya_portal_reminder");
    expect(noticeTemplateFor("document_request")).toBe("casevoya_portal_notice");
    expect(noticeTemplateFor("invoice")).toBe("casevoya_portal_notice");
  });

  it("keeps the operator script's template copy identical to the app's", () => {
    const fromScript = templateRequests("acct123", "https://app.casevoya.ca");
    const fromApp = (Object.keys(WHATSAPP_TEMPLATES) as TemplateName[]).map((name) => templateCreateRequest(name, "acct123", "https://app.casevoya.ca"));
    expect(fromScript).toEqual(fromApp);
    expect(WEBHOOK_EVENTS).toEqual(["message.received", "message.delivered", "message.read", "message.failed"]);
  });

  it("sends the firm name and nothing else, whatever else the notice was about", () => {
    const sent = buildTemplateSend({ ...PREPARED, body: "Passport scan for UCI 1234-5678 due 2030-01-01, invoice $1,250.00" });
    expect(sent).toEqual({
      accountId: "acct123",
      participantId: "14312753986",
      templateName: "casevoya_portal_notice",
      templateLanguage: "en",
      templateParams: ["Synthetic Firm"],
    });
    const json = JSON.stringify(sent);
    for (const leak of ["Passport", "UCI", "1234", "2030", "$", "invoice"]) expect(json).not.toContain(leak);
  });

  it("refuses template variables that are anything but a plain firm name", () => {
    const refuse = (params: unknown[], firm = "Synthetic Firm") => expect(() => assertSafeTemplateParams(params, firm)).toThrow(SensitiveContentError);
    refuse(["Synthetic Firm", "Passport scan"]);
    refuse(["Study permit application"]);
    refuse([]);
    refuse(["UCI 12345678"], "UCI 12345678");
    refuse(["Firm 1234-5678"], "Firm 1234-5678");
    refuse(["Pay $500"], "Pay $500");
    refuse(["500 CAD"], "500 CAD");
    refuse(["a@b.test"], "a@b.test");
    refuse(["Visit https://x.test"], "Visit https://x.test");
    refuse(["Line\nbreak"], "Line\nbreak");
    refuse(["x".repeat(61)], "x".repeat(61));
    expect(() => assertSafeTemplateParams(["Northline Immigration"], "Northline Immigration")).not.toThrow();
    expect(() => assertSafeTemplateParams(["24/7 Visa Help"], "24/7 Visa Help")).not.toThrow();
    // A firm name that would carry a number is refused before anything is sent.
    expect(() => buildTemplateSend({ ...PREPARED, firm_name: "Client 12345678" })).toThrow(SensitiveContentError);
    // Only Casevoya's own templates can open a conversation.
    expect(() => buildTemplateSend({ ...PREPARED, template_name: "marketing_blast" })).toThrow(SensitiveContentError);
  });

  it("uses only the sandbox's own template on Zernio's sandbox number", () => {
    expect(buildTemplateSend({ ...PREPARED, sandbox: true, template_name: "sandbox_start" })).toEqual({
      accountId: "acct123",
      participantId: "14312753986",
      templateName: "sandbox_start",
      templateLanguage: "en",
      templateParams: [],
    });
    expect(() => buildTemplateSend({ ...PREPARED, sandbox: false, template_name: "sandbox_start" })).toThrow(SensitiveContentError);
  });

  it("builds a reply only inside an open conversation, with the staff member's text", () => {
    const reply = buildTextReply({ ...PREPARED, kind: "text", template_name: null, body: " Yes, all on track. ", conversation_id: "conv1" });
    expect(reply).toEqual({ conversationId: "conv1", body: { accountId: "acct123", message: "Yes, all on track." } });
    expect(() => buildTextReply({ ...PREPARED, kind: "text", body: "Hi", conversation_id: null })).toThrow();
    expect(() => buildTextReply({ ...PREPARED, kind: "text", body: "", conversation_id: "conv1" })).toThrow();
  });
});

describe("webhook payloads", () => {
  const account = { id: "acct123", accountId: "acct123", platform: "whatsapp", username: "+1 431 555 0000" };
  it("reads an incoming WhatsApp message", () => {
    const event = parseZernioEvent({
      id: "evt1",
      event: "message.received",
      account,
      conversation: { id: "conv1", platformConversationId: "p1", status: "active" },
      message: {
        id: "m1",
        conversationId: "conv1",
        platform: "whatsapp",
        platformMessageId: "wamid.ABC",
        direction: "incoming",
        text: "Synthetic: hello",
        attachments: [],
        sender: { id: "14312753986", name: "Synthetic", phoneNumber: "+14312753986" },
        sentAt: "2026-10-19T12:00:00Z",
        isRead: false,
      },
      timestamp: "2026-10-19T12:00:01Z",
    });
    expect(event).toEqual({
      kind: "received",
      eventId: "evt1",
      accountId: "acct123",
      platformMessageId: "wamid.ABC",
      conversationId: "conv1",
      phone: "+14312753986",
      bsuid: null,
      senderName: "Synthetic",
      text: "Synthetic: hello",
      hasAttachments: false,
      sentAt: "2026-10-19T12:00:00.000Z",
    });
    // Without phoneNumber the sender id (digits) is the number; a username-only sender has none.
    const viaId = parseZernioEvent({ id: "e", event: "message.received", account, message: { platform: "whatsapp", direction: "incoming", platformMessageId: "w", sender: { id: "14312753986" } } });
    expect(viaId.kind === "received" && viaId.phone).toBe("+14312753986");
    const bsuid = parseZernioEvent({ id: "e", event: "message.received", account, message: { platform: "whatsapp", direction: "incoming", platformMessageId: "w", sender: { id: "CA.abc", businessScopedUserId: "CA.abc" } } });
    expect(bsuid.kind === "received" && [bsuid.phone, bsuid.bsuid]).toEqual([null, "CA.abc"]);
  });

  it("reads delivery status, and ignores everything it does not handle", () => {
    const message = { platform: "whatsapp", platformMessageId: "wamid.OUT", direction: "outgoing" };
    expect(parseZernioEvent({ id: "e2", event: "message.read", account, message, statusAt: "2026-10-19T12:05:00Z" })).toMatchObject({
      kind: "status",
      providerMessageId: "wamid.OUT",
      status: "read",
      at: "2026-10-19T12:05:00.000Z",
    });
    expect(parseZernioEvent({ id: "e3", event: "message.failed", account, message, error: { code: 131026, title: "Receiver is incapable" } })).toMatchObject({
      kind: "status",
      status: "failed",
      error: "131026 Receiver is incapable",
    });
    expect(parseZernioEvent({ id: "e4", event: "webhook.test" })).toEqual({ kind: "test" });
    expect(parseZernioEvent({ id: "e5", event: "message.received", test: true, account, message })).toEqual({ kind: "test" });
    expect(parseZernioEvent({ id: "e6", event: "message.received", account, message: { ...message, platform: "instagram" } }).kind).toBe("ignore");
    expect(parseZernioEvent({ id: "e7", event: "message.received", account, message }).kind).toBe("ignore");
    expect(parseZernioEvent({ id: "e8", event: "post.published", account, message: { platform: "whatsapp" } }).kind).toBe("ignore");
    expect(parseZernioEvent("not json").kind).toBe("ignore");
  });
});

describe("Zernio client (mocked HTTP)", () => {
  afterEach(() => vi.restoreAllMocks());

  it("sends a template with the bearer key and an idempotency key, and reads the message id", async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const fetch = vi.fn(async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return new Response(JSON.stringify({ success: true, data: { messageId: "wamid.SENT", conversationId: "conv9", participantId: "14312753986" } }), { status: 201 });
    });
    const client = createZernioClient({ apiKey: "synthetic-key", fetch });
    const result = await client.sendTemplate(buildTemplateSend(PREPARED), "casevoya-wa-1");
    expect(result).toEqual({ ok: true, status: 201, data: { messageId: "wamid.SENT", conversationId: "conv9" } });
    expect(calls[0].url).toBe("https://zernio.com/api/v1/inbox/conversations");
    const headers = calls[0].init.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer synthetic-key");
    expect(headers["Idempotency-Key"]).toBe("casevoya-wa-1");
    expect(JSON.parse(String(calls[0].init.body)).templateParams).toEqual(["Synthetic Firm"]);
  });

  it("says which failures to retry, and never runs without a key", async () => {
    const answer = (status: number, body: object) => createZernioClient({ apiKey: "k", fetch: async () => new Response(JSON.stringify(body), { status }) });
    expect(await answer(429, { error: "slow down", code: "rate_limited" }).numberInfo("a")).toMatchObject({ ok: false, retry: true, code: "rate_limited" });
    expect(await answer(400, { error: "Meta will not let Zernio read this WhatsApp object" }).numberInfo("a")).toMatchObject({ ok: false, status: 400, retry: false });
    const offline = createZernioClient({ apiKey: "k", fetch: async () => Promise.reject(new Error("offline")) });
    expect(await offline.phoneNumbers()).toMatchObject({ ok: false, status: 0, retry: true });
    const noKey = vi.fn();
    expect(await createZernioClient({ apiKey: "", fetch: noKey }).phoneNumbers()).toMatchObject({ ok: false, code: "not_configured" });
    expect(noKey).not.toHaveBeenCalled();
  });

  it("finds the firm's profile again after a duplicate, and builds the Embedded Signup link", async () => {
    const fetch = vi.fn(async (url: string, init: RequestInit) => {
      if (init.method === "POST") return new Response(JSON.stringify({ error: "exists", code: "profile_external_id_conflict" }), { status: 409 });
      if (url.includes("/profiles")) return new Response(JSON.stringify({ profiles: [{ _id: "prof1", externalId: "org-1" }] }), { status: 200 });
      return new Response(JSON.stringify({ authUrl: "https://www.facebook.com/v21.0/dialog/oauth?x=1", state: "s" }), { status: 200 });
    });
    const client = createZernioClient({ apiKey: "k", fetch });
    expect(await client.ensureProfile({ organizationId: "org-1", name: "Synthetic Firm" })).toMatchObject({ ok: true, data: { profileId: "prof1" } });
    const link = await client.connectUrl({ profileId: "prof1", redirectUrl: "https://app.casevoya.ca/sheet/settings?tab=integrations&wa=1" });
    expect(link).toMatchObject({ ok: true, data: { authUrl: "https://www.facebook.com/v21.0/dialog/oauth?x=1" } });
    const url = new URL(fetch.mock.calls[2][0]);
    expect(url.pathname).toBe("/api/v1/connect/whatsapp");
    expect(Object.fromEntries(url.searchParams)).toEqual({ profileId: "prof1", redirect_url: "https://app.casevoya.ca/sheet/settings?tab=integrations&wa=1", onboarding: "api" });
  });
});

describe("WhatsApp worker", () => {
  function deps(prepared: Record<string, unknown>[], send: WhatsAppDispatchDeps["zernio"]) {
    const finished: unknown[][] = [];
    const queue = [...prepared];
    const value: WhatsAppDispatchDeps = {
      claim: async () => prepared.map((_, index) => ({ id: `evt${index}` })),
      prepare: async () => queue.shift() ?? { action: "done" },
      finish: async (...args) => {
        finished.push(args);
      },
      zernio: send,
    };
    return { value, finished };
  }
  const send = (row: Partial<PreparedWhatsApp> = {}) => ({ action: "send", ...PREPARED, ...row });

  it("sends, records Zernio's message id, and skips events the database closed", async () => {
    const sendTemplate = vi.fn(async () => ({ ok: true as const, status: 201, data: { messageId: "wamid.1", conversationId: "conv1" } }));
    const sendText = vi.fn(async () => ({ ok: true as const, status: 200, data: { messageId: "wamid.2", conversationId: "conv1" } }));
    const { value, finished } = deps([send(), { action: "done", reason: "no_consent" }, send({ delivery_id: "d2", kind: "text", template_name: null, body: "Reply", conversation_id: "conv1" })], { sendTemplate, sendText });
    expect(await dispatchWhatsApp(value, { worker: "w", limit: 5 })).toEqual({ processed: 3, sent: 2 });
    expect(sendTemplate).toHaveBeenCalledWith(expect.objectContaining({ templateParams: ["Synthetic Firm"] }), `casevoya-wa-${PREPARED.delivery_id}`);
    expect(sendText).toHaveBeenCalledWith("conv1", { accountId: "acct123", message: "Reply" }, "casevoya-wa-d2");
    expect(finished).toEqual([
      [PREPARED.delivery_id, "w", "sent", "wamid.1", "conv1", null],
      ["d2", "w", "sent", "wamid.2", "conv1", null],
    ]);
  });

  it("backs off on a retryable failure, and never sends what breaks the content rule", async () => {
    const sendTemplate = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, status: 400, code: "INVALID_TEMPLATE_PARAMS", error: "bad", retry: false })
      .mockResolvedValueOnce({ ok: false, status: 503, code: null, error: "down", retry: true });
    const sendText = vi.fn();
    const { value, finished } = deps([send({ firm_name: "Client 12345678" }), send({ delivery_id: "d2" }), send({ delivery_id: "d3" }), send({ delivery_id: "d4" })], { sendTemplate, sendText });
    expect(await dispatchWhatsApp(value, { worker: "w", limit: 5 })).toEqual({ processed: 4, sent: 0 });
    // The unsafe one never reached Zernio; the 400 is final; the 503 stops the run for the backoff.
    expect(sendTemplate).toHaveBeenCalledTimes(2);
    expect(finished.map((row) => [row[0], row[2]])).toEqual([
      [PREPARED.delivery_id, "terminal_failure"],
      ["d2", "terminal_failure"],
      ["d3", "retry"],
    ]);
    expect(String(finished[0][5])).toMatch(/^refused:/);
  });
});

describe("Settings > Integrations: WhatsApp row", () => {
  const ORG = "00000000-0000-4000-8000-0000000000aa";
  const base: IntegrationsInput = {
    organizationId: ORG,
    firmSlug: "synthetic-firm",
    fromAddress: "notices@casevoya.ca",
    inboundDomain: "docs.casevoya.ca",
    isOwner: true,
    composio: { configured: false, enabled: false, acceptedAt: null },
    connections: [],
    busySyncedAt: null,
    stripe: { canSee: false, isOwner: true, account: null },
    timeZone: "America/Winnipeg",
  };
  const wa = (over: Partial<WhatsAppInput>, owner = true) => {
    const data = integrationsData({ ...base, isOwner: owner, whatsapp: { configured: true, status: "none", phone: null, sandbox: false, connectedAt: null, live: null, ...over } });
    const found = data.rows.find((row) => row.name === "WhatsApp");
    if (!found) throw new Error("no WhatsApp row");
    return found;
  };

  it("says plainly when Zernio isn't set up, and offers no working Connect", () => {
    const row = integrationsData(base).rows.find((item) => item.name === "WhatsApp");
    expect(row?.state).toEqual({ tone: "gr", label: "Not available" });
    expect(row?.action?.attrs?.disabled).toBe(true);
    expect(row?.bell ?? null).toBeNull();
  });

  it("gives Connect and Disconnect to the firm owner only", () => {
    expect(wa({}).action).toEqual({ label: "Connect", attrs: { "data-wa-connect": "1", "data-org": ORG } });
    expect(wa({}, false).action?.attrs).toEqual({ disabled: true, title: "Only the firm owner can connect WhatsApp" });
    expect(wa({ status: "pending" }).state).toEqual({ tone: "chg", label: "Pending", detail: "finish with Meta" });
    const connected = wa({ status: "connected", phone: "+1 431 275 3986", live: { status: "CONNECTED", quality: "GREEN" } });
    expect(connected.state).toEqual({ tone: "ok", label: "Connected" });
    expect(connected.sub).toEqual({ left: "+1 431 275 3986", right: "Meta: connected, quality high" });
    expect(connected.unlink).toEqual({ "aria-label": "Disconnect WhatsApp", "data-wa-disconnect": "1", "data-org": ORG, "data-fpb": "1" });
    expect(wa({ status: "connected", phone: "+1 431 275 3986" }, false).unlink ?? null).toBeNull();
    expect(wa({ status: "connected", live: "dead" }).state).toEqual({ tone: "bad", label: "Needs reconnecting" });
    expect(wa({ status: "connected", sandbox: true }).tag).toBe("sandbox");
  });

  it("tells staff in the chat whether a reply goes on WhatsApp", () => {
    expect(whatsappLine(null, "America/Winnipeg")).toBeNull();
    expect(whatsappLine({ whatsapp: null }, "America/Winnipeg")).toBeNull();
    expect(whatsappLine({ whatsapp: { until: "2026-10-19T20:30:00Z" } }, "America/Winnipeg")).toMatch(/^Your reply also goes to them on WhatsApp \(window open until /);
    expect(whatsappLine({ whatsapp: { until: "2026-10-20T06:33:00Z" } }, "America/Toronto")).toBe("Your reply also goes to them on WhatsApp (window open until Tue 20 Oct, 02:33).");
    expect(whatsappLine({ whatsapp: { until: null } }, "America/Winnipeg")).toMatch(/usual email notice/);
  });
});
