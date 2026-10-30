/**
 * Escapes text for use inside HTML element content or a quoted attribute value. Use it for every
 * value that is not a constant (names, emails, titles, messages, ids) when building markup strings;
 * prefer textContent or DOM nodes where possible.
 */
export function escapeHtml(value: string): string {
  return String(value).replace(/[&<>"'`]/g, (char) => HTML_ESCAPES[char] ?? char);
}

const HTML_ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
  "`": "&#96;",
};
