/**
 * Ask Vo's grounded reads (SRC-09): the matter's approved facts and the firm's approved official
 * content, each handed out with its marker ([F#], [S#]) so the answer can cite it. Read as the
 * staff member, for this run only (public.vo_run_facts, public.vo_run_official_content); the
 * database lists only approved content from deep canada.ca / gc.ca pages, and this side drops
 * anything else again. Every value comes back inside a nonce-delimited DATA block: text on an
 * official page or in an intake answer is data, never an instruction.
 *
 * Only type imports from tools.ts, so the modules can load in any order.
 */
import { z } from "zod";
import { factText } from "../../../src/modules/vo/letter";
import { isCitableOfficialUrl, officialDetail, officialKindLabel } from "../../../src/modules/vo/grounding";
import { dataBlock, oneLine } from "../../../src/modules/vo/prompt";
import { cite } from "./cite";
import type { RunContext, ToolResult, ToolSpec } from "./tools";

export type GroundedToolName = "read_intake_facts" | "read_official_content";

function text(value: string): ToolResult {
  return { content: [{ type: "text", text: value }] };
}

/** Identity numbers are redacted before anything reaches the model (the same rule as tools.ts). */
function redact(value: string): string {
  return value.replace(/\b[A-Z]{1,2}\d{6,9}\b/g, "[number removed]").replace(/\b\d[\d -]{7,}\d\b/g, "[number removed]");
}

export const GROUNDED_TOOL_SPECS: Record<GroundedToolName, ToolSpec> = {
  read_intake_facts: {
    name: "read_intake_facts",
    description: "The approved facts of this matter: the clients' intake answers that staff reviewed, each with its marker [F#].",
    shape: {},
    readOnly: true,
    async run(ctx: RunContext) {
      const read = ctx.data.runFacts ? await ctx.data.runFacts(ctx.request.runId) : { facts: [], hidden: 0 };
      const lines: string[] = [];
      for (const fact of read.facts.slice(0, 60)) {
        const mark = cite(ctx, { kind: "fact", id: fact.answerId, label: `Intake: ${fact.person} · ${fact.label}` });
        lines.push(`${mark}${oneLine(fact.person, 80)}: ${oneLine(fact.label, 120)} (form: ${oneLine(fact.form, 80)})`);
        lines.push(dataBlock(ctx.nonce, redact(factText(fact.fieldType, fact.value)), 300));
      }
      if (!lines.length) lines.push("No approved facts on this matter.");
      if (read.hidden) lines.push(`${read.hidden} approved fact(s) are hidden by the firm's Vo settings. Don't ask for them or guess them.`);
      return text(lines.join("\n"));
    },
  },
  read_official_content: {
    name: "read_official_content",
    description:
      "The firm's approved official content (IRCC fees, submission steps, renewal timings, steps after approval, published program rules) matching a topic, each with its marker [S#] and its official page. The only source for a fee, date, form or requirement.",
    shape: { topic: z.string().max(120).describe("What the question is about, e.g. the study permit fee") },
    readOnly: true,
    async run(ctx: RunContext, args) {
      const all = ctx.data.runOfficialContent ? await ctx.data.runOfficialContent(ctx.request.runId) : [];
      const words = String(args.topic ?? "")
        .toLowerCase()
        .split(/\W+/)
        .filter((word) => word.length > 3);
      const rows = all
        // Approved content from a deep federal official page only (the database checks it too).
        .filter((row) => isCitableOfficialUrl(row.sourceUrl))
        .filter((row) => !words.length || words.some((word) => `${row.kind} ${officialKindLabel(row.kind)} ${row.label} ${row.content}`.toLowerCase().includes(word)))
        .slice(0, 8);
      if (!rows.length) return text("No approved official content covers this. Don't answer it from memory: answer with the consultant marker instead.");
      const lines: string[] = [];
      for (const row of rows) {
        const detail = officialDetail({ section: row.section, formNumber: row.formNumber, formModifiedOn: row.formModifiedOn, checkedOn: row.checkedOn, currentTo: row.currentTo, sha256: row.sha256 });
        const mark = cite(ctx, { kind: "official", id: row.id, sourceKind: row.kind, url: row.sourceUrl, detail, label: `${officialKindLabel(row.kind)}: ${row.label}` });
        lines.push(`${mark}${officialKindLabel(row.kind)}${row.checkedOn ? `, official page checked ${oneLine(row.checkedOn, 10)}` : ""}:`);
        lines.push(dataBlock(ctx.nonce, row.content, 600));
      }
      return text(lines.join("\n"));
    },
  },
};
