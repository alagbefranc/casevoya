/**
 * @vitest-environment happy-dom
 */
import { createElement } from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { QuoteEditDialog, type QuoteEditDialogData } from "@/components/sheet/designer/agreements-quote";
import { editQuoteTable } from "@/components/sheet/quote-table";

const DATA: QuoteEditDialogData = {
  organizationId: "33333333-3333-4333-8333-333333333333",
  agreementId: "44444444-4444-4444-8444-444444444444",
  currency: "CAD",
  fields: {
    scope: "Prepare one application",
    services: "Eligibility review",
    exclusions: "Appeals",
    deliverables: "Submission package",
    feeStructure: "Milestones",
    refund: "",
    expiry: "2026-11-18",
    government: "",
  },
  today: "2026-11-11",
  lines: [{ category: "professional_fee", description: "", amount: "", taxRate: "", sourceNote: "" }],
  instalments: [],
  revises: false,
  sample: false,
};

describe("Edit quote add buttons", () => {
  let root: Root | null = null;
  let host: HTMLDivElement | null = null;

  afterEach(() => {
    act(() => root?.unmount());
    host?.remove();
    root = null;
    host = null;
  });

  it("adds a fee line and an instalment from the same click path the Sheet uses", () => {
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    act(() => {
      root?.render(createElement(QuoteEditDialog, { data: DATA }));
    });
    // use-sheet listens on the page root and calls editQuoteTable before anything else.
    host.addEventListener("click", (event) => {
      if (editQuoteTable(event.target as HTMLElement)) event.preventDefault();
    });

    const lines = () => host?.querySelectorAll("#qeLines tbody tr[data-quote-line]").length ?? 0;
    const instalments = () => host?.querySelectorAll("#qeInst tbody tr[data-quote-instalment]").length ?? 0;
    expect(lines()).toBe(1);
    expect(instalments()).toBe(0);

    const lineTemplate = host.querySelector<HTMLTemplateElement>("#qeLineRow");
    const instalmentTemplate = host.querySelector<HTMLTemplateElement>("#qeInstRow");
    expect(lineTemplate?.content.querySelector("tr[data-quote-line]")).not.toBeNull();
    expect(instalmentTemplate?.content.querySelector("tr[data-quote-instalment]")).not.toBeNull();

    host.querySelector<HTMLButtonElement>("[data-quote-add='qeLines']")?.click();
    host.querySelector<HTMLButtonElement>("[data-quote-add='qeInst']")?.click();
    expect(lines()).toBe(2);
    expect(instalments()).toBe(1);

    const amount = host.querySelector<HTMLInputElement>("#qeLines tbody tr:last-child [data-field='amount']");
    const when = host.querySelector<HTMLInputElement>("#qeInst tbody [data-field='label']");
    const paid = host.querySelector<HTMLInputElement>("#qeInst tbody [data-field='amount']");
    expect(amount).not.toBeNull();
    expect(when).not.toBeNull();
    expect(paid).not.toBeNull();
    if (amount) amount.value = "1,600.00";
    if (when) when.value = "On signing";
    if (paid) paid.value = "1,600.00";
    expect(amount?.value).toBe("1,600.00");
    expect(paid?.value).toBe("1,600.00");

    host.querySelector<HTMLButtonElement>("#qeLines [data-quote-remove]")?.click();
    expect(lines()).toBe(1);
  });
});
