import { expect } from "vitest";

/**
 * Text-only copy changes to captured Designer markup (2026-10-19 audit, branch fix-practice-settings):
 * internal requirement codes such as "(ADM-03, PREP-04)", "(AI-02)" or "(ORG-01)" are removed from
 * user-facing text, and a few sentences say what is true. Same DOM and classes. Fidelity tests
 * compare the live component with the capture after these swaps.
 */
export const REQUIREMENT_CODE = / \((?:[A-Z]{2,5}-\d{2}[a-z]?(?:, ?(?:[A-Z]{2,5}-\d{2}[a-z]?|scenario \d+))*|PRD §\d+)\)/g;

export function withoutRequirementCodes(captured: string): string {
  return captured.replace(REQUIREMENT_CODE, "");
}

/** Swaps each `from` (which must be in the capture) for `to`. */
export function withCopy(captured: string, swaps: readonly (readonly [string, string])[]): string {
  return swaps.reduce((html, [from, to]) => {
    expect(html).toContain(from);
    return html.replace(from, to);
  }, captured);
}
