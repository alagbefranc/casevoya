"use client";

import { toast2 } from "@/components/port/kit";
import { openBillingPortal, startSubscriptionCheckout } from "@/modules/subscription/actions";
import { PLAN_DRAFT, subscriptionStepUpLocation } from "@/modules/subscription/errors";

/**
 * Settings > Subscription (firm owner): Choose a plan opens the live #dlgPlan dialog, whose total
 * the browser recomputes from the catalog on its data attributes; Continue to payment and Manage
 * billing ask the server, which asks the database (owner, step-up) and then Stripe, and send the
 * browser to Stripe's page. A step-up refusal keeps the choice and comes back with the dialog open.
 */
type Router = { refresh: () => void; replace: (href: string) => void };
type Open = (id: string) => void;

function dialogOf(root: ParentNode): HTMLDialogElement | null {
  return root.querySelector<HTMLDialogElement>("dialog#dlgPlan");
}

function chosen(dialog: HTMLDialogElement): { plan: string; interval: string; extraSeats: number } {
  const plan = dialog.querySelector<HTMLSelectElement>("#plS")?.value ?? "";
  const interval = dialog.querySelector<HTMLElement>('#plI button[aria-pressed="true"]')?.dataset.interval ?? "month";
  const seats = Number.parseInt(dialog.querySelector<HTMLInputElement>("#plX")?.value ?? "0", 10);
  return { plan, interval, extraSeats: Number.isInteger(seats) && seats >= 0 ? Math.min(500, seats) : 0 };
}

function moneyText(cents: number, currency: string, per: string): string {
  const whole = cents % 100 === 0;
  return `${currency} ${(cents / 100).toLocaleString("en-CA", { minimumFractionDigits: whole ? 0 : 2, maximumFractionDigits: 2 })}/${per}`;
}

/** The total line and the Continue button follow the choice; Enterprise has no checkout. */
function recompute(dialog: HTMLDialogElement) {
  const { plan, interval, extraSeats } = chosen(dialog);
  const option = dialog.querySelector<HTMLOptionElement>(`#plS option[value="${CSS.escape(plan)}"]`);
  const total = dialog.querySelector<HTMLElement>("#plT");
  const hint = dialog.querySelector<HTMLElement>("#plA");
  const button = dialog.querySelector<HTMLButtonElement>('[data-subscription-act="checkout"]');
  if (hint) hint.textContent = option?.dataset.allowances ?? "";
  const currency = dialog.dataset.currency ?? "CAD";
  const annualMonths = Number(dialog.dataset.annualMonths ?? "12");
  const seatMonthly = dialog.dataset.seatCents == null ? null : Number(dialog.dataset.seatCents);
  if (plan === "enterprise") {
    if (total) total.textContent = "arranged with Casevoya";
    if (button) {
      button.disabled = true;
      button.textContent = "Contact Casevoya";
    }
    return;
  }
  const base = option?.dataset[interval === "year" ? "year" : "month"];
  const seatCents = seatMonthly === null ? null : interval === "year" ? seatMonthly * annualMonths : seatMonthly;
  const priced = base != null && (extraSeats === 0 || seatCents !== null);
  if (total) total.textContent = priced ? moneyText(Number(base) + extraSeats * (seatCents ?? 0), currency, interval) : "no price set";
  if (button) {
    button.disabled = !priced;
    button.textContent = "Continue to payment";
  }
}

/** Mounts the dialog's controls; after a step-up the choice comes back once and the dialog reopens. */
export function mountSubscription(root: ParentNode, router: Router, open: Open) {
  const dialog = dialogOf(root);
  const params = new URLSearchParams(window.location.search);
  const checkout = params.get("checkout");
  if (checkout === "success") toast2("Thanks, your plan is being set up", { kind: "ok", sub: "Stripe confirms the payment to Casevoya in a moment; this page updates when it does." });
  else if (checkout === "cancelled") toast2("Checkout cancelled", { kind: "warn", sub: "Nothing was charged. Choose a plan whenever you’re ready." });
  if (checkout) {
    params.delete("checkout");
    const search = params.toString();
    router.replace(`${window.location.pathname}${search ? `?${search}` : ""}`);
  }
  if (!dialog) return;
  dialog.querySelectorAll<HTMLButtonElement>("#plI button[data-interval]").forEach((button) => {
    button.addEventListener("click", () => {
      dialog.querySelectorAll<HTMLButtonElement>("#plI button[data-interval]").forEach((other) => other.setAttribute("aria-pressed", other === button ? "true" : "false"));
      recompute(dialog);
    });
  });
  dialog.querySelector("#plS")?.addEventListener("change", () => recompute(dialog));
  dialog.querySelector("#plX")?.addEventListener("input", () => recompute(dialog));
  try {
    const draft = sessionStorage.getItem(PLAN_DRAFT);
    sessionStorage.removeItem(PLAN_DRAFT);
    if (draft) {
      const saved = JSON.parse(draft) as { plan?: string; interval?: string; extraSeats?: number };
      const select = dialog.querySelector<HTMLSelectElement>("#plS");
      if (select && typeof saved.plan === "string" && [...select.options].some((option) => option.value === saved.plan)) select.value = saved.plan;
      dialog.querySelectorAll<HTMLButtonElement>("#plI button[data-interval]").forEach((button) => button.setAttribute("aria-pressed", button.dataset.interval === saved.interval ? "true" : "false"));
      const seats = dialog.querySelector<HTMLInputElement>("#plX");
      if (seats && Number.isInteger(saved.extraSeats)) seats.value = String(saved.extraSeats);
    }
  } catch {
    // Storage can be unavailable; the owner chooses again.
  }
  recompute(dialog);
  if (params.get("dlg") === "plan") window.setTimeout(() => open("dlgPlan"), 300);
  dialog.addEventListener("close", () => {
    const search = new URLSearchParams(window.location.search);
    if (!search.has("dlg")) return;
    search.delete("dlg");
    const rest = search.toString();
    router.replace(`${window.location.pathname}${rest ? `?${rest}` : ""}`);
  });
}

function stepUp(draft: Record<string, unknown> | null) {
  try {
    if (draft) sessionStorage.setItem(PLAN_DRAFT, JSON.stringify(draft));
  } catch {
    // The owner chooses again after the step-up.
  }
  toast2("Confirm it’s you", { kind: "warn", sub: draft ? "Then the plan dialog opens again with what you chose." : "Then try again." });
  window.setTimeout(() => window.location.assign(subscriptionStepUpLocation(Boolean(draft))), 900);
}

/** Choose a plan, Continue to payment, Manage billing. */
export async function runSubscriptionAct(button: HTMLElement, open: Open) {
  const root = button.closest("#content") ?? document;
  const act = button.dataset.subscriptionAct;
  const organizationId = button.dataset.org ?? "";
  if (act === "plan") {
    open("dlgPlan");
    return;
  }
  // SEC-10: Cancel subscription opens its dialog (#dlgCancelSub); sec-acts sends it.
  if (act === "cancel") {
    open("dlgCancelSub");
    return;
  }
  if (act === "checkout") {
    const dialog = button.closest("dialog") as HTMLDialogElement | null;
    if (!dialog) return;
    const choice = chosen(dialog);
    const result = await startSubscriptionCheckout({ organizationId, ...choice });
    if ("error" in result) {
      if (result.stepUp) stepUp(choice);
      else toast2(result.error, { kind: "bad", sub: "Nothing was charged." });
      return;
    }
    toast2("Opening Stripe’s secure checkout", { kind: "ok" });
    window.location.assign(result.url);
    return;
  }
  if (act === "portal") {
    const result = await openBillingPortal({ organizationId });
    if ("error" in result) {
      if (result.stepUp) stepUp(null);
      else toast2(result.error, { kind: "bad", sub: "Nothing was changed." });
      return;
    }
    toast2("Opening your billing portal", { kind: "ok" });
    window.location.assign(result.url);
    return;
  }
  void root;
}
