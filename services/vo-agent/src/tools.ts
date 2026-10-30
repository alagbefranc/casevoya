/**
 * Vo's tools. The ONLY tools the agent can call: our read tools, scoped to the run's matter and
 * conversation and read as the staff member (data.ts), and save_draft, which keeps a draft in
 * memory for the run to save as `vo_drafts` status=draft. There is no send tool.
 *
 * Every piece of client-, staff- or third-party-written text comes back inside a nonce-delimited
 * DATA block (prompt.ts), so it can't pose as instructions. Every call is recorded by name, and
 * every record a result shows is recorded as a source the draft cites.
 */
import { z } from "zod";
import { dataBlock, dataInline, oneLine } from "../../../src/modules/vo/prompt";
import { guardVoOutput, type GuardResult } from "../../../src/modules/vo/guard";
import type { VoSourceRef, VoTask, VoTaskRequest } from "../../../src/modules/vo/sign";
import { deadlineInAudience, personInAudience, requestInAudience, taskInAudience, type VoData, type VoSettingsRow } from "./data";
import { LETTER_TOOL_SPECS, type LetterContext, type LetterToolName } from "./letter-tools";
import { GROUNDED_TOOL_SPECS, type GroundedToolName } from "./grounded-tools";
import { cite } from "./cite";

export type VoToolName =
  | "read_matter_summary"
  | "read_person"
  | "read_documents_index"
  | "read_messages_thread"
  | "search_approved_sources"
  | "find_free_slots"
  | "save_draft"
  | LetterToolName
  | GroundedToolName;

/** The tools each task may use. Ask Vo has no write at all. */
export const TASK_TOOLS: Record<VoTask, readonly VoToolName[]> = {
  message_reply: ["read_matter_summary", "read_person", "read_messages_thread", "search_approved_sources", "find_free_slots", "save_draft"],
  document_request: ["read_matter_summary", "read_person", "read_messages_thread", "save_draft"],
  // SRC-09: Ask Vo cites what it read by marker ([R#] records, [F#] approved facts, [S#] approved
  // official content); it can't write anything.
  ask: ["read_matter_summary", "read_person", "read_documents_index", "read_intake_facts", "read_official_content"],
  // A document reading is one model call with no tools at all (vo-doc-read.ts).
  document_review: [],
  // AI-01 letter drafts (letter-tools.ts): approved facts, approved official content, one save.
  letter_draft: ["read_person", "read_approved_facts", "find_official_content", "save_letter_draft"],
};

export type ToolResult = { content: { type: "text"; text: string }[]; isError?: boolean };

export type RunContext = {
  request: VoTaskRequest;
  data: VoData;
  nonce: string;
  settings: VoSettingsRow | null;
  /** Records shown to the model, cited by the draft. */
  sources: Map<string, VoSourceRef>;
  /** SRC-09 (Ask Vo): the run's allowed set, by the marker each record was handed out with ("R1", "F2", "S1"). */
  markers?: Map<string, VoSourceRef>;
  /** VO-3 (Ask Vo): the text each [S#] / [F#] marker was handed out with. */
  markerContent?: Map<string, string>;
  /** VO-1: the conversation's audience (person ids), read once per run. */
  audience?: string[];
  /** Tool names in call order (the run log). */
  calls: string[];
  draft: Extract<GuardResult, { kind: "draft" }> | null;
  abstainedByDraft: boolean;
  /** letter_draft only: the facts and official content handed out, and the guarded letter. */
  letter?: LetterContext;
};

export type ToolSpec = {
  name: VoToolName;
  description: string;
  shape: z.ZodRawShape;
  readOnly: boolean;
  run: (ctx: RunContext, args: Record<string, unknown>) => Promise<ToolResult>;
};

/** A matter stage as people say it ("evidence_collection" is "Evidence collection"): Vo never repeats a raw key. */
export function stageWords(stage: string): string {
  const words = stage.replace(/_/g, " ").trim();
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : "Unknown";
}

const MONTH = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
function day(iso: string | null): string {
  if (!iso) return "no date";
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? oneLine(iso, 20) : `${date.getUTCDate()} ${MONTH[date.getUTCMonth()]} ${date.getUTCFullYear()}`;
}

function text(value: string): ToolResult {
  return { content: [{ type: "text", text: value }] };
}
function refused(value: string): ToolResult {
  return { content: [{ type: "text", text: value }], isError: true };
}
/**
 * Identity numbers are redacted before anything reaches the model (AI-02): long digit runs and
 * passport-like codes become [number removed].
 */
export function redactIdentity(value: string): string {
  return value.replace(/\b[A-Z]{1,2}\d{6,9}\b/g, "[number removed]").replace(/\b\d[\d -]{7,}\d\b/g, "[number removed]");
}

const DOCUMENT_SWITCH: Record<string, keyof VoSettingsRow> = {
  identity: "read_identity",
  relationship: "read_relationship",
  financial: "read_financial",
  medical: "read_medical",
  criminal: "read_criminal",
  narrative: "read_narratives",
};

/** A document kind guessed from its stated purpose, for the per-kind Vo switches (AI-06). */
export function documentKind(purpose: string, sensitivity: string): keyof typeof DOCUMENT_SWITCH {
  const p = purpose.toLowerCase();
  if (/medical|health|immigration medical|imm/.test(p)) return "medical";
  if (/police|criminal|court|conviction/.test(p)) return "criminal";
  if (/passport|birth|identity|id card|national id|travel document/.test(p)) return "identity";
  if (/bank|income|tax|pay ?stub|employment letter|funds|financial|noa|t4/.test(p)) return "financial";
  if (/marriage|relationship|photo|wedding|partner|spouse|common-law/.test(p)) return "relationship";
  if (/letter|statement|narrative|explanation|essay/.test(p)) return "narrative";
  return sensitivity === "sensitive" ? "medical" : "identity";
}

const SENSITIVE_SWITCH: Record<string, keyof VoSettingsRow> = { medical: "read_medical", criminal: "read_criminal", narrative: "read_narratives" };

/** Medical or criminal-history wording in a title, purpose or label. */
function sensitiveWording(value: string): "medical" | "criminal" | null {
  if (/\b(?:medical|health|diagnos\w*|hospital\w*|psychiatr\w*|psycholog\w*)\b/i.test(value)) return "medical";
  if (/\b(?:police|criminal|court|convictions?|charges?|offen[cs]es?)\b/i.test(value)) return "criminal";
  return null;
}

/**
 * VO-2: whether the firm's per-category switches hide this text from Vo: its stated sensitivity
 * (medical, criminal, narrative) or medical / criminal wording, with that switch not on.
 */
export function hiddenBySettings(settings: VoSettingsRow | null, sensitivity: string | null | undefined, value: string): boolean {
  const kinds = [sensitivity && SENSITIVE_SWITCH[sensitivity] ? sensitivity : null, sensitiveWording(value)].filter((kind): kind is string => Boolean(kind));
  return kinds.some((kind) => settings?.[SENSITIVE_SWITCH[kind]] !== true);
}

/**
 * VO-1: the person ids a reply or document-request run's conversation is addressed to, or null
 * for runs without a conversation (Ask Vo and letters are staff-only and read the whole matter).
 */
async function audienceOf(ctx: RunContext): Promise<string[] | null> {
  if (ctx.request.task !== "message_reply" && ctx.request.task !== "document_request") return null;
  if (ctx.audience) return ctx.audience;
  const threadId = ctx.request.threadId;
  ctx.audience = threadId && ctx.data.threadAudience ? await ctx.data.threadAudience(threadId) : [];
  return ctx.audience;
}

export const TOOL_SPECS: Record<VoToolName, ToolSpec> = {
  read_matter_summary: {
    name: "read_matter_summary",
    description:
      "The matter this run is about: title, reference, stage, open tasks, deadlines (with whether a person verified them) and open document requests. In a conversation, only what its readers may see.",
    shape: {},
    readOnly: true,
    async run(ctx) {
      const matterId = ctx.request.matterId;
      const [matter, allTasks, allDeadlines, allRequests, audience] = await Promise.all([
        ctx.data.matter(matterId),
        ctx.data.tasks(matterId),
        ctx.data.deadlines(matterId),
        ctx.data.requests(matterId),
        audienceOf(ctx),
      ]);
      if (!matter) return refused("This matter can't be read.");
      // VO-1: a conversation sees only its own people's records; VO-2: the firm's category switches apply.
      const tasks = (audience ? allTasks.filter((task) => taskInAudience(task, audience)) : allTasks).filter((task) => !hiddenBySettings(ctx.settings, null, task.title));
      const deadlines = (audience ? allDeadlines.filter(deadlineInAudience) : allDeadlines).filter((deadline) => !hiddenBySettings(ctx.settings, null, deadline.label));
      const scoped = audience ? allRequests.filter((request) => requestInAudience(request, audience)) : allRequests;
      const requests = scoped.filter((request) => !hiddenBySettings(ctx.settings, request.sensitivity, request.purpose));
      const hidden = allTasks.length - tasks.length + (allDeadlines.length - deadlines.length) + (allRequests.length - requests.length);
      const matterMark = cite(ctx, { kind: "matter", id: matter.id, label: matter.reference || matter.title });
      const lines = [
        `${matterMark}Matter: ${dataInline(ctx.nonce, matter.title)}${matter.reference ? ` (reference ${dataInline(ctx.nonce, matter.reference, 40)})` : ""}; stage: ${oneLine(stageWords(matter.stage), 40)}`,
      ];
      lines.push(`Open tasks: ${tasks.length ? "" : "none"}`);
      for (const task of tasks) {
        const mark = cite(ctx, { kind: "task", id: task.id, label: `Task: ${task.title}` });
        lines.push(`- ${mark}${dataInline(ctx.nonce, redactIdentity(task.title), 200)}; due ${day(task.dueOn)}; ${oneLine(task.status, 20)}`);
      }
      lines.push(`Deadlines: ${deadlines.length ? "" : "none"}`);
      for (const deadline of deadlines) {
        const mark = cite(ctx, { kind: "deadline", id: deadline.id, label: `Deadline: ${deadline.label}` });
        lines.push(`- ${mark}${dataInline(ctx.nonce, redactIdentity(deadline.label), 200)}; due ${day(deadline.dueOn)}; ${deadline.verification === "verified" ? "verified by a person" : "NOT verified (tentative)"}`);
      }
      lines.push(`Open document requests: ${requests.length ? "" : "none"}`);
      for (const request of requests) {
        const mark = cite(ctx, { kind: "document_request", id: request.id, label: `Request: ${redactIdentity(request.purpose)}` });
        lines.push(`- ${mark}${dataInline(ctx.nonce, redactIdentity(request.purpose), 200)}; formats ${request.formats.map((f) => oneLine(f, 10)).join(", ")}; due ${day(request.dueOn)}; explanation:`);
        lines.push(dataBlock(ctx.nonce, redactIdentity(request.explanation)));
      }
      if (hidden) lines.push(`${hidden} record(s) not shown: outside this conversation's readers or hidden by the firm's Vo settings. Don't mention or guess them.`);
      return text(lines.join("\n"));
    },
  },
  read_person: {
    name: "read_person",
    description: "The people on this matter (in a conversation, only its readers): display name and role only (no contact details, dates of birth or identity numbers).",
    shape: {},
    readOnly: true,
    async run(ctx) {
      const [all, audience] = await Promise.all([ctx.data.people(ctx.request.matterId), audienceOf(ctx)]);
      const people = audience ? all.filter((person) => personInAudience(person, audience)) : all;
      return text(people.length ? people.map((p) => `- ${dataInline(ctx.nonce, p.name, 80)} (${oneLine(p.role, 30)})`).join("\n") : "No people recorded on this matter.");
    },
  },
  read_documents_index: {
    name: "read_documents_index",
    description: "The documents on this matter by stated purpose (no contents), limited to the document kinds the firm lets Vo read.",
    shape: {},
    readOnly: true,
    async run(ctx) {
      const docs = await ctx.data.documents(ctx.request.matterId);
      const allowed = docs.filter((doc) => ctx.settings?.[DOCUMENT_SWITCH[documentKind(doc.purpose, doc.sensitivity)]] === true);
      const hidden = docs.length - allowed.length;
      // SRC-09: each listed document is cited by its current version (Ask Vo cites it as [R#]).
      const lines = allowed.map((doc) => {
        const mark = doc.versionId ? cite(ctx, { kind: "document_version", id: doc.versionId, label: `Document: ${redactIdentity(doc.purpose)}` }) : "";
        return `- ${mark}${dataInline(ctx.nonce, redactIdentity(doc.purpose), 200)}`;
      });
      if (hidden) lines.push(`${hidden} document(s) hidden by the firm's Vo settings.`);
      return text(lines.length ? lines.join("\n") : "No documents Vo may list.");
    },
  },
  read_messages_thread: {
    name: "read_messages_thread",
    description: "The latest messages of this run's conversation (oldest first), and who can read it.",
    shape: {},
    readOnly: true,
    async run(ctx) {
      if (!ctx.request.threadId) return refused("This task has no conversation.");
      if (ctx.settings && ctx.settings.read_client_messages !== true) return refused("The firm doesn't let Vo read client messages.");
      const [people, messages] = await Promise.all([ctx.data.threadPeople(ctx.request.threadId), ctx.data.messages(ctx.request.threadId, 12)]);
      const lines = [`Client(s) who read this conversation: ${people.map((p) => dataInline(ctx.nonce, p, 80)).join(", ") || "unknown"}`];
      for (const message of messages) {
        const mark = cite(ctx, { kind: "message", id: message.id, label: `${message.authorKind === "client" ? "Client message" : "Firm message"} ${day(message.createdAt)}` });
        lines.push(`${mark}${message.authorKind === "client" ? "Client" : "Firm"} ${dataInline(ctx.nonce, message.authorName, 80)} on ${day(message.createdAt)}:`);
        lines.push(dataBlock(ctx.nonce, redactIdentity(message.body)));
      }
      if (!messages.length) lines.push("No messages yet.");
      return text(lines.join("\n"));
    },
  },
  search_approved_sources: {
    name: "search_approved_sources",
    description: "The firm's approved, current official sources (title, publisher, link, last checked). Titles only: you can't read their content.",
    shape: { topic: z.string().max(120).describe("What the question is about") },
    readOnly: true,
    async run(ctx, args) {
      const topic = String(args.topic ?? "").toLowerCase();
      const words = topic.split(/\W+/).filter((w) => w.length > 3);
      const rows = (await ctx.data.approvedSources()).filter((row) => !words.length || words.some((w) => `${row.title} ${row.publisher}`.toLowerCase().includes(w)));
      if (!rows.length) return text("No approved, current source covers this. Do not answer from memory.");
      return text(rows.slice(0, 5).map((row) => `- ${oneLine(row.title, 200)} (${oneLine(row.publisher, 80)}), last checked ${day(row.lastChecked)}`).join("\n"));
    },
  },
  find_free_slots: {
    name: "find_free_slots",
    description: "The firm's next free consultation times from its booking availability, and the booking page link if one is published.",
    shape: { days: z.number().int().min(1).max(14).optional().describe("How many days ahead to look (default 7)") },
    readOnly: true,
    async run(ctx, args) {
      const result = await ctx.data.freeSlots(typeof args.days === "number" ? args.days : 7);
      const zone = result.timeZone;
      const fmt = (iso: string) =>
        new Intl.DateTimeFormat("en-CA", { timeZone: zone, weekday: "long", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(iso));
      const lines = result.starts.length ? result.starts.map((iso) => `- ${fmt(iso)} (${zone})`) : ["No free times in that range."];
      if (result.bookingLink) lines.push(`Booking page: ${result.bookingLink}`);
      return text(lines.join("\n"));
    },
  },
  save_draft: {
    name: "save_draft",
    description: "Save your draft for a staff member to review, edit and decide whether to send. Nothing is sent. Call it once.",
    shape: { text: z.string().min(1).max(4000).describe("The draft message, plain text") },
    readOnly: false,
    async run(ctx, args) {
      if (ctx.draft) return refused("A draft was already saved for this run.");
      // VO-6: links survive only to the portal and this firm's own booking pages.
      const firm = await ctx.data.firm();
      const guarded = guardVoOutput(String(args.text ?? ""), { firmSlug: firm?.slug ?? null });
      if (guarded.kind === "abstain") {
        ctx.abstainedByDraft = true;
        return text("Noted: this needs a consultant. No draft was saved.");
      }
      if (guarded.kind === "empty") return refused("The draft was empty after removing what isn't allowed.");
      ctx.draft = guarded;
      return text("Draft saved for review. Answer DONE.");
    },
  },
  ...LETTER_TOOL_SPECS,
  ...GROUNDED_TOOL_SPECS,
};
