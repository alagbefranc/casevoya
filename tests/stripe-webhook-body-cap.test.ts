import { beforeEach, describe, expect, it, vi } from "vitest";

// Both Stripe webhook routes read at most 1 MB: a larger declared or streamed body is a 413 and
// never reaches the signature check; a normal body is passed through unchanged.

const state = vi.hoisted(() => ({ connect: [] as string[], billing: [] as string[] }));

vi.mock("@/lib/stripe/server", () => ({
  stripeServer: () => null,
  stripeLive: () => false,
  stripeCrypto: {},
  stripeWebhookSecrets: () => ["whsec_synthetic"],
  stripeBillingWebhookSecrets: () => ["whsec_synthetic"],
}));
vi.mock("@/lib/supabase/service", () => ({ createServiceClient: () => ({ rpc: async () => ({ data: null, error: null }) }) }));
vi.mock("@/modules/finance/webhook", () => ({
  cardFromPaymentIntent: () => null,
  handleStripeWebhook: async (body: string) => {
    state.connect.push(body);
    return { status: 400, body: { error: "bad_signature" } };
  },
}));
vi.mock("@/modules/subscription/stripe", () => ({
  summaryJson: () => ({}),
  handleBillingWebhook: async (body: string) => {
    state.billing.push(body);
    return { status: 400, body: { error: "bad_signature" } };
  },
}));

const connect = await import("@/app/api/stripe/webhook/route");
const billing = await import("@/app/api/stripe/billing/route");

const MB = 1024 * 1024;

function streamed(bytes: number): Request {
  const chunk = new Uint8Array(64 * 1024).fill(97);
  let sent = 0;
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (sent >= bytes) return controller.close();
      const size = Math.min(chunk.byteLength, bytes - sent);
      sent += size;
      controller.enqueue(chunk.slice(0, size));
    },
  });
  return new Request("https://app.test/api/stripe/webhook", { method: "POST", body, duplex: "half" } as RequestInit);
}

beforeEach(() => {
  state.connect = [];
  state.billing = [];
});

type Route = { label: string; post: () => (request: Request) => Promise<Response>; seen: () => string[] };
const routes: Route[] = [
  { label: "connect", post: () => connect.POST, seen: () => state.connect },
  { label: "billing", post: () => billing.POST, seen: () => state.billing },
];

for (const { label, post, seen } of routes) describe(`${label} webhook body cap`, () => {
  it("refuses a declared Content-Length over 1 MB with 413 before verifying", async () => {
    const request = new Request("https://app.test/x", {
      method: "POST",
      body: "{}",
      headers: { "content-length": String(MB + 1), "stripe-signature": "t=1,v1=x" },
    });
    const response = await post()(request);
    expect(response.status).toBe(413);
    expect(seen()).toEqual([]);
  });

  it("stops reading a streamed body past 1 MB with 413", async () => {
    const response = await post()(streamed(MB + 10));
    expect(response.status).toBe(413);
    expect(seen()).toEqual([]);
  });

  it("passes a normal body to the signature check unchanged", async () => {
    const payload = JSON.stringify({ id: "evt_synthetic", type: "payment_intent.succeeded", note: "café" });
    const response = await post()(new Request("https://app.test/x", { method: "POST", body: payload, headers: { "stripe-signature": "t=1,v1=x" } }));
    expect(response.status).toBe(400);
    expect(seen()).toEqual([payload]);
  });
});
