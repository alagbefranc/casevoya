/**
 * A small Zernio REST client (https://zernio.com/api/v1, `Authorization: Bearer ZERNIO_API_KEY`).
 * Shapes follow the Zernio OpenAPI and the WhatsApp guide (read 2026-10-19):
 *   POST /v1/profiles                       { name, externalId } -> 201 { profile: { _id } }; 409 with
 *                                           details.existingProfileId on a duplicate externalId
 *   GET  /v1/profiles?externalId=           { profiles: [{ _id, externalId }] }
 *   GET  /v1/connect/whatsapp               ?profileId&redirect_url&onboarding=api -> { authUrl, state }
 *   GET  /v1/accounts?profileId&platform    { accounts: [{ _id, platform, profileId, username, displayName }] }
 *   DELETE /v1/accounts/{accountId}         disconnect
 *   GET  /v1/whatsapp/number-info?accountId { phone: { display_phone_number, status, quality_rating, ... } }
 *   POST /v1/inbox/conversations            template send -> 201 { data: { messageId, conversationId } }
 *   POST /v1/inbox/conversations/{id}/messages  text inside the 24-hour window -> 200 { data: { messageId } }
 *   POST /v1/whatsapp/templates             create a template for Meta review
 *   GET  /v1/phone-numbers                  { numbers, connected, sandbox }
 * The fetch is injected so tests never reach the network. The key is never logged or returned.
 */

export const ZERNIO_BASE_URL = "https://zernio.com/api/v1";

export type ZernioResult<T> = { ok: true; status: number; data: T } | { ok: false; status: number; code: string | null; error: string; retry: boolean };

export type ZernioFetch = (input: string, init: RequestInit) => Promise<Response>;

export type ZernioClientOptions = { apiKey: string; fetch?: ZernioFetch; baseUrl?: string; timeoutMs?: number };

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function text(value: unknown): string | null {
  return typeof value === "string" && value ? value : null;
}

/** 429 and 5xx are worth retrying; a timeout or network error too. Other 4xx are final. */
export function retryable(status: number): boolean {
  return status === 0 || status === 408 || status === 409 || status === 425 || status === 429 || status >= 500;
}

export function createZernioClient(options: ZernioClientOptions) {
  const base = (options.baseUrl ?? ZERNIO_BASE_URL).replace(/\/+$/, "");
  const doFetch: ZernioFetch = options.fetch ?? ((input, init) => fetch(input, init));
  const timeoutMs = options.timeoutMs ?? 10_000;

  async function call<T>(method: string, path: string, init: { query?: Record<string, string>; body?: unknown; idempotencyKey?: string } = {}): Promise<ZernioResult<T>> {
    if (!options.apiKey) return { ok: false, status: 0, code: "not_configured", error: "Zernio is not configured on this server.", retry: false };
    const url = new URL(`${base}${path}`);
    for (const [key, value] of Object.entries(init.query ?? {})) url.searchParams.set(key, value);
    const headers: Record<string, string> = { Authorization: `Bearer ${options.apiKey}`, Accept: "application/json" };
    if (init.body !== undefined) headers["Content-Type"] = "application/json";
    if (init.idempotencyKey) headers["Idempotency-Key"] = init.idempotencyKey;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let response: Response;
    try {
      response = await doFetch(url.toString(), {
        method,
        headers,
        body: init.body === undefined ? undefined : JSON.stringify(init.body),
        signal: controller.signal,
      });
    } catch {
      return { ok: false, status: 0, code: "network", error: "Zernio could not be reached.", retry: true };
    } finally {
      clearTimeout(timer);
    }
    let payload: unknown = null;
    try {
      payload = await response.json();
    } catch {
      payload = null;
    }
    if (response.ok) return { ok: true, status: response.status, data: payload as T };
    const body = record(payload);
    return {
      ok: false,
      status: response.status,
      code: text(body.code),
      // Zernio's own message (never our key, which it does not echo), trimmed for storage.
      error: (text(body.error) ?? text(body.message) ?? `Zernio answered ${response.status}.`).slice(0, 300),
      retry: retryable(response.status),
    };
  }

  return {
    /** The firm's profile, created once (externalId = organization id), or found again. */
    async ensureProfile(input: { organizationId: string; name: string }): Promise<ZernioResult<{ profileId: string }>> {
      const created = await call<unknown>("POST", "/profiles", {
        body: { name: `${input.name.slice(0, 80)} (${input.organizationId.slice(0, 8)})`, externalId: input.organizationId },
        idempotencyKey: `casevoya-profile-${input.organizationId}`,
      });
      if (created.ok) {
        const id = text(record(record(created.data).profile)._id);
        return id ? { ok: true, status: created.status, data: { profileId: id } } : { ok: false, status: created.status, code: null, error: "Zernio returned no profile id.", retry: false };
      }
      if (created.status === 409) {
        const existing = await call<unknown>("GET", "/profiles", { query: { externalId: input.organizationId } });
        if (existing.ok) {
          const profiles = record(existing.data).profiles;
          const match = Array.isArray(profiles) ? profiles.map(record).find((row) => row.externalId === input.organizationId) : undefined;
          const id = text(match?._id);
          if (id) return { ok: true, status: existing.status, data: { profileId: id } };
        }
      }
      return created;
    },

    /** Embedded Signup for the firm's own number (Cloud API only, no coexistence). */
    async connectUrl(input: { profileId: string; redirectUrl: string }): Promise<ZernioResult<{ authUrl: string }>> {
      const result = await call<unknown>("GET", "/connect/whatsapp", {
        query: { profileId: input.profileId, redirect_url: input.redirectUrl, onboarding: "api" },
      });
      if (!result.ok) return result;
      const authUrl = text(record(result.data).authUrl);
      return authUrl && /^https:\/\//.test(authUrl)
        ? { ok: true, status: result.status, data: { authUrl } }
        : { ok: false, status: result.status, code: null, error: "Zernio returned no sign-up link.", retry: false };
    },

    /** The WhatsApp accounts on one profile (to check an account id the browser brought back). */
    async whatsappAccounts(profileId: string): Promise<ZernioResult<{ id: string; profileId: string | null; username: string | null; displayName: string | null }[]>> {
      const result = await call<unknown>("GET", "/accounts", { query: { profileId, platform: "whatsapp" } });
      if (!result.ok) return result;
      const accounts = record(result.data).accounts;
      const rows = (Array.isArray(accounts) ? accounts.map(record) : [])
        .filter((row) => row.platform === "whatsapp" && text(row._id))
        .map((row) => {
          const profile = row.profileId;
          return {
            id: String(row._id),
            profileId: typeof profile === "string" ? profile : text(record(profile)._id),
            username: text(row.username),
            displayName: text(row.displayName),
          };
        });
      return { ok: true, status: result.status, data: rows };
    },

    async deleteAccount(accountId: string): Promise<ZernioResult<unknown>> {
      return call("DELETE", `/accounts/${encodeURIComponent(accountId)}`);
    },

    /** Live state of the number from Meta. A 400 means the channel is dead until reconnected. */
    async numberInfo(accountId: string): Promise<ZernioResult<{ displayPhone: string | null; status: string | null; quality: string | null; tier: string | null; nameStatus: string | null }>> {
      const result = await call<unknown>("GET", "/whatsapp/number-info", { query: { accountId } });
      if (!result.ok) return result;
      const phone = record(record(result.data).phone);
      return {
        ok: true,
        status: result.status,
        data: {
          displayPhone: text(phone.display_phone_number),
          status: text(phone.status),
          quality: text(phone.quality_rating),
          tier: text(phone.messaging_limit_tier),
          nameStatus: text(phone.name_status),
        },
      };
    },

    /** Opens (or continues) a conversation with an approved template. */
    async sendTemplate(
      body: { accountId: string; participantId: string; templateName: string; templateLanguage: string; templateParams: string[] },
      idempotencyKey: string,
    ): Promise<ZernioResult<{ messageId: string | null; conversationId: string | null }>> {
      const result = await call<unknown>("POST", "/inbox/conversations", { body, idempotencyKey });
      if (!result.ok) return result;
      const data = record(record(result.data).data);
      return { ok: true, status: result.status, data: { messageId: text(data.messageId), conversationId: text(data.conversationId) } };
    },

    /** Free text inside the 24-hour customer-service window. */
    async sendText(conversationId: string, body: { accountId: string; message: string }, idempotencyKey: string): Promise<ZernioResult<{ messageId: string | null; conversationId: string | null }>> {
      const result = await call<unknown>("POST", `/inbox/conversations/${encodeURIComponent(conversationId)}/messages`, { body, idempotencyKey });
      if (!result.ok) return result;
      const data = record(record(result.data).data);
      return { ok: true, status: result.status, data: { messageId: text(data.messageId), conversationId: text(data.conversationId) ?? conversationId } };
    },

    async createTemplate(body: unknown): Promise<ZernioResult<unknown>> {
      return call("POST", "/whatsapp/templates", { body });
    },

    async listTemplates(accountId: string): Promise<ZernioResult<unknown>> {
      return call("GET", "/whatsapp/templates", { query: { accountId } });
    },

    async phoneNumbers(): Promise<ZernioResult<unknown>> {
      return call("GET", "/phone-numbers");
    },
  };
}

export type ZernioClient = ReturnType<typeof createZernioClient>;
