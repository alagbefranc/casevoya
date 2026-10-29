/**
 * PREP-03: the evidence bundle's file name and size cap.
 * The default pattern and 25 MiB cap are Casevoya product settings, the same number as the
 * default upload limit. They are not an IRCC rule. A firm may set its own pattern and a cap
 * from 1 MiB to 100 MiB per channel.
 */

export const DEFAULT_BUNDLE_PATTERN = "{reference}-evidence-bundle.pdf";
export const DEFAULT_BUNDLE_MAX_BYTES = 25 * 1024 * 1024;
export const MIN_BUNDLE_MAX_BYTES = 1 * 1024 * 1024;
export const MAX_BUNDLE_MAX_BYTES = 100 * 1024 * 1024;

const PATTERN = /^[A-Za-z0-9._-]{0,40}(\{(reference|channel|date)\}[A-Za-z0-9._-]{0,40}){0,6}\.pdf$/;

export function channelPatternOk(pattern: string): boolean {
  return pattern.length >= 5 && pattern.length <= 120 && !pattern.includes("..") && PATTERN.test(pattern);
}

function cleanToken(value: string, fallback: string): string {
  const out = value.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60);
  return out || fallback;
}

function tokenValue(key: "reference" | "channel" | "date", values: { reference: string; channel: string; date: string }): string {
  switch (key) {
    case "reference":
      return cleanToken(values.reference, "matter");
    case "channel":
      return cleanToken(values.channel, "channel");
    case "date":
      return cleanToken(values.date, "date");
    default: {
      const unexpected: never = key;
      return unexpected;
    }
  }
}

/** A download name from the channel pattern. Tokens that are not reference, channel or date are left out. */
export function bundleFileName(pattern: string, values: { reference: string; channel: string; date: string }): string {
  const source = channelPatternOk(pattern) ? pattern : DEFAULT_BUNDLE_PATTERN;
  const filled = source.replace(/\{(reference|channel|date)\}/g, (match, key: string) => {
    if (key === "reference" || key === "channel" || key === "date") return tokenValue(key, values);
    return match;
  });
  const safe = filled.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/-+/g, "-").replace(/^\.+/, "");
  if (safe.toLowerCase().endsWith(".pdf") && safe.length >= 5 && safe.length <= 180) return safe;
  return `${cleanToken(values.reference, "matter")}-evidence-bundle.pdf`;
}
