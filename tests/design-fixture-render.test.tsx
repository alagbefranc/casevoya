import { createElement } from "react";
import { writeFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { PAY_CSS } from "@/components/portal/pay-css";
import { SAMPLE_CASE_CSS } from "@/components/sheet/designer/sample-case-css";
import { GoLiveSteps } from "@/components/sheet/designer/sample-case";
import { Icon } from "@/components/sheet/designer/frame";
import { SheetHome, type HomeData } from "@/components/sheet/designer/home";
import { SheetSidebar, type SidebarData } from "@/components/sheet/designer/sidebar";

const sidebarData: SidebarData = {
  active: "/sheet",
  counts: { notifications: 2, drafts: 3, tasks: 4, inbox: 1, finance: 1, pipeline: 2, sourcesReview: 1 },
  pinned: [{ name: "Synthetic client", href: "/sheet/matters/synthetic" }],
  me: { name: "Fixture Reviewer", role: "Synthetic role" },
  tiles: { documents: "/sheet/documents", invoices: "/sheet/finance" },
  newMatter: { href: "#", toast: "Synthetic" },
  createBoard: { href: "#", toast: "Synthetic" },
};

const homeData: HomeData = {
  greeting: "Synthetic fixture",
  summary: "Rendered components only. This is not a signed-in session and not a user journey.",
  quick: { lead: "#", document: "#", consultation: "#", invoice: "#", draft: "#" },
  gauge: [
    { label: "Accepted", count: 2, color: "#205c38" },
    { label: "In review", count: 1, color: "#0075DE" },
  ],
  needs: [],
  byDeadline: [],
  tasks: [],
};

const home = renderToStaticMarkup(createElement(SheetHome, { data: homeData }));
const sidebar = renderToStaticMarkup(createElement(SheetSidebar, { data: sidebarData }));
const steps = renderToStaticMarkup(
  createElement(GoLiveSteps, {
    data: { licence: { added: false, blocked: false, status: null }, trialEnded: false, remaining: ["Synthetic licence step"], owner: true },
  }),
);
const followUp = renderToStaticMarkup(
  createElement("button", { className: "btn p sm", type: "button", id: "follow-up" }, createElement(Icon, { name: "sparkles", cls: "ic s" }), "Draft follow-up with Vo"),
);
const panel = renderToStaticMarkup(
  createElement(
    "section",
    { className: "panel", id: "vo-panel" },
    createElement("h2", null, createElement(Icon, { name: "sparkles" }), "Follow-up with Vo"),
    createElement("p", null, "Synthetic panel. The heading words stay when the sparkle is hidden."),
  ),
);
const fileCard = `<article class="fcard" id="file-card"><div class="th"><svg class="ic l" aria-hidden="true"><use href="/assets/icons-coreui/sprite.svg#i-file"></use></svg></div><div><h4>Passport, bio page</h4><div class="meta"><span>Identity</span><span>Synthetic</span></div></div><div class="states"><span class="bd ok"><i></i>Accepted</span></div></article>`;
const pipeline = `<article class="lc" id="lead-card"><i class="lbar" style="background:#0075DE"></i><div class="lt"><b>Synthetic lead</b></div><div class="lm">Work permit</div><button class="aichip" type="button" id="ai-chip"><svg class="ic s" aria-hidden="true"><use href="/assets/icons-coreui/sprite.svg#i-sparkles"></use></svg>Draft: intake note</button></article>`;
const trial = `<button class="opt" type="button" id="sample-opt" role="radio" aria-checked="true"><span class="oi"><svg class="ic" aria-hidden="true"><use href="/assets/icons-coreui/sprite.svg#i-sparkles"></use></svg></span><span>Explore with sample data<small>A fictional firm with one sponsorship case.</small></span></button>`;
const pay = `<div class="pay-stage" id="pay-stage"><p class="pay-behind">Synthetic page colour behind the payment bar</p><div class="paybar" role="region" aria-label="Pay"><div><b class="num">CAD 1,130.00</b><small>to Synthetic Immigration</small></div><button class="btn p" type="button" id="pay-button"><span class="lab">Pay</span></button></div></div>`;

const fixtureCss = `
body{margin:0;background:#F6F5F4;color:#111}
.banner{padding:16px 20px;background:#111;color:#fff;font:600 14px/1.4 system-ui,sans-serif}
.banner small{display:block;font-weight:400;color:#d9d6d2;margin-top:4px}
.layout{display:grid;grid-template-columns:280px 1fr;min-height:100vh}
.main{padding:20px;display:grid;gap:18px;align-content:start}
.shell-sheet{min-height:100vh}
.pay-stage{position:relative;height:150px;border-radius:12px;overflow:hidden;background:repeating-linear-gradient(45deg,#0075DE 0 14px,#F6F5F4 14px 28px)}
.pay-behind{margin:0;padding:16px;color:#fff;font-weight:600;text-shadow:0 1px 2px #111}
.fixture-pay .paybar{position:absolute;left:0;right:0;bottom:0}
.opt{max-width:460px}
.smp{max-width:720px}
h3.lab{font:600 13px/1.3 system-ui,sans-serif;margin:0 0 8px;color:#615d59}
@media(max-width:700px){.layout{grid-template-columns:1fr}.side{height:auto;position:relative}}
body.before svg:has(> use[href*="#i-sparkles"]){display:inline-block}
body.before .opt .oi:has(use[href*="#i-sparkles"]){display:grid}
body.before .tile:has(use[href*="#i-sparkles"])::before{content:none}
body.before .qa:hover{transform:translateY(-1px)}
body.before .fcard:hover{transform:translateY(-1px)}
body.before .lc:hover{transform:translateY(-2px);box-shadow:0 6px 18px rgba(17,17,17,.08);background:#fff}
body.before .tile:hover{transform:translateY(-2px) scale(1.06);box-shadow:none}
body.before .smp-i:hover{transform:translateY(-1px)}
body.before .paybar{background:rgba(255,255,255,.92);-webkit-backdrop-filter:blur(12px);backdrop-filter:blur(12px)}
`;

function page(before: boolean): string {
  const mark = before ? "BEFORE the correction" : "AFTER the correction";
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Synthetic fixture ${mark}</title>
<link rel="stylesheet" href="/src/styles/kit/base.css">
<link rel="stylesheet" href="/src/styles/kit/kit2.css">
<link rel="stylesheet" href="/src/styles/kit/pipeline.css">
<link rel="stylesheet" href="/src/styles/kit/shell.css">
<link rel="stylesheet" href="/src/styles/kit/auth.css">
<link rel="stylesheet" href="/src/styles/kit/typography.css">
<style>${SAMPLE_CASE_CSS}${PAY_CSS}${fixtureCss}</style></head>
<body class="${before ? "before fixture-pay" : "fixture-pay"}">
<p class="banner">SYNTHETIC FIXTURE — ${mark}. Components rendered locally from the source. Not a signed-in session. Not a user journey. Not production.<small>Sheet sidebar, home quick actions, file card, pipeline card, sample-case row, trial option, and payment bar.</small></p>
<div class="layout"><div class="shell-sheet">${sidebar}</div><main class="main">
<section id="pay">${pay}</section>
<section><h3 class="lab">Home quick actions from SheetHome</h3>${home}</section>
<section><h3 class="lab">File card and pipeline card</h3>${fileCard}${pipeline}</section>
<section class="smp"><h3 class="lab">Sample-case row from GoLiveSteps</h3>${steps}</section>
<section><h3 class="lab">Trial sample option and Vo controls</h3>${trial}<div style="height:10px"></div>${followUp}<div style="height:10px"></div>${panel}</section>
</main></div></body></html>`;
}

describe("synthetic fixture markup from the real components", () => {
  it("keeps accessible names on sparkle controls", () => {
    expect(sidebar).toContain('aria-label="Vo drafts"');
    expect(sidebar).toContain(">Vo drafts<");
    expect(sidebar).toContain(">Vo and AI<");
    expect(home).toContain("Ask Vo for a draft");
    expect(followUp).toContain("Draft follow-up with Vo");
    expect(panel).toContain("Follow-up with Vo");
    expect(trial).toContain("Explore with sample data");
    expect(pay).toContain('aria-label="Pay"');
    expect(PAY_CSS).not.toContain("backdrop-filter");
  });

  it("writes the local preview pages when WRITE_FIXTURE=1", () => {
    if (process.env.WRITE_FIXTURE !== "1") return;
    writeFileSync("/tmp/cv-harness/before.html", page(true));
    writeFileSync("/tmp/cv-harness/after.html", page(false));
  });
});
