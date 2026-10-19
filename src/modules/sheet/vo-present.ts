/**
 * Vo drafts and Vo and AI pages: rows from vo_settings, vo_runs, vo_drafts and the approved source
 * register become the Designer components' data. Pure, so the copy and the switch rules are tested.
 */
import type { AiAudit, AiData, AiRunRow, AiRules, AiSettings, AiSources, AiStates, AiSwitch, AiTab } from "@/components/sheet/designer/ai";
import type { Attrs, DraftCard, DraftsData, DraftsHeaderData, DraftSwitch } from "@/components/sheet/designer/drafts";
import type { MatterBadge } from "@/components/sheet/designer/matters";
import type { VoSettingKey, VoSwitchKey } from "@/modules/vo/errors";
import { MATTER_STAGES, stageLabel } from "@/modules/sheet/present";

export type VoSettingsRow = {
  enabled: boolean;
  reply_drafts: boolean;
  staff_answers: boolean;
  read_client_messages: boolean;
  read_identity: boolean;
  read_relationship: boolean;
  read_financial: boolean;
  read_medical: boolean;
  read_criminal: boolean;
  read_narratives: boolean;
  doc_classification: boolean;
  ocr_normalisation: boolean;
  missing_fields: boolean;
  inconsistency_flags: boolean;
};

export type VoSettings = VoSettingsRow & { saved: boolean };

/** Whether Vo may be asked to read a document at all (each category is still checked on the run). */
export function voCanReadDocuments(settings: VoSettings, viewer: { agentReady: boolean }): boolean {
  return settings.enabled && viewer.agentReady && (settings.doc_classification || settings.ocr_normalisation || settings.missing_fields || settings.inconsistency_flags);
}

/** The firm's effective switches: the owner's saved row, or the defaults (on only in sample mode). */
export function effectiveSettings(row: Partial<VoSettingsRow> | null, sampleMode: boolean): VoSettings {
  return {
    saved: Boolean(row),
    enabled: row?.enabled ?? sampleMode,
    reply_drafts: row?.reply_drafts ?? true,
    staff_answers: row?.staff_answers ?? true,
    read_client_messages: row?.read_client_messages ?? true,
    read_identity: row?.read_identity ?? false,
    read_relationship: row?.read_relationship ?? false,
    read_financial: row?.read_financial ?? false,
    read_medical: row?.read_medical ?? false,
    read_criminal: row?.read_criminal ?? false,
    read_narratives: row?.read_narratives ?? false,
    doc_classification: row?.doc_classification ?? true,
    ocr_normalisation: row?.ocr_normalisation ?? true,
    missing_fields: row?.missing_fields ?? true,
    inconsistency_flags: row?.inconsistency_flags ?? true,
  };
}

export type VoViewer = { organizationId: string; firmName: string; isOwner: boolean; sampleMode: boolean; agentReady: boolean; timeZone: string };

export type VoSource = { kind: string; id: string; label: string };

export type VoDraftRow = {
  id: string;
  runId: string;
  kind: "message_reply" | "document_request";
  title: string;
  body: string;
  sources: VoSource[];
  matterId: string;
  threadId: string;
  status: "draft" | "sent" | "discarded";
  edited: boolean | null;
  needsRule: boolean;
  isSample: boolean;
  createdAt: string;
  reviewedAt: string | null;
  reviewedBy: string | null;
  latencyMs: number | null;
  /** The matter or its conversation changed after Vo drafted this (see draftStale). */
  stale?: boolean;
};

export type VoRunRow = {
  id: string;
  kind: "message_reply" | "document_request" | "ask" | "document_review";
  result: "running" | "drafted" | "answered" | "abstained" | "failed";
  matterId: string;
  threadId: string | null;
  userId: string;
  model: string | null;
  promptVersion: string | null;
  sourceCount: number | null;
  tools: string[];
  costUsd: number | null;
  failure: string | null;
  useful: boolean | null;
  createdAt: string;
  /** A document reading's draft is "reviewed" once every proposal is decided. */
  draft: { status: "draft" | "sent" | "discarded" | "reviewed"; edited: boolean | null } | null;
  /** document_review: the version Vo read (the run's source). */
  versionId?: string | null;
};

export type VoNames = {
  matter: (id: string) => string;
  reference: (id: string) => string;
  person: (userId: string | null) => string;
};

const MONTH = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const WORDS = ["no", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten"];

function parts(iso: string, timeZone: string) {
  const formatted = new Intl.DateTimeFormat("en-CA", { timeZone, day: "numeric", month: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date(iso));
  const get = (type: string) => formatted.find((part) => part.type === type)?.value ?? "";
  return { day: Number(get("day")), month: Number(get("month")), time: `${get("hour")}:${get("minute")}` };
}

export function shortDay(iso: string, timeZone: string): string {
  const p = parts(iso, timeZone);
  return `${p.day} ${MONTH[p.month - 1]}`;
}

export function dayTime(iso: string, timeZone: string): string {
  const p = parts(iso, timeZone);
  return `${p.day} ${MONTH[p.month - 1]} ${p.time}`;
}

function seconds(ms: number | null): string {
  return `${((ms ?? 0) / 1000).toFixed(1)}s`;
}

const KIND_LABEL: Record<VoDraftRow["kind"], string> = { message_reply: "Administrative reply", document_request: "Document request" };

/** Live switch attributes: the owner saves; everyone else sees the state; unbuilt ones stay off. */
function switchAttrs(viewer: VoViewer, key: VoSwitchKey | null): Attrs {
  if (!key) return { disabled: true, title: "Not available in Casevoya yet" };
  return viewer.isOwner ? { "data-vo-setting": key, "data-org": viewer.organizationId } : { disabled: true, title: "Only the firm owner can change this" };
}

/**
 * What "waiting" means for Vo drafts, everywhere it is counted (the sidebar badge, the drafts
 * page's heading and pill): reply drafts (`vo_drafts`) and document readings (`vo_doc_drafts`)
 * still in `draft`, the two kinds the drafts page lists as cards.
 */
export function voDraftsWaiting(replyDrafts: number | null | undefined, readings: number | null | undefined): number {
  return (replyDrafts ?? 0) + (readings ?? 0);
}

export function draftsHeader(viewer: VoViewer, settings: VoSettings, waiting: number): DraftsHeaderData {
  const pills = [`${waiting} waiting`, settings.enabled ? "AI on for this firm" : "AI off for this firm", "Drafts only"];
  if (viewer.sampleMode && settings.enabled) pills.push("Sample records only");
  if (!viewer.agentReady) pills.push("Vo unavailable");
  return {
    pills,
    ask: settings.enabled && settings.staff_answers ? { "data-dlg": "dlgAsk" } : null,
    settings: { "data-nav": "/sheet/ai" },
  };
}

/**
 * Raw matter stage keys ("evidence_collection") in Vo's words, as people read them ("Evidence
 * collection"). Only whole known keys change.
 */
export function humaniseStages(text: string): string {
  return text.replace(new RegExp(`\\b(${MATTER_STAGES.join("|")})\\b`, "g"), (key) => stageLabel(key));
}

/**
 * Whether a reply draft is out of date: the conversation got a newer message, or the matter
 * changed, after Vo drafted it. Accepting it as written would answer an older state.
 */
export function draftStale(draftCreatedAt: string, changes: { threadLastMessageAt?: string | null; matterUpdatedAt?: string | null }): boolean {
  const at = Date.parse(draftCreatedAt);
  if (Number.isNaN(at)) return false;
  return [changes.threadLastMessageAt, changes.matterUpdatedAt].some((value) => Boolean(value) && Date.parse(value as string) > at);
}

/** Accept on a reply draft: send it as written, unless it needs a person first (and why). */
function acceptAttrs(row: VoDraftRow, viewer: VoViewer): Attrs {
  if (row.needsRule) return { disabled: true, title: "It needs a sourced rule. Open it with Edit and replace the placeholder first." };
  if (row.stale) return { disabled: true, title: "Out of date: the matter changed after Vo drafted it. Open it with Edit and check it first." };
  return { "data-vo-accept": row.id, "data-org": viewer.organizationId, title: "Send this draft to the client as written" };
}

function draftCard(row: VoDraftRow, names: VoNames, viewer: VoViewer): DraftCard {
  const sources = row.sources.map((source) => source.label);
  const meta = ["Drafted by Vo", "needs your review", KIND_LABEL[row.kind]];
  if (row.needsRule) meta.push("needs a sourced rule");
  if (row.stale) meta.push("out of date: the matter changed since");
  if (row.isSample) meta.push("sample");
  const open = `/sheet/matters/${row.matterId}?tab=messages&thread=${row.threadId}&vo=${row.id}`;
  return {
    id: row.id,
    meta,
    title: humaniseStages(row.title),
    sub: { left: names.matter(row.matterId), right: names.reference(row.matterId) },
    body: `“${humaniseStages(row.body)}”`,
    timeline: {
      id: `tl${row.id.replace(/-/g, "").slice(0, 8)}`,
      summary: `${sources.join(", ").toLowerCase()} · run logged · ${seconds(row.latencyMs)}`,
      done: true,
      said: `Checked ${sources.length} ${sources.length === 1 ? "source" : "sources"} in ${seconds(row.latencyMs)}`,
      clock: "",
      items: [...sources, "Run logged"],
    },
    // Accept sends the draft as written; Edit opens it in the conversation's composer first.
    accept: acceptAttrs(row, viewer),
    edit: { "data-nav": open },
    reject: { "data-vo-discard": row.id, "data-org": viewer.organizationId },
  };
}

/** A Vo document reading waiting for review (vo_doc_drafts, draft kind document_review). */
export type VoReadingRow = {
  id: string;
  runId: string;
  title: string;
  body: string;
  matterId: string;
  versionId: string;
  sources: VoSource[];
  needsRule: boolean;
  isSample: boolean;
  createdAt: string;
  latencyMs: number | null;
  /** Proposals still waiting for a decision. */
  waiting: number;
};

/** Where a reading's proposals are reviewed: the matter's Documents tab, Vo's review panel. */
export function readingHref(row: { matterId: string; id: string }): string {
  return `/sheet/matters/${row.matterId}?tab=documents&vo=${row.id}#ocr`;
}

export function readingCard(row: VoReadingRow, names: VoNames, viewer: VoViewer): DraftCard {
  const sources = row.sources.map((source) => source.label);
  const meta = ["Read by Vo", "needs your review", "Document reading"];
  if (row.needsRule) meta.push("needs a sourced rule");
  if (row.isSample) meta.push("sample");
  const open = readingHref(row);
  return {
    id: row.id,
    meta,
    title: humaniseStages(row.title),
    sub: { left: names.matter(row.matterId), right: names.reference(row.matterId) },
    body: `“${humaniseStages(row.body)}”`,
    timeline: {
      id: `tl${row.id.replace(/-/g, "").slice(0, 8)}`,
      summary: `${sources.join(", ").toLowerCase()} · run logged · ${seconds(row.latencyMs)}`,
      done: true,
      said: `Read ${sources.length === 1 ? "one document" : `${sources.length} documents`} in ${seconds(row.latencyMs)}`,
      clock: "",
      items: [...sources, `${row.waiting} ${row.waiting === 1 ? "proposal" : "proposals"} to decide`, "Run logged"],
    },
    // A reading has one decision per proposal, made on the matter's review panel (Edit opens it).
    accept: { disabled: true, title: "Accept each proposal on the matter’s Documents tab: choose Edit to open them" },
    edit: { "data-nav": open },
    reject: { "data-vo-doc-discard": row.id, "data-org": viewer.organizationId },
  };
}

export function draftsPage(input: {
  viewer: VoViewer;
  settings: VoSettings;
  waiting: VoDraftRow[];
  week: VoDraftRow[];
  running: VoRunRow | null;
  abstained: VoRunRow | null;
  names: VoNames;
  /** Document readings waiting for review, shown with the drafts (newest first). */
  readings?: VoReadingRow[];
  /** Document readings made in the last 7 days, for This week. */
  weekReadings?: { status: string }[];
}): DraftsData {
  const { viewer, settings, names } = input;
  const readings = input.readings ?? [];
  const count = voDraftsWaiting(input.waiting.length, readings.length);
  const heading = count === 0 ? "No drafts waiting for you." : `Vo drafted ${WORDS[count] ?? String(count)} ${count === 1 ? "thing" : "things"} for you.`;
  const switches: DraftSwitch[] = [
    { id: "swVoClassify", label: "Document classification", on: settings.doc_classification, attrs: switchAttrs(viewer, "doc_classification") },
    { id: "swVoOcr", label: "OCR field suggestions", on: settings.ocr_normalisation, attrs: switchAttrs(viewer, "ocr_normalisation") },
    { id: "swVoFlags", label: "Missing-field and inconsistency flags", on: settings.missing_fields && settings.inconsistency_flags, attrs: switchAttrs(viewer, "doc_flags") },
    { id: "swVoSummaries", label: "Matter summaries", on: settings.staff_answers, attrs: switchAttrs(viewer, "staff_answers") },
    { id: "swVoReplies", label: "Administrative replies", on: settings.reply_drafts, attrs: switchAttrs(viewer, "reply_drafts") },
    { id: "swVoLetters", label: "First drafts of letters from approved facts", on: false, attrs: switchAttrs(viewer, null) },
  ];
  // This week counts what the drafts page lists: reply drafts and document readings (the same two
  // kinds as the "waiting" count). A reading is accepted once each proposal is decided.
  const weekReadings = input.weekReadings ?? [];
  const accepted = input.week.filter((row) => row.status === "sent" && !row.edited).length + weekReadings.filter((row) => row.status === "reviewed").length;
  const edited = input.week.filter((row) => row.status === "sent" && row.edited).length;
  const rejected = input.week.filter((row) => row.status === "discarded").length + weekReadings.filter((row) => row.status === "discarded").length;
  const weekTotal = input.week.length + weekReadings.length;
  return {
    heading,
    intro: "Vo prepares drafts from your firm’s own records. Nothing is sent, signed or changed until a person accepts it.",
    loading: input.running ? { label: "Vo is drafting", clock: seconds(Math.max(0, Date.now() - Date.parse(input.running.createdAt))) } : null,
    cards: [
      ...input.waiting.map((row) => ({ at: row.createdAt, card: draftCard(row, names, viewer) })),
      ...readings.map((row) => ({ at: row.createdAt, card: readingCard(row, names, viewer) })),
    ]
      .sort((a, b) => b.at.localeCompare(a.at))
      .map((item) => item.card),
    running: input.running
      ? {
          started: parts(input.running.createdAt, viewer.timeZone).time,
          text: `${input.running.kind === "ask" ? "An answer" : input.running.kind === "document_review" ? "A document reading" : "A draft"} for ${names.matter(input.running.matterId)}. Usually ready in under a minute. You can leave this page.`,
        }
      : null,
    abstain: input.abstained
      ? {
          meta: { left: "Vo didn’t draft this one", right: "needs a consultant" },
          title: `${names.matter(input.abstained.matterId)}: the request needs a consultant`,
          copy: "It asked for advice, an eligibility view or a rule Vo has no approved source for, so Vo won’t guess. Answer it yourself from the conversation.",
        }
      : null,
    empty: count === 0
      ? {
          title: "Nothing to review",
          copy: settings.enabled
            ? "Open a conversation on a matter and choose Draft with Vo, or Read with Vo when reviewing a document. Drafts wait here until someone decides."
            : "Vo is off for this firm. Every workflow works by hand; the firm owner can turn Vo on in Vo and AI.",
        }
      : null,
    lock: "Vo can’t sign, submit, send, move money, change bank details, give legal advice or record a decision. Those always need a person with the right role.",
    switches,
    week: [`${weekTotal} ${weekTotal === 1 ? "draft" : "drafts"}`, `${accepted} accepted`, `${edited} edited`, `${rejected} rejected`],
    weekNote: "Every run records the model, the prompt version, the records it read and who reviewed it.",
  };
}

function aiSwitch(id: string, label: string, on: boolean, attrs: Attrs, small?: string, sr = label): AiSwitch {
  return { id, label, small, sr, on, attrs };
}

export function aiSettings(viewer: VoViewer, settings: VoSettings): AiSettings {
  const a = (key: VoSettingKey | null) => switchAttrs(viewer, key);
  const notes: string[] = [];
  if (!settings.saved) notes.push(viewer.sampleMode ? "Vo is on because this firm is in sample mode, for sample records only. A real firm starts with Vo off." : "Vo is off until the firm owner turns it on.");
  if (!viewer.agentReady) notes.push("Vo isn’t configured on this server yet, so it shows as unavailable.");
  if (!viewer.isOwner) notes.push("Only the firm owner can change these switches.");
  return {
    intro: "Turn Vo off for the whole firm, for one capability or for a sensitive kind of document. Switched off, every workflow still works by hand (AI-01, AI-06).",
    firm: [
      aiSwitch("swVoFirm", `Vo for ${viewer.firmName}`, settings.enabled, a("enabled"), "Drafts only. People accept, edit or reject everything."),
      aiSwitch("swVoClassify", "Document classification", settings.doc_classification, a("doc_classification")),
      aiSwitch("swVoOcr", "OCR normalisation (names, dates, numbers)", settings.ocr_normalisation, a("ocr_normalisation")),
      aiSwitch("swVoMissing", "Missing-field detection", settings.missing_fields, a("missing_fields")),
      aiSwitch("swVoFlags", "Inconsistency flags (not fraud findings)", settings.inconsistency_flags, a("inconsistency_flags")),
      aiSwitch("swVoSummaries", "Matter summaries for staff", settings.staff_answers, a("staff_answers")),
      aiSwitch("swVoReplies", "Administrative reply drafts", settings.reply_drafts, a("reply_drafts")),
      aiSwitch("swVoLetters", "First drafts of letters from approved facts", false, a(null)),
    ],
    categories: [
      aiSwitch("swVoIdentity", "Identity documents", settings.read_identity, a("read_identity"), "Passports, birth certificates", "Vo may read Identity documents"),
      aiSwitch("swVoRelationship", "Relationship evidence", settings.read_relationship, a("read_relationship"), "Photos, certificates", "Vo may read Relationship evidence"),
      aiSwitch("swVoFinancial", "Financial documents", settings.read_financial, a("read_financial"), "Income, bank statements", "Vo may read Financial documents"),
      aiSwitch("swVoMedical", "Medical records", settings.read_medical, a("read_medical"), "Always reviewed by people", "Vo may read Medical records"),
      aiSwitch("swVoCriminal", "Criminal history", settings.read_criminal, a("read_criminal"), "Police certificates, court records", "Vo may read Criminal history"),
      aiSwitch("swVoNarratives", "Narratives and letters", settings.read_narratives, a("read_narratives"), "Personal statements", "Vo may read Narratives and letters"),
      aiSwitch("swVoMessages", "Client messages", settings.read_client_messages, a("read_client_messages"), "Portal messages", "Vo may read Client messages"),
    ],
    dataUse: [
      { term: "Training on your files", value: "Never by Casevoya. The AI vendor’s terms are in review (pending)" },
      { term: "Vendor retention", value: "Pending the AI vendor review (Anthropic, Cloudflare)" },
      { term: "What Vo can read", value: "Only the matter and conversation you’re working in, with your own access" },
      { term: "Documents’ own instructions", value: "Ignored. Text inside an upload or a message can’t change Vo’s rules (AI-05)" },
    ],
    note: notes.length ? notes.join(" ") : null,
  };
}

const TASK_LABEL: Record<VoRunRow["kind"], string> = {
  message_reply: "Reply draft",
  document_request: "Document request explanation",
  ask: "Ask Vo",
  document_review: "Document reading",
};
const FAILURE_LABEL: Record<string, string> = {
  unavailable: "Vo unavailable",
  empty: "No usable draft",
  nothing_to_draft: "Nothing to draft",
  expired: "Timed out",
  failed: "Didn’t finish",
  refused: "Switched off",
  unsupported_file: "File type not supported",
};

export function runReview(run: VoRunRow): { badge: MatterBadge; token: string } {
  if (run.result === "running") return { badge: { tone: "rev", label: "Running" }, token: "" };
  if (run.result === "answered") return { badge: { tone: "ok", label: "Answered", detail: "staff only" }, token: "accepted" };
  if (run.result === "abstained") return { badge: { tone: "chg", label: "Abstained", detail: "left for a consultant" }, token: "abstained" };
  if (run.result === "failed") return { badge: { tone: "gr", label: FAILURE_LABEL[run.failure ?? "failed"] ?? "Didn’t finish" }, token: "" };
  if (!run.draft || run.draft.status === "draft") return { badge: { tone: "rev", label: "Waiting" }, token: "" };
  if (run.draft.status === "discarded") return { badge: { tone: "bad", label: "Rejected" }, token: "rejected" };
  if (run.draft.status === "reviewed") return { badge: { tone: "ok", label: "Reviewed", detail: "each proposal decided" }, token: "accepted" };
  return run.draft.edited ? { badge: { tone: "ok", label: "Edited" }, token: "edited" } : { badge: { tone: "ok", label: "Accepted" }, token: "accepted" };
}

export function aiRunRows(runs: VoRunRow[], names: VoNames, viewer: VoViewer): AiRunRow[] {
  return runs.map((run) => {
    const review = runReview(run);
    const rateable = run.result === "drafted" || run.result === "answered";
    const vote = (useful: boolean): Attrs => ({ "data-vo-useful": useful ? "1" : "0", "data-run": run.id, "data-org": viewer.organizationId });
    return {
      when: dayTime(run.createdAt, viewer.timeZone),
      matter: names.reference(run.matterId),
      task: `${TASK_LABEL[run.kind]}${run.kind === "ask" ? "" : ` for ${names.matter(run.matterId)}`}`,
      model: { left: run.model ?? "—", right: `${run.tools.length} tool ${run.tools.length === 1 ? "call" : "calls"}` },
      prompt: run.promptVersion ?? "—",
      sources:
        run.kind === "document_review" && run.versionId
          ? `Document version ${run.versionId.slice(0, 8)}`
          : run.sourceCount
            ? `${run.sourceCount} ${run.sourceCount === 1 ? "record" : "records"}`
            : "—",
      actor: names.person(run.userId),
      cost: run.costUsd != null ? `$${run.costUsd.toFixed(4)}` : "—",
      review: review.badge,
      useful: rateable ? { up: run.useful === true, down: run.useful === false, upAttrs: vote(true), downAttrs: vote(false) } : null,
      attrs: review.token ? { "data-f": review.token } : ({} as Attrs),
    };
  });
}

export function aiAudit(drafts: VoDraftRow[], names: VoNames, viewer: VoViewer): AiAudit {
  return {
    rows: drafts.map((row) => ({
      draft: row.title,
      matter: names.reference(row.matterId),
      result:
        row.status === "draft"
          ? { tone: "rev", label: "Waiting" }
          : row.status === "discarded"
            ? { tone: "bad", label: "Rejected" }
            : { tone: "ok", label: row.edited ? "Edited" : "Accepted" },
      by: row.status === "draft" ? "—" : names.person(row.reviewedBy),
      when: row.reviewedAt ? shortDay(row.reviewedAt, viewer.timeZone) : "—",
      change: row.status === "draft" ? "—" : row.status === "discarded" ? "Not sent" : row.edited ? "Edited before sending" : "None",
    })),
    empty: drafts.length ? null : { title: "No drafts yet", copy: "Every Vo draft appears here with what happened to it and who decided." },
  };
}

export type ApprovedSourceRow = { title: string | null; publisher: string; reviewStatus: string; changeState: string; nextReviewAt: string | null; canonicalUrl: string };

export function aiSources(rows: ApprovedSourceRow[], viewer: VoViewer): AiSources {
  const now = Date.now();
  return {
    intro: "The approved, jurisdiction-specific sources Vo may point to. Vo can’t read their content, so it never quotes a rule: a question that needs one goes to a consultant (AI-04).",
    rows: rows.map((row) => {
      const overdue = row.nextReviewAt ? Date.parse(row.nextReviewAt) < now : false;
      const state: MatterBadge =
        row.reviewStatus === "verified" && !overdue && row.changeState !== "change_detected"
          ? { tone: "ok", label: "Approved" }
          : row.reviewStatus === "review_due" || overdue || row.changeState === "change_detected"
            ? { tone: "chg", label: "Stale", detail: "Vo won’t cite" }
            : row.reviewStatus === "in_review" || row.reviewStatus === "evidence_captured"
              ? { tone: "rev", label: "In review" }
              : { tone: "gr", label: row.reviewStatus === "suspended" ? "Suspended" : "Not checked" };
      return {
        source: row.title ?? row.canonicalUrl,
        publisher: row.publisher,
        effective: "—",
        review: row.nextReviewAt ? (overdue ? { left: shortDay(row.nextReviewAt, viewer.timeZone), right: "overdue" } : shortDay(row.nextReviewAt, viewer.timeZone)) : "—",
        owner: "—",
        state,
      };
    }),
    detail: null,
    empty: rows.length ? null : { title: "No approved sources yet", copy: "Until a source is approved on Templates, Vo hands every rule question to a consultant." },
  };
}

export function aiStates(viewer: VoViewer): AiStates {
  return {
    abstain: {
      title: { left: "No approved source", right: "Vo abstains" },
      quote: "“This asks for advice or a rule I have no approved source for, so I haven’t drafted it. Please answer it yourself.”",
      badge: { tone: "chg", label: "Left for a consultant" },
      tag: { left: "Run logged", right: "no draft saved" },
      note: "Vo doesn’t guess, and it doesn’t show a made-up figure as a placeholder (SRC-09).",
    },
    cite: {
      quote: "Every draft lists the records Vo read for it: the client’s messages, open document requests, tasks, deadlines and the matter.",
      timeline: { done: true, clock: "", said: "Checked the records Vo read", items: ["Client messages in the conversation", "Open document requests", "The matter"] },
    },
    offline: viewer.agentReady
      ? { lead: "Vo is available.", text: " If it stops answering, draft by hand; everything else works as usual and waiting drafts stay here.", actions: [] }
      : { lead: "Vo is offline right now.", text: " Draft by hand; everything else works as usual. Vo isn’t configured on this server yet.", actions: [] },
    uncertain: "When a draft would need an immigration rule, a fee, a deadline or a processing time, Vo writes “[needs a sourced rule]” instead, and the draft can’t be sent until a person replaces it.",
  };
}

export const AI_RULES: AiRules = {
  approvals: [
    ["Sending any Vo draft to a client", "The staff member who sends it"],
    ["Legal advice and client explanations", "Responsible consultant"],
    ["Turning Vo on or off", "Firm owner, with two-step sign-in"],
  ],
  never: ["Sign anything", "Submit to a government", "Send a message or an email", "Change bank details or move money", "Decide or infer an official decision", "Change any record (its only write is a draft)"],
  gates: [
    { term: "Tools", value: "Read-only Casevoya tools and Save draft; every built-in tool is off" },
    { term: "Source anchors", value: "Every draft lists the records it read" },
    { term: "Cross-firm retrieval", value: "Vo reads with your own access (RLS); tested" },
    { term: "Prompt injection", value: "Client and document text is data; tested with injection strings" },
  ],
};

export function aiPills(viewer: VoViewer, settings: VoSettings): string[] {
  const pills = [settings.enabled ? "Vo on" : "Vo off", "Drafts only"];
  if (viewer.sampleMode && settings.enabled) pills.push("Sample records only");
  if (!viewer.agentReady) pills.push("Vo unavailable");
  return pills;
}

export function aiPage(input: {
  tab: AiTab;
  viewer: VoViewer;
  settings: VoSettings;
  runs: VoRunRow[];
  drafts: VoDraftRow[];
  sources: ApprovedSourceRow[];
  names: VoNames;
}): AiData {
  const { tab, viewer, settings, names } = input;
  return {
    tab,
    pills: aiPills(viewer, settings),
    settings: tab === "settings" ? aiSettings(viewer, settings) : undefined,
    runs:
      tab === "runs"
        ? {
            intro: "Every Vo run, with its model, prompt version, how many records it read, the tools it called and who reviewed it. Protected like the case file (AI-02).",
            chips: ["All", "Accepted", "Edited", "Rejected", "Abstained"],
            rows: aiRunRows(input.runs, names, viewer),
            note: "Prompts and answers aren’t kept in the log; identity numbers are removed before Vo reads a record.",
            empty: { title: "No Vo runs yet", copy: "Runs appear here when someone asks Vo for a draft or an answer." },
          }
        : undefined,
    sources: tab === "sources" ? aiSources(input.sources, viewer) : undefined,
    states: tab === "states" ? aiStates(viewer) : undefined,
    rules: tab === "rules" ? AI_RULES : undefined,
    audit: tab === "audit" ? aiAudit(input.drafts, names, viewer) : undefined,
  };
}
