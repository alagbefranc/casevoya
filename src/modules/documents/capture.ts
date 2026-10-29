/** DOC-03: pages captured before they are saved as one PDF. Pure, so the portal and the sheet share it. */

export const QUARTER_TURNS = [0, 90, 180, 270] as const;
export type QuarterTurn = (typeof QUARTER_TURNS)[number];
export type CaptureSource = "camera" | "library";

export const MAX_CAPTURE_PAGES = 40;

export function isQuarterTurn(value: number): value is QuarterTurn {
  return value === 0 || value === 90 || value === 180 || value === 270;
}

/** The next clockwise quarter turn. */
export function nextTurn(turn: QuarterTurn): QuarterTurn {
  const index = QUARTER_TURNS.indexOf(turn);
  return QUARTER_TURNS[(index + 1) % QUARTER_TURNS.length] ?? 0;
}

/** Move one item earlier (delta -1) or later (delta 1). Out of range leaves the list unchanged. */
export function moveItem<T>(items: readonly T[], index: number, delta: -1 | 1): T[] {
  const to = index + delta;
  if (index < 0 || index >= items.length || to < 0 || to >= items.length) return [...items];
  const next = [...items];
  const [item] = next.splice(index, 1);
  if (item === undefined) return [...items];
  next.splice(to, 0, item);
  return next;
}

/** What `public.record_camera_assembly` stores. Rotations only: the image bytes are the PDF. */
export function assemblyPages(pages: readonly { rotation: QuarterTurn; source: CaptureSource }[]): { rotation_degrees: QuarterTurn; source: CaptureSource }[] {
  return pages.map((page) => ({ rotation_degrees: page.rotation, source: page.source }));
}
