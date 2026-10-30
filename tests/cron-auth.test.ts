import { hkdfSync, randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { acceptedCronBearers, bearerToken, cronBearerAuthorized, deriveCronKey } from "@/modules/email/cron-auth";
import { openInviteLink, openSigningCode, sealInviteLink, sealSigningCode } from "@/modules/email/invite-link-seal";

vi.mock("@/modules/email/run-dispatch", () => ({ runEmailDispatch: vi.fn(async () => ({ ok: true })) }));
vi.mock("@/modules/whatsapp/run-dispatch", () => ({ runWhatsAppDispatch: vi.fn(async () => ({ ok: true })) }));
vi.mock("@/modules/sheet/scheduled-reports-runner", () => ({ runScheduledReports: vi.fn(async () => ({ ok: true })) }));
vi.mock("@/lib/supabase/service", () => ({ createServiceClient: vi.fn(() => ({})) }));

const DISPATCH = "synthetic-dispatch-secret-0123456789";
const CRON = "synthetic-cron-secret-abcdefghijkl";
const LINK = `https://app.casevoya.ca/accept/client?token=${"ab".repeat(32)}`;

function request(token?: string): Request {
  const headers: Record<string, string> = {};
  if (token !== undefined) headers.authorization = `Bearer ${token}`;
  return new Request("https://app.casevoya.ca/api/x", { method: "POST", headers });
}

/** The sealing key bytes as invite-link-seal.ts derives them. */
function sealingKeyBytes(secret: string): Buffer {
  return Buffer.from(hkdfSync("sha256", secret, "casevoya.invitation-email-link", "aes-256-gcm v1", 32));
}

describe("cron bearer derivation", () => {
  it("derives the documented HKDF cron key, distinct from the raw secret and the sealing key", async () => {
    const derived = await deriveCronKey(DISPATCH);
    const expected = Buffer.from(hkdfSync("sha256", DISPATCH, "casevoya.cron-auth", "casevoya/cron-auth/v1", 32)).toString("base64url");
    expect(derived).toBe(expected);
    expect(derived).not.toBe(DISPATCH);
    const sealing = sealingKeyBytes(DISPATCH);
    expect(Buffer.from(derived!, "base64url").equals(sealing)).toBe(false);
    for (const bearer of await acceptedCronBearers({ dispatchSecret: DISPATCH })) {
      expect(bearer).not.toBe(sealing.toString("base64url"));
      expect(bearer).not.toBe(sealing.toString("base64"));
      expect(bearer).not.toBe(sealing.toString("hex"));
    }
    expect(await deriveCronKey("short")).toBeNull();
  });

  it("accepts the raw secret (existing callers) and the derived key while CRON_SECRET is unset", async () => {
    const secrets = { dispatchSecret: DISPATCH, cronSecret: "" };
    expect(await cronBearerAuthorized(DISPATCH, secrets)).toBe(true);
    expect(await cronBearerAuthorized((await deriveCronKey(DISPATCH))!, secrets)).toBe(true);
    expect(await cronBearerAuthorized(`${DISPATCH}x`, secrets)).toBe(false);
    expect(await cronBearerAuthorized(DISPATCH.slice(0, -1), secrets)).toBe(false);
    expect(await cronBearerAuthorized("", secrets)).toBe(false);
    expect(await cronBearerAuthorized("", { dispatchSecret: "" })).toBe(false);
    expect(await cronBearerAuthorized("anything", { dispatchSecret: "" })).toBe(false);
  });

  it("accepts only CRON_SECRET once it is set", async () => {
    const secrets = { dispatchSecret: DISPATCH, cronSecret: CRON };
    expect(await cronBearerAuthorized(CRON, secrets)).toBe(true);
    expect(await cronBearerAuthorized(DISPATCH, secrets)).toBe(false);
    expect(await cronBearerAuthorized((await deriveCronKey(DISPATCH))!, secrets)).toBe(false);
    // A too-short CRON_SECRET is ignored rather than weakening the bearer.
    expect(await cronBearerAuthorized("short", { dispatchSecret: DISPATCH, cronSecret: "short" })).toBe(false);
    expect(await cronBearerAuthorized(DISPATCH, { dispatchSecret: DISPATCH, cronSecret: "short" })).toBe(true);
  });

  it("reads only a Bearer authorization header", () => {
    expect(bearerToken(request("abc"))).toBe("abc");
    expect(bearerToken(request())).toBe("");
    const basic = new Request("https://x.test", { headers: { authorization: `Basic ${DISPATCH}` } });
    expect(bearerToken(basic)).toBe("");
  });

  it("leaves sealed links and codes opening with the same secret as before", async () => {
    const invitationId = randomUUID();
    const sealed = (await sealInviteLink(DISPATCH, LINK, invitationId))!;
    expect(await openInviteLink(DISPATCH, sealed, invitationId)).toBe(LINK);
    const codeId = randomUUID();
    const code = (await sealSigningCode(DISPATCH, "123456", codeId))!;
    expect(await openSigningCode(DISPATCH, code, codeId)).toBe("123456");
    // A cron bearer is not a sealing secret.
    expect(await openInviteLink((await deriveCronKey(DISPATCH))!, sealed, invitationId)).toBeNull();
  });
});

describe("scheduler routes", () => {
  beforeEach(() => {
    vi.stubEnv("EMAIL_DISPATCH_SECRET", DISPATCH);
    vi.stubEnv("SUPABASE_SECRET_KEY", "synthetic-service-key");
    vi.stubEnv("CLOUDFLARE_EMAIL_API_TOKEN", "synthetic-token");
    vi.stubEnv("ZERNIO_API_KEY", "synthetic-zernio");
    vi.stubEnv("CRON_SECRET", "");
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  async function routes() {
    return [
      (await import("@/app/api/email/dispatch/route")).POST,
      (await import("@/app/api/whatsapp/dispatch/route")).POST,
      (await import("@/app/api/reports/scheduled/run/route")).POST,
    ];
  }

  it("keep accepting the raw secret and accept the derived key", async () => {
    const derived = (await deriveCronKey(DISPATCH))!;
    for (const post of await routes()) {
      expect((await post(request(DISPATCH))).status).toBe(200);
      expect((await post(request(derived))).status).toBe(200);
      expect((await post(request("wrong-bearer-value-000000"))).status).toBe(401);
      expect((await post(request())).status).toBe(401);
    }
  });

  it("accept only CRON_SECRET when it is set", async () => {
    vi.stubEnv("CRON_SECRET", CRON);
    for (const post of await routes()) {
      expect((await post(request(CRON))).status).toBe(200);
      expect((await post(request(DISPATCH))).status).toBe(401);
      expect((await post(request((await deriveCronKey(DISPATCH))!))).status).toBe(401);
    }
  });

  it("stay unconfigured without the dispatch secret", async () => {
    vi.stubEnv("EMAIL_DISPATCH_SECRET", "");
    for (const post of await routes()) {
      expect((await post(request(""))).status).toBe(503);
    }
  });
});
