import { readFileSync } from "node:fs";
import path from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { SetupMarkup } from "@/components/port/markup/setup";

const root = path.resolve(import.meta.dirname, "..");

/**
 * The sample-case step of firm setup, inside the real sheet (rail, main, sticky footer),
 * with the trial add-card row shown. Other steps stay in the markup and are hidden, the same
 * way the screen hides every step except the current one. The footer label is the one this
 * step sets (`data-cta`). This is a fixture, not a signed-in session.
 */
export function setupCardFixtureHtml(): string {
  let body = renderToStaticMarkup(
    createElement(SetupMarkup, {
      firmName: "Fixture Firm",
      trialBadge: "Free trial",
      card: { trialDays: 30 },
    }),
  );
  body = body.replace('data-step="0" class="on"', 'data-step="0"');
  body = body.replace('data-step="7"', 'data-step="7" class="on"');
  body = body.replace('<span class="lab">Continue</span>', '<span class="lab">Open my workspace</span>');
  const label =
    '<p data-fixture-label="">Fixture, not a live account. Sample-case step, trial add-card panel, shared setup sheet and footer.</p>';
  const marker = '<div class="conn" data-setup-card=""';
  if (!body.includes(marker)) throw new Error("setup fixture is missing the add-card row");
  body = body.replace(marker, `${label}${marker}`);
  const css = `${readFileSync(path.join(root, "src/styles/kit/base.css"), "utf8")}\n${readFileSync(path.join(root, "src/styles/kit/auth.css"), "utf8")}\n[data-fixture-label]{margin:0 0 10px;padding:8px 10px;background:#fff3bf;color:#3d2e00;font:600 13px/1.35 system-ui,sans-serif;border-radius:8px}`;
  const script = `<script>
const card = document.querySelector("[data-setup-card]");
const copy = card.querySelector(":scope > div");
const button = card.querySelector("a.btn");
const foot = document.querySelector(".wz-foot");
const alert = document.querySelector(".alert");
const overlaps = (a, b) => a.bottom > b.top + 1 && a.top < b.bottom - 1;
window.scrollTo(0, document.documentElement.scrollHeight);
const alertAtEnd = alert.getBoundingClientRect();
const footAtEnd = foot.getBoundingClientRect();
const alertVisible = Math.min(alertAtEnd.bottom, footAtEnd.top) - Math.max(alertAtEnd.top, 0);
window.scrollTo(0, Math.max(0, card.getBoundingClientRect().top + window.scrollY - 72));
const copyBox = copy.getBoundingClientRect();
const buttonBox = button.getBoundingClientRect();
const cardBox = card.getBoundingClientRect();
const footBox = foot.getBoundingClientRect();
const cardUnderFooter = overlaps(cardBox, footBox);
document.documentElement.dataset.measure = JSON.stringify({
  copyW: Math.round(copyBox.width),
  buttonW: Math.round(buttonBox.width),
  cardW: Math.round(cardBox.width),
  copyH: Math.round(copyBox.height),
  overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
  cardUnderFooter,
  alertVisibleAboveFooter: Math.round(alertVisible),
  alertH: Math.round(alertAtEnd.height),
});
</script>`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Fixture: setup sample-case add-card panel</title><style>${css}</style></head><body>${body}${script}</body></html>`;
}
