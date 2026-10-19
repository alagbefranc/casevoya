/** Pure helpers for the sample-mode page. */
import type { SampleStep } from "@/components/sheet/designer/sample-case";
import { licenceState } from "@/modules/sheet/licence-state";

/** The six sample proofs in the Designer's order and words. */
export function sampleSteps(matterId: string | null, firm: string, applicant: string, done: Set<string>): SampleStep[] {
  const matter = matterId ? `/sheet/matters/${matterId}` : "/sheet/matters";
  return [
    { key: "intake", image: "intake", title: "Send an intake form", note: `${applicant} fills in her history`, href: `${matter}?tab=intake` },
    { key: "agreement", image: "agreement", title: "Send a service agreement", note: "Signing order: Priya, then Rafael", href: "/sheet/agreements" },
    { key: "upload", image: "upload", title: "Request and review an upload", note: "Marriage certificate", href: `${matter}?tab=documents` },
    { key: "reminder", image: "reminder", title: "Schedule a reminder", note: "Police certificate due in 14 days", href: "/sheet/automations" },
    { key: "invoice", image: "invoice", title: "Issue an invoice", note: `From ${firm} to ${applicant}`, href: `${matter}?tab=billing` },
    { key: "export", image: "export", title: "Export the file", note: "ZIP with the audit trail", href: "/sheet/exports" },
  ].map((step) => ({ ...step, done: done.has(step.key) }));
}

/** How the licence check reads on the sample panel. */
export function licenceCheckWords(status: string, latestResult: string | null = null): string {
  const state = licenceState({ status, latestResult });
  if (state === "verified") return "verified";
  if (state === "needs_review") return "needs review";
  if (state === "declared") return "declared";
  return "needs attention";
}

/** Whole days left in the trial, never below zero; null without an end date. */
export function trialDaysLeft(endsAt: string | null, now: Date): number | null {
  if (!endsAt) return null;
  const ms = new Date(endsAt).getTime() - now.getTime();
  return Number.isFinite(ms) ? Math.max(0, Math.ceil(ms / 86_400_000)) : null;
}
