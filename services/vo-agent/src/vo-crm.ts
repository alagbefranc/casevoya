/**
 * Vo lead follow-up drafts and call-notes summaries inside the service (PRD AI-01, AI-03..AI-06).
 *
 * Like the document reading (vo-doc-read.ts), each is ONE Messages API call with no tools: the
 * service reads the lead or the consultation as the staff member (vo-crm-data.ts, RLS), passes it
 * as data, and the answer goes through the same output guard as every Vo draft. With no tool loop
 * there is nothing an instruction hidden in an enquiry or in pasted notes could make the model
 * call. The model client is injected (`DocModel`), so tests script it and never call the API.
 *
 * Order: the firm's switches first (refused before anything is read), then consent and the
 * sensitive-category screen, then one model call, then the guard, then finish_vo_crm_run AS THE
 * STAFF MEMBER, which checks the sources and the consent again before anything is kept.
 */
import { NEEDS_RULE, newNonce, oneLine, VO_MODEL } from "../../../src/modules/vo/prompt";
import { guardVoOutput } from "../../../src/modules/vo/guard";
import {
  blockedCategory,
  callSummaryUserText,
  crmTaskAllowed,
  leadFollowUpUserText,
  MAX_CALL_NOTES,
  MIN_CALL_NOTES,
  voCrmSystemPrompt,
  VO_CRM_MAX_TOKENS,
  VO_CRM_PROMPT_VERSION,
  type VoCrmRequest,
  type VoCrmResponse,
  type VoCrmSourceRef,
} from "../../../src/modules/vo/crm";
import type { VoCrmData } from "./vo-crm-data";
import { estimateCostUsd, type DocModel, type DocModelMessage } from "./vo-doc-read";

/** The service's own read steps, recorded in the run log's tool list. */
export const READ_LEAD = "read_lead";
export const READ_CALL = "read_consultation";

export type CrmRunDeps = {
  model: DocModel | null;
  data: VoCrmData;
  apiKey: string | null;
  now?: () => number;
  nonce?: string;
  classifyError?: (error: unknown) => "unavailable" | "failed";
};

export type CrmRunOutcome = VoCrmResponse & { tools: string[] };

/** A calendar date in the firm's timezone. */
function day(iso: string, timeZone: string): string {
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(iso));
  } catch {
    return iso.slice(0, 10);
  }
}

export async function runVoCrmDraft(request: VoCrmRequest, deps: CrmRunDeps): Promise<CrmRunOutcome> {
  const now = deps.now ?? Date.now;
  const started = now();
  const tools: string[] = [];
  let leftOut = 0;
  const finish = (args: Record<string, unknown>) =>
    deps.data.rpc("finish_vo_crm_run", {
      p_run_id: request.runId,
      p_prompt_version: VO_CRM_PROMPT_VERSION[request.task],
      p_latency_ms: Math.min(600000, Math.max(0, Math.round(now() - started))),
      p_tools: tools,
      p_left_out: leftOut,
      ...args,
    });
  const failed = async (failure: "unavailable" | "failed" | "empty" | "nothing_to_draft" | "refused", extra: Record<string, unknown> = {}): Promise<CrmRunOutcome> => {
    await finish({ p_result: "failed", p_failure: failure, ...extra });
    return { result: "failed", failure, tools };
  };

  if (!deps.apiKey || !deps.model) return failed("unavailable");
  const [settings, timeZone] = await Promise.all([deps.data.settings(), deps.data.timeZone()]);
  if (!crmTaskAllowed(request.task, settings)) return failed("refused");

  const nonce = deps.nonce ?? newNonce();
  let system: string;
  let user: string;
  let title: string;
  const sources: VoCrmSourceRef[] = [];

  if (request.task === "lead_follow_up") {
    if (!request.leadId) return failed("failed");
    tools.push(READ_LEAD);
    const lead = await deps.data.lead(request.leadId);
    if (!lead) return failed("failed");
    // No consent to be contacted: nothing is drafted (the database refused first; this is the second lock).
    if (!lead.reply) return failed("refused");
    // Notes that mention a category the firm keeps from Vo are left out, and the page says how many.
    const notes = lead.notes.filter((note) => {
      const kept = !blockedCategory(note.body, settings);
      if (!kept) leftOut += 1;
      return kept;
    });
    const serviceBlocked = lead.serviceInterest ? blockedCategory(lead.serviceInterest, settings) : null;
    system = voCrmSystemPrompt("lead_follow_up", nonce, { marketing: lead.marketing });
    user = leadFollowUpUserText(nonce, {
      id: lead.id,
      name: lead.name,
      serviceInterest: serviceBlocked ? null : lead.serviceInterest,
      language: lead.language,
      preferredContact: lead.preferredContact,
      stage: lead.stage,
      createdOn: day(lead.createdAt, timeZone),
      marketing: lead.marketing,
      notes: notes.map((note) => ({ id: note.id, body: note.body, on: day(note.createdAt, timeZone), fromForm: note.fromForm })),
      bookings: lead.bookings.map((b) => ({ id: b.id, title: b.title, on: day(b.startsAt, timeZone), status: b.status })),
    });
    sources.push({ kind: "lead", id: lead.id, label: oneLine(lead.name, 100) || "The lead" });
    notes.forEach((note) => sources.push({ kind: "lead_note", id: note.id, label: `${note.fromForm ? "Enquiry" : "Note"}, ${day(note.createdAt, timeZone)}` }));
    lead.bookings.slice(0, 3).forEach((b) => sources.push({ kind: "booking", id: b.id, label: `${oneLine(b.title, 80)}, ${day(b.startsAt, timeZone)}` }));
    title = `Follow-up to ${oneLine(lead.name, 160)}`;
  } else {
    const notes = (request.notes ?? "").trim();
    if (!request.bookingId || notes.length < MIN_CALL_NOTES || notes.length > MAX_CALL_NOTES) return failed("failed");
    // The pasted notes are refused whole when they mention a category the firm keeps from Vo.
    if (blockedCategory(notes, settings)) return failed("refused");
    tools.push(READ_CALL);
    const booking = await deps.data.booking(request.bookingId);
    if (!booking || booking.locationKind !== "video") return failed("failed");
    const keptOn = request.leadId ? await deps.data.leadName(request.leadId) : request.matterId ? await deps.data.matterLabel(request.matterId) : null;
    if (!keptOn) return failed("failed");
    const on = day(booking.startsAt, timeZone);
    system = voCrmSystemPrompt("call_summary", nonce, { marketing: false });
    user = callSummaryUserText(nonce, { bookingId: booking.id, title: booking.title, on, attendee: booking.attendee, keptOn: request.leadId ? `the lead ${keptOn}` : `the matter ${keptOn}` }, notes);
    sources.push({ kind: "booking", id: booking.id, label: `Video call, ${on}` });
    if (request.matterId) sources.push({ kind: "matter", id: request.matterId, label: oneLine(keptOn, 100) });
    title = `Video call summary, ${on}`;
  }

  const params: Record<string, unknown> = {
    model: VO_MODEL,
    max_tokens: VO_CRM_MAX_TOKENS,
    // A refused request is re-run server-side on the recommended fallback model (as the reading).
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    thinking: { type: "adaptive" },
    system,
    messages: [{ role: "user", content: [{ type: "text", text: user }] }],
  };
  let message: DocModelMessage;
  try {
    message = await deps.model.create(params);
  } catch (error) {
    // The SDK's error may echo data; it is not passed on or logged.
    return failed(deps.classifyError ? deps.classifyError(error) : "failed");
  }
  const served = typeof message.model === "string" && /^[a-z0-9@][a-z0-9@._/-]{2,119}$/.test(message.model) ? message.model : VO_MODEL;
  const metrics = {
    p_model: served,
    p_input_tokens: Math.max(0, Math.round(message.usage?.input_tokens ?? 0)),
    p_output_tokens: Math.max(0, Math.round(message.usage?.output_tokens ?? 0)),
    p_cost_usd: estimateCostUsd(served, message.usage),
  };
  if (message.stop_reason === "refusal" || message.stop_reason === "max_tokens") return failed("failed", metrics);
  const raw = message.content.filter((block) => block.type === "text").map((block) => block.text ?? "").join("\n");
  const guarded = guardVoOutput(raw);
  if (guarded.kind === "abstain") {
    await finish({ p_result: "abstained", ...metrics });
    return { result: "abstained", tools };
  }
  if (guarded.kind === "empty") return failed("empty", metrics);
  const saved = await finish({
    p_result: "drafted",
    p_title: title.slice(0, 200),
    p_body: guarded.text,
    p_sources: sources.slice(0, 40),
    p_needs_rule: guarded.needsRule || guarded.text.includes(NEEDS_RULE),
    ...metrics,
  });
  if (saved.error || typeof saved.data !== "string") return { result: "failed", failure: "failed", tools };
  return { result: "drafted", draftId: saved.data, text: guarded.text, needsRule: guarded.needsRule, sources: sources.slice(0, 40), leftOut, tools };
}
