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

const SAVED_MARK = `<svg class="k2-mark" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="1.8"></circle><path d="M7.5 12.25 10.5 15.25 16.75 8.75" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"></path></svg>`;

/**
 * Records and retention (step 7 of 8) inside the real setup sheet, with the primary
 * footer button forced into the Saved flash (`is-ok` plus the check the kit draws).
 * Fixture only: nothing is saved.
 */
export function setupSavedButtonFixtureHtml(): string {
  let body = renderToStaticMarkup(createElement(SetupMarkup, { firmName: "Fixture Firm", trialBadge: "Free trial" }));
  body = body.replace('data-step="0" class="on"', 'data-step="0"');
  body = body.replace('data-step="6"', 'data-step="6" class="on"');
  const button =
    '<button class="btn p" data-next=""><span class="lab">Continue</span><span class="spin" aria-hidden="true"></span></button>';
  const saved = `<button class="btn p is-ok" id="saved" data-next=""><span class="lab">Continue</span><span class="spin" aria-hidden="true"><span class="sw-in" style="display:flex;gap:6px;align-items:center">${SAVED_MARK}Saved</span></span></button>`;
  if (!body.includes(button)) throw new Error("setup fixture is missing the primary footer button");
  body = body.replace(button, saved);
  const label =
    '<p data-fixture-label="">Fixture, not a live account. Step 7 of 8, Records and retention. Saved state forced on the primary footer button.</p>';
  body = body.replace('<footer class="wz-foot">', `${label}<footer class="wz-foot">`);
  const css = ["base.css", "kit2.css", "auth.css", "compat.css"]
    .map((name) => readFileSync(path.join(root, "src/styles/kit", name), "utf8"))
    .join("\n");
  const extra = `[data-fixture-label]{margin:0 0 10px;padding:8px 10px;background:#fff3bf;color:#3d2e00;font:600 13px/1.35 system-ui,sans-serif;border-radius:8px}
#states{position:absolute;left:-9999px;top:0;display:flex;gap:8px}`;
  const states = `<div id="states">
<button class="btn p" id="normal" type="button"><span class="lab">Continue</span></button>
<button class="btn p is-loading" id="saving" type="button" aria-busy="true"><span class="lab">Continue</span><span class="spin" aria-hidden="true"></span></button>
<button class="btn p is-fail" id="fail" type="button"><span class="lab">Continue</span><span class="spin" aria-hidden="true"><span class="sw-in">Retry</span></span></button>
<button class="btn p" id="disabled" type="button" aria-disabled="true">Continue</button>
</div>`;
  const script = `<script>
window.__readSaved = () => {
  const read = (id) => {
    const el = document.getElementById(id);
    const s = getComputedStyle(el);
    const mark = el.querySelector(".k2-mark, .sw-in");
    return { bg: s.backgroundColor, color: s.color, mark: mark ? getComputedStyle(mark).color : s.color, outline: s.outlineColor };
  };
  const saved = document.getElementById("saved");
  saved.scrollIntoView({ block: "end" });
  return {
    saved: read("saved"),
    normal: read("normal"),
    saving: read("saving"),
    fail: read("fail"),
    disabled: read("disabled"),
  };
};
</script>`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Fixture: setup Saved button</title><style>${css}\n${extra}</style></head><body>${body}${states}${script}</body></html>`;
}
