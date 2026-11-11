import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { chromium, type Browser, type Page } from "playwright";
import { QuoteEditDialog, type QuoteEditDialogData } from "@/components/sheet/designer/agreements-quote";
import { editQuoteTable } from "@/components/sheet/quote-table";

const DATA: QuoteEditDialogData = {
  organizationId: "33333333-3333-4333-8333-333333333333",
  agreementId: "44444444-4444-4444-8444-444444444444",
  currency: "CAD",
  fields: {
    scope: "Prepare and submit one family-class application",
    services: "Eligibility review\nForms",
    exclusions: "Appeals",
    deliverables: "Submission package",
    feeStructure: "Milestones",
    refund: "Unearned advances are refunded.",
    expiry: "2026-11-18",
    government: "Paid by the client to IRCC.",
  },
  today: "2026-11-11",
  lines: [{ category: "professional_fee", description: "Milestone 1", amount: "", taxRate: "", sourceNote: "" }],
  instalments: [],
  revises: false,
  sample: false,
};

const CSS = ["base", "kit2", "fp", "shell", "compat", "typography"]
  .map((name) => readFileSync(new URL(`../src/styles/kit/${name}.css`, import.meta.url), "utf8"))
  .join("\n");

function pageHtml(): string {
  const dialog = renderToStaticMarkup(createElement(QuoteEditDialog, { data: DATA }));
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><style>${CSS}
*{animation:none!important;transition:none!important}</style></head><body>
<div id="root">${dialog}</div>
<script>
const editQuoteTable = ${editQuoteTable.toString()};
document.getElementById("root").addEventListener("click", (event) => {
  if (editQuoteTable(event.target)) event.preventDefault();
});
document.getElementById("dlgQEdit").showModal();
</script></body></html>`;
}

async function openDialog(browser: Browser, width: number, height: number, touch: boolean): Promise<Page> {
  const context = await browser.newContext({ viewport: { width, height }, hasTouch: touch, isMobile: touch, deviceScaleFactor: 1 });
  const page = await context.newPage();
  await page.setContent(pageHtml(), { waitUntil: "load" });
  const inner = await page.evaluate(() => window.innerWidth);
  if (inner !== width) throw new Error(`viewport is ${inner}, expected ${width}`);
  await page.evaluate(() => {
    const db = document.querySelector<HTMLElement>("#dlgQEdit .db");
    const fees = [...document.querySelectorAll("label")].find((el) => el.textContent?.startsWith("Fees, by category"));
    if (db && fees) db.scrollTop = fees.getBoundingClientRect().top - db.getBoundingClientRect().top + db.scrollTop;
  });
  return page;
}

describe("Edit quote on a phone", () => {
  let browser: Browser;

  beforeAll(async () => {
    browser = await chromium.launch({ args: ["--no-sandbox", "--disable-dev-shm-usage"] });
  });

  afterAll(async () => {
    await browser?.close();
  });

  it("keeps the desktop fee row as one table row that can show 1,600.00", async () => {
    const page = await openDialog(browser, 1280, 800, false);
    const row = await page.evaluate(() => {
      const cells = [...document.querySelectorAll<HTMLElement>("#qeLines tbody tr td")].slice(0, 5);
      const tops = cells.map((cell) => cell.getBoundingClientRect().top);
      const amount = document.querySelector<HTMLInputElement>("#qeLines [data-field='amount']");
      const description = document.querySelector<HTMLInputElement>("#qeLines [data-field='description']");
      const tax = document.querySelector<HTMLInputElement>("#qeLines [data-field='taxRate']");
      const source = document.querySelector<HTMLInputElement>("#qeLines [data-field='sourceNote']");
      const frame = document.querySelector("#qeLines")?.closest(".tw")?.getBoundingClientRect();
      if (amount) amount.value = "1,600.00";
      const inside = (el: HTMLElement | null) => {
        const box = el?.getBoundingClientRect();
        return Boolean(frame && box && box.left >= frame.left - 1 && box.right <= frame.right + 1);
      };
      return {
        spread: Math.max(...tops) - Math.min(...tops),
        client: amount?.clientWidth ?? 0,
        scroll: amount?.scrollWidth ?? 0,
        descriptionClient: description?.clientWidth ?? 0,
        descriptionScroll: description?.scrollWidth ?? 0,
        taxVisible: inside(tax),
        sourceVisible: inside(source),
        removeFits: (() => {
          const button = document.querySelector<HTMLButtonElement>("#qeLines [data-quote-remove]");
          return Boolean(button && button.scrollWidth <= button.clientWidth + 1);
        })(),
      };
    });
    if (process.env.QUOTE_EDIT_DESKTOP) await page.screenshot({ path: process.env.QUOTE_EDIT_DESKTOP });
    expect(row.spread).toBeLessThan(8);
    expect(row.client).toBeGreaterThanOrEqual(row.scroll);
    expect(row.descriptionClient).toBeGreaterThanOrEqual(row.descriptionScroll);
    expect(row.taxVisible).toBe(true);
    expect(row.sourceVisible).toBe(true);
    expect(row.removeFits).toBe(true);
    await page.close();
  });

  it("shows a full amount and adds a line and an instalment when tapped at 390px", async () => {
    const page = await openDialog(browser, 390, 844, true);
    const amount = page.locator("#qeLines [data-field='amount']");
    await amount.tap();
    await amount.fill("1,600.00");
    const fee = await amount.evaluate((el) => ({ client: el.clientWidth, scroll: el.scrollWidth, width: el.getBoundingClientRect().width }));
    const category = await page.locator("#qeLines [data-field='category']").evaluate((el) => el.getBoundingClientRect().width);

    await page.locator("[data-quote-add='qeLines']").tap();
    await page.locator("[data-quote-add='qeInst']").tap();
    const counts = await page.evaluate(() => ({
      lines: document.querySelectorAll("#qeLines tbody tr").length,
      instalments: document.querySelectorAll("#qeInst tbody tr").length,
    }));
    const instalment = page.locator("#qeInst [data-field='amount']");
    await instalment.tap();
    await instalment.fill("1,600.00");
    const paid = await instalment.evaluate((el) => ({ client: el.clientWidth, scroll: el.scrollWidth }));

    // The phone sheet is ~390px. A usable amount field shows 1,600.00 without clipping.
    expect(category).toBeGreaterThan(160);
    expect(fee.client).toBeGreaterThanOrEqual(fee.scroll);
    expect(fee.width).toBeGreaterThan(160);
    expect(counts).toEqual({ lines: 2, instalments: 1 });
    expect(paid.client).toBeGreaterThanOrEqual(paid.scroll);
    const add = await page.locator("[data-quote-add='qeLines']").evaluate((el) => el.getBoundingClientRect().height);
    expect(add).toBeGreaterThanOrEqual(44);
    const overflow = await page.evaluate(() => ({ inner: window.innerWidth, scroll: document.documentElement.scrollWidth }));
    expect(overflow.scroll).toBeLessThanOrEqual(overflow.inner + 1);
    const shot = process.env.QUOTE_EDIT_SHOT;
    if (shot) {
      await page.evaluate(() => {
        const db = document.querySelector<HTMLElement>("#dlgQEdit .db");
        const fees = [...document.querySelectorAll("label")].find((el) => el.textContent?.startsWith("Fees, by category"));
        if (db && fees) db.scrollTop = fees.getBoundingClientRect().top - db.getBoundingClientRect().top + db.scrollTop;
      });
      await page.screenshot({ path: shot });
    }
    await page.close();
  });
});
