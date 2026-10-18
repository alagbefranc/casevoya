/** Pure helpers that turn the firm's current policies into the Settings > Client portal page and dialogs. */
import type { PolicyCard, PolicyDialogData } from "@/components/sheet/designer/portal-policies";
import { longDate } from "@/modules/sheet/matter-present";
import { isoDateInTimeZone } from "@/modules/sheet/present";
import {
  defaultPolicy,
  nextVersionLabel,
  POLICY_KINDS,
  type CurrentPolicies,
  type CurrentPolicy,
  type FirmFacts,
  type PolicyKind,
} from "@/modules/portal-policies/defaults";

/** "18 Oct 2026", as a calendar date in the firm's timezone. */
export function publishedOn(publishedAt: string, timeZone: string): string {
  const date = new Date(publishedAt);
  if (Number.isNaN(date.getTime())) return "—";
  try {
    return longDate(isoDateInTimeZone(date, timeZone));
  } catch {
    return longDate(publishedAt.slice(0, 10));
  }
}

export function policyCards(current: CurrentPolicies, timeZone: string): PolicyCard[] {
  return POLICY_KINDS.map((kind) => {
    const row = current[kind];
    return {
      kind,
      current: row ? { versionLabel: row.versionLabel, title: row.title, publishedOn: publishedOn(row.publishedAt, timeZone) } : null,
    };
  });
}

/** The publish dialog starts from the published text (next version label), or from the starting draft. */
export function policyDialog(kind: PolicyKind, current: CurrentPolicy | null, firm: FirmFacts, organizationId: string): PolicyDialogData {
  if (current) {
    return { kind, organizationId, versionLabel: nextVersionLabel(current.versionLabel), title: current.title, body: current.body, draft: false };
  }
  const draft = defaultPolicy(kind, firm);
  return { kind, organizationId, versionLabel: nextVersionLabel(null), title: draft.title, body: draft.body, draft: true };
}
