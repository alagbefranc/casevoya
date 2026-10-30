import { sheetStateCopy } from "@/modules/sheet/present";
import { escapeHtml } from "@/lib/html";

const ASSET = "/assets/icons-coreui/sprite.svg";

export function icon(name: string, cls = ""): string {
  return `<svg class="ic ${cls}" aria-hidden="true"><use href="${ASSET}#i-${name}"/></svg>`;
}

export function art(name: string, px: number) {
  return `<span class="art" style="--a:${px}px" aria-hidden="true"><img src="/assets/generated/b2/${name}-160@1x.webp" srcset="/assets/generated/b2/${name}-160@2x.webp 2x" width="${px}" height="${px}" alt="" loading="lazy" decoding="async"></span>`;
}

/** The Designer's `?state=` preview (loading, empty, error, denied, offline): demo screens only. */
export function applyUrlState(root: HTMLElement, page: string, search: string) {
  if (!root.querySelector(".statusbar .demo")) return;
  const state = new URLSearchParams(search).get("state");
  if (state) applyState(root, page, state);
}

/** Replaces #content with a state; the page heading (a client or matter name) is set as text. */
function applyState(root: HTMLElement, page: string, state: string) {
  const content = root.querySelector("#content");
  if (!content) return;
  const copy = sheetStateCopy(page).map(escapeHtml) as ReturnType<typeof sheetStateCopy>;
  const heading = content.querySelector("h1")?.textContent || "This screen";
  const withHeading = (rest: string) => {
    content.innerHTML = `<div class="ph"><h1 class="display"></h1></div>${rest}`;
    const h1 = content.querySelector("h1");
    if (h1) h1.textContent = heading;
  };
  if (state === "loading") {
    content.innerHTML = `<div class="fp-st" role="status"><span class="sr">Loading ${copy[4]}…</span><div class="sk h"></div><div class="sk" style="width:60%"></div>${'<div class="sk r"></div>'.repeat(4)}</div>`;
    return;
  }
  if (state === "empty") {
    withHeading(`<div class="panel"><div class="emp">${art(copy[0], 88)}<b>${copy[1]}</b><small>${copy[2]}</small></div></div>`);
    return;
  }
  if (state === "error") {
    withHeading(`<div class="alert bad" role="alert">${icon("alert")}<div><b>We couldn’t load ${copy[4]}</b>The server didn’t answer in time. Nothing was lost.</div></div>`);
    return;
  }
  if (state === "denied") {
    withHeading(`<div class="panel"><div class="emp">${art("privacy-shield", 88)}<b>You don’t have permission to see ${copy[4]}</b><small>Your role doesn’t include this. Ask your firm owner if you need access.</small></div></div>`);
    return;
  }
  if (state === "offline") {
    content.insertAdjacentHTML("afterbegin", `<div class="alert warn" role="status">${icon("wifi-off")}<div><b>You’re offline</b>Showing ${copy[4]} from this device. Changes wait until you reconnect.</div></div>`);
  }
}
