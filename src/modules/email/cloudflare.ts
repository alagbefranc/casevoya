export type OutboundEmail = {
  to: string;
  fromAddress: string;
  fromName: string;
  replyToAddress: string;
  replyToName: string;
  subject: string;
  html: string;
  text: string;
  /** Threading headers only (In-Reply-To, References), from dispatch.threadingHeaders. */
  headers?: Record<string, string>;
};

export type SendOutcome =
  | {
      ok: true;
      messageId: string | null;
      delivered: string[];
      queued: string[];
      permanentBounces: string[];
      suppressed: string[];
    }
  | { ok: false; retry: boolean; error: string };

type FetchLike = (input: string, init: { method: string; headers: Record<string, string>; body: string }) => Promise<{
  ok: boolean;
  status: number;
  json: () => Promise<unknown>;
}>;

export function cloudflareSendBody(email: OutboundEmail): Record<string, unknown> {
  return {
    to: email.to,
    from: { address: email.fromAddress, name: email.fromName },
    reply_to: { address: email.replyToAddress, name: email.replyToName },
    subject: email.subject,
    html: email.html,
    text: email.text,
    ...(email.headers && Object.keys(email.headers).length ? { headers: email.headers } : {}),
  };
}

export async function sendCloudflareEmail(
  email: OutboundEmail,
  options: { accountId: string; token: string; fetchImpl?: FetchLike },
): Promise<SendOutcome> {
  const fetchImpl = options.fetchImpl ?? fetch;
  let response: { ok: boolean; status: number; json: () => Promise<unknown> };
  try {
    response = await fetchImpl(
      `https://api.cloudflare.com/client/v4/accounts/${options.accountId}/email/sending/send`,
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${options.token}`,
          "content-type": "application/json",
        },
        body: JSON.stringify(cloudflareSendBody(email)),
      },
    );
  } catch (error) {
    return { ok: false, retry: true, error: error instanceof Error ? error.message : "network" };
  }

  let payload: unknown = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }
  const record = payload && typeof payload === "object" ? (payload as Record<string, unknown>) : {};
  const errors = Array.isArray(record.errors) ? record.errors : [];
  const first = errors[0] && typeof errors[0] === "object" ? (errors[0] as Record<string, unknown>) : {};
  const code = typeof first.code === "number" ? first.code : null;
  if (!response.ok || record.success === false) {
    const retry = response.status === 429 || response.status >= 500 || code === 10004;
    const terminal = response.status === 401 || response.status === 403;
    return {
      ok: false,
      retry: retry && !terminal,
      error: typeof first.message === "string" ? first.message : `cloudflare ${response.status}`,
    };
  }
  const result = record.result && typeof record.result === "object" ? (record.result as Record<string, unknown>) : {};
  return {
    ok: true,
    messageId: typeof result.message_id === "string" ? result.message_id : null,
    delivered: stringList(result.delivered),
    queued: stringList(result.queued),
    permanentBounces: stringList(result.permanent_bounces),
    suppressed: stringList(result.suppressed_recipients),
  };
}

function stringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string");
}
