/** Display helper. Prices are not stored here; callers pass integer cents. */
export function formatCents(cents: number, currency = "cad"): string {
  const amount = (cents / 100).toLocaleString("en-CA", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return currency.toLowerCase() === "cad" ? `CAD ${amount}` : `${currency.toUpperCase()} ${amount}`;
}
