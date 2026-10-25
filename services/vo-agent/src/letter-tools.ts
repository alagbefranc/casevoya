/**
 * Vo's letter tools (AI-01): the approved facts of the run's matter, the firm's approved official
 * content, and one write, save_letter_draft, which keeps the guarded letter in memory for the run
 * to save as a DRAFT matter letter (public.save_vo_letter_draft). Nothing is sent or released:
 * a licensed member approves a letter before it can be released, in the app.
 *
 * Facts are handed out as [F1], [F2]... and official content as [S1], [S2]... The letter cites them
 * with those markers; the database rebuilds each citation from its own rows and refuses anything
 * that isn't an approved fact of this matter or approved official content of this firm. Client
 * and staff text reaches the model only inside nonce-delimited DATA blocks.
 *
 * Only type imports from tools.ts, so the two modules can load in either order.
 */
import { z } from "zod";
import { dataBlock, oneLine, VO_MODEL, VO_PROMPT_VERSION } from "../../../src/modules/vo/prompt";
import { guardLetter } from "../../../src/modules/vo/letter-guard";
import { factText, letterTypeLabel } from "../../../src/modules/vo/letter";
import { attestationLine } from "../../../src/modules/vo/grounding";
import type { VoSourceRef } from "../../../src/modules/vo/sign";
import type { VoLetterFact, VoOfficialItem } from "./data";
import type { RunContext, ToolResult, ToolSpec } from "./tools";

export type LetterToolName = "read_approved_facts" | "find_official_content" | "save_letter_draft";

export type LetterDraft = { title: string; text: string; facts: string[]; official: string[]; leftOut: string[] };

export type LetterContext = {
  /** "F1" to the fact it stands for, in the order handed out. */
  facts: Map<string, VoLetterFact>;
  /** "S1" to the official item it stands for. */
  official: Map<string, VoOfficialItem>;
  /** The firm's approved official content, read once per run. */
  officialAll: VoOfficialItem[] | null;
  draft: LetterDraft | null;
};

function letterContext(ctx: RunContext): LetterContext {
  ctx.letter ??= { facts: new Map(), official: new Map(), officialAll: null, draft: null };
  return ctx.letter;
}

function text(value: string): ToolResult {
  return { content: [{ type: "text", text: value }] };
}
function refused(value: string): ToolResult {
  return { content: [{ type: "text", text: value }], isError: true };
}

/** Identity numbers are redacted before anything reaches the model (the same rule as tools.ts). */
function redact(value: string): string {
  return value.replace(/\b[A-Z]{1,2}\d{6,9}\b/g, "[number removed]").replace(/\b\d[\d -]{7,}\d\b/g, "[number removed]");
}

const KIND_LABEL: Record<string, string> = {
  fee: "IRCC fee",
  submission_requirement: "Submission step",
  renewal_timing: "Renewal timing",
  follow_up_step: "Step after approval",
  rule_version: "Program rule",
};

/** The marker for a record, handed out once per run in order. */
function refFor<T>(map: Map<string, T>, prefix: "F" | "S", same: (item: T) => boolean, item: T): string {
  for (const [ref, existing] of map) if (same(existing)) return ref;
  const ref = `${prefix}${map.size + 1}`;
  map.set(ref, item);
  return ref;
}

export const LETTER_TOOL_SPECS: Record<LetterToolName, ToolSpec> = {
  read_approved_facts: {
    name: "read_approved_facts",
    description:
      "The approved facts of this matter: the clients' intake answers that staff reviewed, each with its marker [F#]. The only facts about the people a letter may use.",
    shape: {},
    readOnly: true,
    async run(ctx) {
      const letter = letterContext(ctx);
      const read = ctx.data.letterFacts ? await ctx.data.letterFacts(ctx.request.runId) : { facts: [], hidden: 0 };
      const lines: string[] = [];
      for (const fact of read.facts.slice(0, 60)) {
        const ref = refFor(letter.facts, "F", (existing) => existing.answerId === fact.answerId, fact);
        lines.push(`[${ref}] ${oneLine(fact.person, 80)}: ${oneLine(fact.label, 120)} (form: ${oneLine(fact.form, 80)})`);
        lines.push(dataBlock(ctx.nonce, redact(factText(fact.fieldType, fact.value)), 300));
      }
      if (!lines.length) lines.push("No approved facts on this matter. Do not draft a letter; answer DONE.");
      if (read.hidden) lines.push(`${read.hidden} approved fact(s) are hidden by the firm's Vo settings. Don't ask for them or guess them.`);
      return text(lines.join("\n"));
    },
  },
  find_official_content: {
    name: "find_official_content",
    description:
      "The firm's approved official content (IRCC fees, submission steps, renewal timings, steps after approval, program rules) matching a topic, each with its marker [S#]. Quote it as given; nothing else about fees, dates or requirements may appear.",
    shape: { topic: z.string().max(120).describe("What the letter needs, e.g. the fee for this application") },
    readOnly: true,
    async run(ctx, args) {
      const letter = letterContext(ctx);
      letter.officialAll ??= ctx.data.officialContent ? await ctx.data.officialContent(ctx.request.runId) : [];
      const words = String(args.topic ?? "")
        .toLowerCase()
        .split(/\W+/)
        .filter((word) => word.length > 3);
      const rows = letter.officialAll
        // A page Casevoya didn't capture only with the reviewer's attestation to show next to it.
        .filter((row) => !row.attested || attestationLine(row.attestedBy, row.attestedOn))
        .filter((row) => words.some((word) => `${row.kind} ${KIND_LABEL[row.kind] ?? ""} ${row.label} ${row.content}`.toLowerCase().includes(word)))
        .slice(0, 8);
      if (!rows.length) return text("No approved official content covers this. Leave it out of the letter and name it in left_out. Do not answer from memory.");
      const lines: string[] = [];
      for (const row of rows) {
        const ref = refFor(letter.official, "S", (existing) => existing.id === row.id && existing.kind === row.kind, row);
        const attested = row.attested ? attestationLine(row.attestedBy, row.attestedOn) : null;
        lines.push(`[${ref}] ${KIND_LABEL[row.kind] ?? "Official content"}${row.checkedOn ? `, official page checked ${oneLine(row.checkedOn, 10)}` : ""}${attested ? `. ${oneLine(attested, 200)}` : ""}:`);
        lines.push(dataBlock(ctx.nonce, row.content, 600));
      }
      return text(lines.join("\n"));
    },
  },
  save_letter_draft: {
    name: "save_letter_draft",
    description:
      "Save the letter as a DRAFT for a licensed consultant to review and approve. Nothing is sent. Call it once, with every fact and official item cited by its marker, and what you left out.",
    shape: {
      title: z.string().min(1).max(200).describe("A short title, e.g. Cover letter"),
      text: z.string().min(1).max(12000).describe("The letter, plain text, with [F#] and [S#] markers"),
      left_out: z.array(z.string().max(300)).max(10).optional().describe("What the letter would need but has no approved fact or source for"),
    },
    readOnly: false,
    async run(ctx, args) {
      const letter = letterContext(ctx);
      if (letter.draft) return refused("A letter was already saved for this run.");
      const guarded = guardLetter(String(args.text ?? ""), { facts: letter.facts.keys(), official: letter.official.keys() }, args.left_out ?? []);
      if (guarded.kind === "abstain") {
        ctx.abstainedByDraft = true;
        return text("Noted: this needs a consultant. No letter was saved.");
      }
      if (guarded.kind === "empty") {
        return refused(
          guarded.reason === "no_fact"
            ? "A letter must state at least one approved fact with its marker, e.g. [F1]."
            : "The letter was empty after removing what isn't allowed.",
        );
      }
      const title = oneLine(String(args.title ?? ""), 200) || letterTypeLabel(ctx.request.letterType ?? "");
      letter.draft = { title, text: guarded.text, facts: guarded.facts, official: guarded.official, leftOut: guarded.leftOut };
      return text("Letter saved as a draft for review. Answer DONE.");
    },
  },
};

/**
 * The end of a letter run (task.ts): no letter, an abstention or a failure ends through
 * finish_vo_run like every run; a letter is saved by save_vo_letter_draft, which ends the run as
 * drafted. A refused save closes the run as failed.
 */
export async function finishLetterRun(
  ctx: RunContext,
  input: {
    metrics: Record<string, unknown>;
    latencyMs: number;
    success: boolean;
    abstained: boolean;
    finish: (args: Record<string, unknown>) => Promise<{ data: unknown; error: { message: string } | null }>;
  },
): Promise<
  | { result: "drafted"; draftId: string; text: string; needsRule: false; sources: VoSourceRef[] }
  | { result: "abstained" }
  | { result: "failed"; failure: "failed" | "empty" | "nothing_to_draft" }
> {
  const letter = ctx.letter?.draft ?? null;
  const fail = async (failure: "failed" | "empty" | "nothing_to_draft") => {
    await input.finish({ p_result: "failed", p_failure: failure, ...input.metrics });
    return { result: "failed" as const, failure };
  };
  if (!letter) {
    if (input.abstained) {
      await input.finish({ p_result: "abstained", p_model: VO_MODEL, ...input.metrics });
      return { result: "abstained" };
    }
    if (ctx.letter && ctx.letter.facts.size === 0 && ctx.calls.includes("read_approved_facts")) return fail("nothing_to_draft");
    return fail(input.success ? "empty" : "failed");
  }
  const facts = letter.facts.flatMap((ref) => {
    const fact = ctx.letter?.facts.get(ref);
    return fact ? [{ ref, fact }] : [];
  });
  const official = letter.official.flatMap((ref) => {
    const item = ctx.letter?.official.get(ref);
    return item ? [{ ref, item }] : [];
  });
  const saved = await ctx.data.rpc("save_vo_letter_draft", {
    p_run_id: ctx.request.runId,
    p_letter_type: ctx.request.letterType,
    p_title: letter.title,
    p_body: letter.text,
    p_facts: facts.map(({ ref, fact }) => ({ ref, answer_id: fact.answerId })),
    p_official: official.map(({ ref, item }) => ({ ref, kind: item.kind, id: item.id })),
    p_left_out: letter.leftOut,
    p_model: VO_MODEL,
    p_prompt_version: VO_PROMPT_VERSION.letter_draft,
    p_latency_ms: input.latencyMs,
    ...input.metrics,
  });
  if (saved.error || typeof saved.data !== "string") return fail("failed");
  const sources: VoSourceRef[] = [
    ...facts.map(({ ref, fact }) => ({ kind: "fact" as const, id: fact.answerId, label: oneLine(`${ref} ${fact.label}`, 120) })),
    ...official.map(({ ref, item }) => ({ kind: "official" as const, id: item.id, label: oneLine(`${ref} ${KIND_LABEL[item.kind] ?? "Official content"}`, 120) })),
  ];
  return { result: "drafted", draftId: saved.data, text: letter.text, needsRule: false, sources };
}
