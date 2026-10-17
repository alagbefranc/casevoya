/** Same-site relative path only. Rejects protocol-relative URLs. */
export function safeNext(value: FormDataEntryValue | string | null | undefined, fallback = "/app"): string {
  const next = typeof value === "string" ? value : fallback;
  if (!next.startsWith("/") || next.startsWith("//") || next.includes("\\")) return fallback;
  return next;
}
