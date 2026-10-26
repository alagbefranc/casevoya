/**
 * How a tool records what it showed the model (SRC-09). Every record a result shows is a source the
 * run may cite. For Ask Vo each one also gets a marker ([R#] a record of the matter, [F#] an
 * approved fact, [S#] approved official content): the markers handed out are the run's allowed
 * set, and the answer keeps only sentences that cite one of them (src/modules/vo/grounding.ts).
 *
 * Only type imports from tools.ts, so the tool modules can load in any order.
 */
import { markerPrefix } from "../../../src/modules/vo/grounding";
import { oneLine } from "../../../src/modules/vo/prompt";
import type { VoSourceRef } from "../../../src/modules/vo/sign";
import type { RunContext } from "./tools";

/** Records a source; for Ask Vo, returns its marker ("[R3] ") to put before the line, otherwise "". */
export function cite(ctx: RunContext, ref: VoSourceRef): string {
  const clean = { ...ref, label: oneLine(ref.label, 120) || ref.kind };
  if (!ctx.sources.has(ref.id)) ctx.sources.set(ref.id, clean);
  if (ctx.request.task !== "ask") return "";
  ctx.markers ??= new Map();
  for (const [marker, existing] of ctx.markers) if (existing.id === ref.id && existing.kind === ref.kind) return `[${marker}] `;
  const prefix = markerPrefix(ref.kind);
  const marker = `${prefix}${[...ctx.markers.keys()].filter((key) => key.startsWith(prefix)).length + 1}`;
  ctx.markers.set(marker, { ...clean, marker });
  return `[${marker}] `;
}
