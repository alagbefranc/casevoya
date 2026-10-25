/**
 * The service's one endpoint, POST /v1/run, independent of the HTTP server so it can be tested.
 * It accepts only a request signed by the app Worker (sign.ts), builds the data layer from the
 * staff member's own access token, and runs the task. Responses never echo client text other than
 * the draft or answer itself; errors are generic.
 */
import { parseVoTaskRequest, verifyVoRequest, VO_SIGNATURE_HEADER, VO_TIMESTAMP_HEADER, type VoTaskResponse } from "../../../src/modules/vo/sign";
import { supabaseVoData, type VoData } from "./data";
import { runVoTask, type AgentSdk } from "./task";
import { supabaseVoDocData, type VoDocData } from "./vo-doc-data";
import { runDocumentReview, type DocModel } from "./vo-doc-read";
import { isVoCrmTask, parseVoCrmRequest, type VoCrmResponse } from "../../../src/modules/vo/crm";
import { supabaseVoCrmData, type VoCrmData } from "./vo-crm-data";
import { runVoCrmDraft } from "./vo-crm";

export type ServiceEnv = {
  VO_AGENT_SECRET?: string;
  ANTHROPIC_API_KEY?: string;
  SUPABASE_URL?: string;
  SUPABASE_PUBLISHABLE_KEY?: string;
  PATH?: string;
  HOME?: string;
};

export type HandlerDeps = {
  sdk: AgentSdk;
  env: ServiceEnv;
  cwd: string;
  /** Tests replace the Supabase data layer. */
  dataFor?: (input: { accessToken: string; organizationId: string }) => VoData;
  now?: () => number;
  /** Document reading: the Messages API client (runtime/server.ts) and its data layer. */
  docModel?: DocModel | null;
  docDataFor?: (input: { accessToken: string; organizationId: string }) => VoDocData;
  classifyError?: (error: unknown) => "unavailable" | "failed";
  /** Lead follow-ups and call summaries: their data layer (tests replace it). */
  crmDataFor?: (input: { accessToken: string; organizationId: string }) => VoCrmData;
};

export async function handleRun(
  request: { method: string; headers: Record<string, string | undefined>; body: string },
  deps: HandlerDeps,
): Promise<{ status: number; body: VoTaskResponse | VoCrmResponse | { error: string } }> {
  if (request.method !== "POST") return { status: 405, body: { error: "method" } };
  const now = deps.now ?? Date.now;
  const secret = deps.env.VO_AGENT_SECRET ?? "";
  const ok = await verifyVoRequest(secret, { signature: request.headers[VO_SIGNATURE_HEADER] ?? null, timestamp: request.headers[VO_TIMESTAMP_HEADER] ?? null }, request.body, now());
  if (!ok) return { status: 401, body: { error: "unsigned" } };
  let parsed: unknown;
  try {
    parsed = JSON.parse(request.body);
  } catch {
    return { status: 400, body: { error: "body" } };
  }
  // Lead follow-ups and call summaries: one Messages API call, like the document reading.
  if (isVoCrmTask(parsed)) {
    const crm = parseVoCrmRequest(parsed, now());
    if (!crm) return { status: 400, body: { error: "body" } };
    const crmDataFor =
      deps.crmDataFor ??
      ((input: { accessToken: string; organizationId: string }) => {
        if (!deps.env.SUPABASE_URL || !deps.env.SUPABASE_PUBLISHABLE_KEY) throw new Error("not configured");
        return supabaseVoCrmData({ url: deps.env.SUPABASE_URL, publishableKey: deps.env.SUPABASE_PUBLISHABLE_KEY, ...input });
      });
    let crmData: VoCrmData;
    try {
      crmData = crmDataFor({ accessToken: crm.accessToken, organizationId: crm.organizationId });
    } catch {
      return { status: 503, body: { result: "failed", failure: "unavailable" } };
    }
    const drafted = await runVoCrmDraft(crm, { model: deps.docModel ?? null, data: crmData, apiKey: deps.env.ANTHROPIC_API_KEY || null, now, classifyError: deps.classifyError });
    // Only the outcome goes back to the app.
    const { tools: _crmTools, ...crmBody } = drafted;
    void _crmTools;
    return { status: 200, body: crmBody };
  }
  const task = parseVoTaskRequest(parsed, now());
  if (!task) return { status: 400, body: { error: "body" } };
  if (task.task === "document_review") {
    const docDataFor =
      deps.docDataFor ??
      ((input: { accessToken: string; organizationId: string }) => {
        if (!deps.env.SUPABASE_URL || !deps.env.SUPABASE_PUBLISHABLE_KEY) throw new Error("not configured");
        return supabaseVoDocData({ url: deps.env.SUPABASE_URL, publishableKey: deps.env.SUPABASE_PUBLISHABLE_KEY, ...input });
      });
    let docData: VoDocData;
    try {
      docData = docDataFor({ accessToken: task.accessToken, organizationId: task.organizationId });
    } catch {
      return { status: 503, body: { result: "failed", failure: "unavailable" } };
    }
    const read = await runDocumentReview(task, { model: deps.docModel ?? null, data: docData, apiKey: deps.env.ANTHROPIC_API_KEY || null, now, classifyError: deps.classifyError });
    // Like the other tasks, only the outcome goes back to the app.
    const { tools: _readTools, downloaded: _downloaded, ...readBody } = read;
    void _readTools;
    void _downloaded;
    return { status: 200, body: readBody };
  }
  const dataFor =
    deps.dataFor ??
    ((input: { accessToken: string; organizationId: string }) => {
      if (!deps.env.SUPABASE_URL || !deps.env.SUPABASE_PUBLISHABLE_KEY) throw new Error("not configured");
      return supabaseVoData({ url: deps.env.SUPABASE_URL, publishableKey: deps.env.SUPABASE_PUBLISHABLE_KEY, ...input });
    });
  let data: VoData;
  try {
    data = dataFor({ accessToken: task.accessToken, organizationId: task.organizationId });
  } catch {
    return { status: 503, body: { result: "failed", failure: "unavailable" } };
  }
  const outcome = await runVoTask(task, {
    sdk: deps.sdk,
    data,
    apiKey: deps.env.ANTHROPIC_API_KEY || null,
    cwd: deps.cwd,
    env: { PATH: deps.env.PATH, HOME: deps.env.HOME },
    now,
  });
  // The tool log stays in the service's run record; the app gets the outcome only.
  const { log: _log, tools: _tools, ...body } = outcome;
  void _log;
  void _tools;
  return { status: 200, body };
}
