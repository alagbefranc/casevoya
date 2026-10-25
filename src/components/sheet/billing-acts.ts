"use client";

import { toast2 } from "@/components/port/kit";
import {
  addGovernmentFee,
  addTaxRate,
  cancelInstalmentPlan,
  createInstalmentPlan,
  createQuoteInvoice,
  createTimeInvoice,
  discardDraft,
  discardTime,
  endTaxRate,
  fetchFeeList,
  invoiceInstalment,
  issueDraft,
  logTime,
  removeLine,
  reviewFeeList,
  startTimer,
  stopTimer,
  writeOff,
} from "@/modules/billing/actions";
import { readWriteOff } from "@/modules/billing/present";
import { financeNeedsStepUp, financeStepUpLocation } from "@/modules/sheet/finance-present";

/**
 * FIN-06 billing on the matter's Billing tab and the Finance page. `data-billing-open` fills a
 * dialog's submit button from the opener's `data-b-*` attributes and opens it; `data-billing-act`
 * runs one action through the server actions in modules/billing/actions. A refusal that needs a
 * step-up sends the person to confirm and back to this page.
 */

type Router = { refresh: () => void; replace: (href: string) => void };
type Open = (id: string) => void;

function value(root: ParentNode, id: string): string {
  return root.querySelector<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>(`#${id}`)?.value ?? "";
}

function checked(root: ParentNode, id: string): boolean {
  return root.querySelector<HTMLInputElement>(`#${id}`)?.checked ?? false;
}

/** One key per dialog opening: a double click or a retry makes one draft or one write-off. */
function keyFor(button: HTMLElement, prefix: string): string {
  if (!button.dataset.key) button.dataset.key = `${prefix}-${crypto.randomUUID()}`;
  return button.dataset.key;
}

/** Copies the opener's `data-b-*` values onto the dialog's submit buttons, then opens it. */
export function openBillingDialog(opener: HTMLElement, root: ParentNode, open: Open) {
  const id = opener.dataset.billingOpen ?? "";
  const dialog = root.querySelector<HTMLDialogElement>(`dialog#${CSS.escape(id)}`);
  if (!dialog) return;
  for (const button of dialog.querySelectorAll<HTMLElement>("[data-billing-act]")) {
    delete button.dataset.key;
    for (const [key, data] of Object.entries(opener.dataset)) {
      if (key.length > 1 && key[0] === "b" && key[1] === key[1].toUpperCase()) button.dataset[key[1].toLowerCase() + key.slice(2)] = data ?? "";
    }
  }
  open(id);
}

function finish(button: HTMLElement, router: Router, title: string, sub: string, go?: string) {
  const dialog = button.closest("dialog");
  for (const keyed of dialog?.querySelectorAll<HTMLElement>("[data-key]") ?? []) delete keyed.dataset.key;
  dialog?.close();
  toast2(title, { kind: "ok", sub });
  if (go) router.replace(go);
  router.refresh();
}

function refuse(error: string, sub: string) {
  if (financeNeedsStepUp(error)) {
    window.location.assign(financeStepUpLocation(window.location.pathname, window.location.search, null, "billing"));
    return;
  }
  toast2(error, { kind: "bad", sub });
}

const invoiceTab = (id: string) => `/sheet/finance?tab=invoice&view=${encodeURIComponent(id)}`;

export async function runBillingAct(button: HTMLElement, router: Router): Promise<void> {
  const act = button.dataset.billingAct ?? "";
  const org = button.dataset.org ?? "";
  const scope: ParentNode = button.closest("dialog") ?? document;
  switch (act) {
    case "time-log": {
      const result = await logTime({
        organizationId: org,
        today: button.dataset.today ?? "",
        matter: button.dataset.matter ?? "",
        date: value(scope, "tmD"),
        minutes: value(scope, "tmM"),
        rate: value(scope, "tmR"),
        description: value(scope, "tmW"),
        billable: checked(scope, "tmB"),
      });
      if ("error" in result) return refuse(result.error, "Nothing was logged.");
      return finish(button, router, "Time logged", "It shows on this matter’s Billing tab. Billable time can be pulled into a draft invoice.");
    }
    case "timer-start": {
      const result = await startTimer({ organizationId: org, matter: button.dataset.matter ?? "", rate: value(scope, "tmR"), description: value(scope, "tmW"), billable: checked(scope, "tmB") });
      if ("error" in result) return refuse(result.error, "No timer was started.");
      return finish(button, router, "Timer started", "Stop it from its row on this tab.");
    }
    case "timer-stop": {
      const result = await stopTimer({ organizationId: org, entryId: button.dataset.entry ?? "" });
      if ("error" in result) return refuse(result.error, "The timer is still running.");
      return finish(button, router, "Timer stopped", `${result.minutes} ${result.minutes === 1 ? "minute" : "minutes"} recorded.`);
    }
    case "time-discard": {
      const result = await discardTime({ organizationId: org, entryId: button.dataset.entry ?? "" });
      if ("error" in result) return refuse(result.error, "Nothing changed.");
      return finish(button, router, "Time discarded", "It stays on record and won’t be invoiced.");
    }
    case "time-invoice": {
      const result = await createTimeInvoice({
        organizationId: org,
        matterId: button.dataset.matter ?? "",
        due: value(scope, "tivDue"),
        tax: value(scope, "tivTax"),
        idempotencyKey: keyFor(button, "time"),
      });
      if ("error" in result) return refuse(result.error, "No draft was made.");
      return finish(button, router, "Draft invoice made", "Check it, then issue it. The client sees nothing until then.", invoiceTab(result.id));
    }
    case "quote-invoice": {
      const result = await createQuoteInvoice({
        organizationId: org,
        agreementId: button.dataset.agreement ?? "",
        due: value(scope, "qivDue"),
        tax: value(scope, "qivTax"),
        idempotencyKey: keyFor(button, "quote"),
      });
      if ("error" in result) return refuse(result.error, "No draft was made.");
      return finish(button, router, "Draft invoice made from the quote", "Add any government fee with its source, then issue it.", invoiceTab(result.id));
    }
    case "plan-create": {
      const count = Number(button.dataset.count ?? "0");
      const dates = Array.from({ length: count }, (_, index) => scope.querySelector<HTMLInputElement>(`[data-plan-date="${index}"]`)?.value ?? "");
      if (dates.some((date) => !date)) return void toast2("Give a due date for each instalment.", { kind: "warn", sub: "No plan was set up." });
      const result = await createInstalmentPlan({ organizationId: org, agreementId: button.dataset.agreement ?? "", dates });
      if ("error" in result) return refuse(result.error, "No plan was set up.");
      return finish(button, router, "Instalments set up", "Each has a reminder task due on its date.");
    }
    case "instalment-invoice": {
      const result = await invoiceInstalment({
        organizationId: org,
        itemId: button.dataset.item ?? "",
        due: value(scope, "iivDue"),
        tax: value(scope, "iivTax"),
        idempotencyKey: keyFor(button, "inst"),
      });
      if ("error" in result) return refuse(result.error, "No draft was made.");
      return finish(button, router, "Draft invoice made for the instalment", "Check it, then issue it.", invoiceTab(result.id));
    }
    case "plan-cancel": {
      const result = await cancelInstalmentPlan({ organizationId: org, planId: button.dataset.plan ?? "", reason: value(scope, "pxW") });
      if ("error" in result) return refuse(result.error, "The plan is unchanged.");
      return finish(button, router, "Instalment plan cancelled", `${result.tasks} open reminder ${result.tasks === 1 ? "task" : "tasks"} cancelled.`);
    }
    case "issue": {
      const result = await issueDraft({ organizationId: org, invoiceId: button.dataset.invoice ?? "", due: "" });
      if ("error" in result) return refuse(result.error, "It’s still a draft.");
      return finish(button, router, `Invoice ${result.number} issued`, "It’s in the client’s portal now. Tax used the firm’s rate in effect today.");
    }
    case "discard": {
      const result = await discardDraft({ organizationId: org, invoiceId: button.dataset.invoice ?? "", reason: value(scope, "dcW") });
      if ("error" in result) return refuse(result.error, "The draft is unchanged.");
      return finish(button, router, "Draft discarded", "Its time and instalments can be invoiced again.");
    }
    case "gov-fee": {
      const result = await addGovernmentFee({
        organizationId: org,
        invoiceId: button.dataset.invoice ?? "",
        today: button.dataset.today ?? "",
        reference: value(scope, "gfP"),
        name: value(scope, "gfN"),
        amount: value(scope, "gfA"),
        url: value(scope, "gfU"),
        checked: value(scope, "gfC"),
      });
      if ("error" in result) return refuse(result.error, "No line was added.");
      return finish(button, router, "Government fee added", "It’s a disbursement line with its source.");
    }
    case "line-remove": {
      const result = await removeLine({ organizationId: org, lineId: button.dataset.line ?? "" });
      if ("error" in result) return refuse(result.error, "The draft is unchanged.");
      return finish(button, router, "Line removed", "Any time on it can be invoiced again.");
    }
    case "write-off": {
      const max = Number(button.dataset.max ?? "");
      const read = readWriteOff({ amount: value(scope, "woA"), reason: value(scope, "woR") }, Number.isSafeInteger(max) ? max : null);
      if ("error" in read) return void toast2(read.error, { kind: "warn", sub: "Nothing was written off." });
      const result = await writeOff({ organizationId: org, invoiceId: button.dataset.invoice ?? "", amount: value(scope, "woA"), reason: value(scope, "woR"), idempotencyKey: keyFor(button, "wo") });
      if ("error" in result) return refuse(result.error, "Nothing was written off.");
      return finish(button, router, "Written off", "The balance is lower. It’s recorded with your name and reason; no credit note was issued.");
    }
    case "tax-add": {
      const result = await addTaxRate({
        organizationId: org,
        name: value(scope, "txN"),
        rate: value(scope, "txR"),
        from: value(scope, "txF"),
        to: value(scope, "txT"),
        approvedBy: value(scope, "txA"),
        note: value(scope, "txS"),
      });
      if ("error" in result) return refuse(result.error, "No rate was added.");
      return finish(button, router, "Tax rate added", "Drafts issued on dates it covers use it.");
    }
    case "tax-end": {
      const result = await endTaxRate({ organizationId: org, rateId: button.dataset.rate ?? "", to: value(scope, "teT") });
      if ("error" in result) return refuse(result.error, "The rate is unchanged.");
      return finish(button, router, "Tax rate ended", "Add the new rate from the next day if it changed.");
    }
    case "fees-fetch": {
      const result = await fetchFeeList({ organizationId: org });
      if ("error" in result) return refuse(result.error, "Nothing was recorded.");
      return finish(
        button,
        router,
        result.rows ? `${result.rows} fees read from IRCC` : "IRCC’s fee list hasn’t changed",
        result.rows ? "A licensed member reviews them before staff can pick them." : "Nothing new was recorded.",
      );
    }
    case "fees-approve":
    case "fees-reject": {
      const result = await reviewFeeList({ organizationId: org, sha256: button.dataset.sha ?? "", decision: act === "fees-approve" ? "approved" : "rejected", note: value(scope, "frW") });
      if ("error" in result) return refuse(result.error, "Nothing changed.");
      return finish(button, router, act === "fees-approve" ? "Fee references approved" : "Fee list rejected", act === "fees-approve" ? "Staff can pick them as government fee lines." : "They can’t be picked.");
    }
    default:
      return;
  }
}
