/** Pure: the matter Closure tab's checklist from public.matter_closure_check and the matter's records. */
import type { ClosurePanelData } from "@/components/sheet/designer/matter";
import { dayMonth } from "@/modules/sheet/home-present";

export type ClosureCheck = {
  stage: string;
  outcome: string | null;
  blocked: boolean;
  legal_hold: boolean;
  retention_policy: { unit?: string; count?: number | string } | null;
  blockers: {
    client_funds_held_cents: number;
    client_funds_pending_cents: number;
    unpaid_invoices: { number: string; owed_cents: number; currency: string }[];
  };
};

function longDay(iso: string): string {
  return `${dayMonth(iso)} ${iso.slice(0, 4)}`;
}

export function closurePanel(input: {
  check: ClosureCheck;
  openTasks: number;
  consultant: string | null;
  outcome: string | null;
  closed: boolean;
  closure: { closedOn: string; retentionOn: string; years: number; overridden: boolean } | null;
  holdSince: string | null;
  money: (cents: number) => string;
}): ClosurePanelData {
  const { check } = input;
  const held = Number(check.blockers.client_funds_held_cents) || 0;
  const pending = Number(check.blockers.client_funds_pending_cents) || 0;
  const unpaid = check.blockers.unpaid_invoices ?? [];
  const years = check.retention_policy?.unit === "years" ? Number(check.retention_policy.count) || null : null;
  const fundsNote = [held ? `${input.money(held)} held` : "", pending ? `${input.money(pending)} waiting for verification` : ""].filter(Boolean).join(", ");
  const items = [
    { label: "Outcome confirmed by consultant", done: Boolean(input.outcome), note: input.outcome ?? undefined },
    { label: "Follow-up tasks done or handed off", done: input.openTasks === 0, note: input.openTasks ? `${input.openTasks} open` : undefined },
    { label: "Client account balance is zero", done: !held && !pending, note: fundsNote || undefined },
    {
      label: "Issued invoices paid or credited",
      done: unpaid.length === 0,
      note: unpaid.length ? unpaid.map((row) => `${row.number}: ${input.money(Number(row.owed_cents))} owed`).join(", ") : undefined,
    },
  ];
  const ready = check.stage === "post_decision" && items.every((item) => item.done);
  const status: ClosurePanelData["status"] = input.closed
    ? { tone: "ok", label: "Closed", detail: input.closure ? longDay(input.closure.closedOn) : "on record" }
    : ready
      ? { tone: "ok", label: "Ready", detail: "close it from Change stage" }
      : check.stage === "post_decision"
        ? { tone: "chg", label: "Not ready", detail: "items still open" }
        : { tone: "gr", label: "Not ready", detail: "matter is open" };

  const retention: [string, string][] = [
    ["Policy", years ? `Firm setting: ${years} years after closure` : "Not set. Set it in Settings before closing."],
    ["Legal minimum", "Not supplied by Casevoya. Needs professional review."],
    [
      "Records kept until",
      input.closure ? longDay(input.closure.retentionOn) : years ? `Closure date + ${years} years` : "Set when the matter closes",
    ],
    ["Custodian", input.consultant ?? "The person who closes it"],
    ["Legal hold", input.holdSince ? `Active since ${dayMonth(input.holdSince.slice(0, 10))}` : check.legal_hold ? "Active" : "None"],
  ];
  return {
    status,
    items,
    retention,
    note:
      "Closing records the closure with this retention date. Open client funds or an unpaid invoice block it unless the firm owner records a reviewed reason. A legal hold blocks deleting this matter’s records. Reopening keeps this closure in the history.",
  };
}
