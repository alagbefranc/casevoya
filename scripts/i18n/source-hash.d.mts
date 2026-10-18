export function sourceHash(strings: Record<string, string>): string;
export function staleDrafts(
  source: Record<string, Record<string, string>>,
  drafts: { templates?: Record<string, { sourceHash: string; strings: Record<string, { en: string; fr: string }> }> },
): string[];
