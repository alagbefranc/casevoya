/**
 * A small word-level diff for the Compare versions tab: two agreement texts in, a list of
 * tokens out (`same`, `del`, `ins`) that the page renders as the Designer's `<del>`/`<ins>`
 * inside `.fp-diff`. Words keep the whitespace that follows them, so joining the `same` and
 * `ins` tokens gives the new text exactly and joining `same` and `del` gives the old one.
 * Myers' O((N+M)D) algorithm; no dependency.
 */
export type DiffToken = { kind: "same" | "del" | "ins"; text: string };

/** Words with their trailing whitespace ("fee ", "2,600.00, "). Line breaks stay attached. */
export function diffWords(text: string): string[] {
  return text.match(/\S+\s*|\s+/g) ?? [];
}

/** The old and new text as tokens. Neighbouring tokens of one kind are merged. */
export function diffTexts(before: string, after: string): DiffToken[] {
  const a = diffWords(before);
  const b = diffWords(after);
  const ops = myers(a, b);
  const out: DiffToken[] = [];
  for (const op of ops) {
    const last = out[out.length - 1];
    if (last && last.kind === op.kind) last.text += op.text;
    else out.push({ ...op });
  }
  return out;
}

/** Whether a diff has any change at all. */
export function hasChanges(tokens: readonly DiffToken[]): boolean {
  return tokens.some((token) => token.kind !== "same");
}

/**
 * The diff split into paragraphs (blank-line separated), each a token list, so a page can render
 * one `<p>` per paragraph as the Designer does. A paragraph break inside a token ends the
 * paragraph; tokens keep their kind across the break.
 */
export function diffParagraphs(tokens: readonly DiffToken[]): DiffToken[][] {
  const paragraphs: DiffToken[][] = [[]];
  for (const token of tokens) {
    // Paragraph breaks follow the new text; a removed break reads inside the paragraph it left.
    const parts = token.kind === "del" ? [token.text.replace(/\n\s*\n/g, " ")] : token.text.split(/\n\s*\n/);
    parts.forEach((part, index) => {
      if (index > 0) paragraphs.push([]);
      const text = part.replace(/\s+/g, " ");
      if (!text) return;
      const current = paragraphs[paragraphs.length - 1];
      const last = current[current.length - 1];
      if (last && last.kind === token.kind) last.text += text;
      else current.push({ kind: token.kind, text });
    });
  }
  return paragraphs
    .map((paragraph) => trimParagraph(paragraph))
    .filter((paragraph) => paragraph.length > 0);
}

/**
 * Trims the paragraph's edges and moves a change token's trailing space onto the unchanged text
 * after it, so `<del>` and `<ins>` hold only words. A page puts one space between two change
 * tokens that follow each other (the Designer's `<del>…</del> <ins>…</ins>`).
 */
function trimParagraph(paragraph: DiffToken[]): DiffToken[] {
  const out = paragraph.map((token) => ({ ...token }));
  for (let index = 0; index < out.length; index++) {
    const token = out[index];
    if (token.kind === "same") continue;
    const trimmed = token.text.replace(/\s+$/, "");
    if (trimmed !== token.text) {
      token.text = trimmed;
      const next = out[index + 1];
      if (next && next.kind === "same" && !/^\s/.test(next.text)) next.text = ` ${next.text}`;
    }
  }
  if (out.length) {
    out[0].text = out[0].text.replace(/^\s+/, "");
    out[out.length - 1].text = out[out.length - 1].text.replace(/\s+$/, "");
  }
  return out.filter((token) => token.text.length > 0);
}

type Op = { kind: "same" | "del" | "ins"; text: string };

/** Myers' shortest edit script over two token arrays. */
function myers(a: readonly string[], b: readonly string[]): Op[] {
  const n = a.length;
  const m = b.length;
  const max = n + m;
  if (max === 0) return [];
  const offset = max;
  let v = new Int32Array(2 * max + 2);
  const trace: Int32Array[] = [];
  let found = false;
  for (let d = 0; d <= max && !found; d++) {
    trace.push(v);
    const next = new Int32Array(v);
    for (let k = -d; k <= d; k += 2) {
      let x: number;
      if (k === -d || (k !== d && v[offset + k - 1] < v[offset + k + 1])) x = v[offset + k + 1];
      else x = v[offset + k - 1] + 1;
      let y = x - k;
      while (x < n && y < m && a[x] === b[y]) {
        x++;
        y++;
      }
      next[offset + k] = x;
      if (x >= n && y >= m) {
        found = true;
        break;
      }
    }
    v = next;
  }
  // Walk the trace back from the end to rebuild the script.
  const ops: Op[] = [];
  let x = n;
  let y = m;
  for (let d = trace.length - 1; d >= 0; d--) {
    const prev = trace[d];
    const k = x - y;
    let prevK: number;
    if (k === -d || (k !== d && prev[offset + k - 1] < prev[offset + k + 1])) prevK = k + 1;
    else prevK = k - 1;
    const prevX = prev[offset + prevK];
    const prevY = prevX - prevK;
    while (x > prevX && y > prevY) {
      x--;
      y--;
      ops.push({ kind: "same", text: a[x] });
    }
    if (d > 0) {
      if (x === prevX) {
        y--;
        ops.push({ kind: "ins", text: b[y] });
      } else {
        x--;
        ops.push({ kind: "del", text: a[x] });
      }
    }
  }
  ops.reverse();
  // Show a replaced word as the removal first, then the addition, whatever order the walk found.
  return orderPairs(ops);
}

function orderPairs(ops: Op[]): Op[] {
  const out: Op[] = [];
  let i = 0;
  while (i < ops.length) {
    if (ops[i].kind === "same") {
      out.push(ops[i]);
      i++;
      continue;
    }
    const dels: Op[] = [];
    const inss: Op[] = [];
    while (i < ops.length && ops[i].kind !== "same") {
      (ops[i].kind === "del" ? dels : inss).push(ops[i]);
      i++;
    }
    out.push(...dels, ...inss);
  }
  return out;
}
