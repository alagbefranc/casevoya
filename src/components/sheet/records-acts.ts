"use client";

/**
 * Records pages' small client wiring that the shared filter code does not cover.
 *
 * Inbox > Conversations: the Designer's search box and chips (All, Portal, Email, WhatsApp)
 * narrow the conversation list (`#cvL > a.li`, `data-f` channel tokens and text); the hidden
 * "Nothing matches" line shows when none is left.
 */

const CHANNEL_TOKEN: Record<string, string> = { Portal: "portal", Email: "email", WhatsApp: "whatsapp" };

/** Which conversation rows stay visible for a search and a chip. Pure, so it is tested. */
export function conversationHidden(rows: { text: string; flags: string }[], query: string, chip: string): boolean[] {
  const q = query.trim().toLowerCase();
  const token = CHANNEL_TOKEN[chip.trim()] ?? "";
  return rows.map((row) => (Boolean(q) && !row.text.toLowerCase().includes(q)) || (Boolean(token) && !row.flags.split(" ").includes(token)));
}

export function mountInboxFilters(root: HTMLElement, signal: AbortSignal) {
  const list = root.querySelector<HTMLElement>("#cvL");
  const bar = root.querySelector<HTMLElement>("#content > .fp-bar");
  if (!list || !bar) return;
  const input = bar.querySelector<HTMLInputElement>("input");
  const apply = () => {
    const rows = [...list.querySelectorAll<HTMLElement>(":scope > a.li")];
    const chip = bar.querySelector(".fchip.on")?.textContent ?? "All";
    const hidden = conversationHidden(
      rows.map((row) => ({ text: row.textContent ?? "", flags: row.dataset.f ?? "" })),
      input?.value ?? "",
      chip,
    );
    rows.forEach((row, index) => {
      row.hidden = hidden[index];
      // `.li` sets its own display, which outranks the hidden attribute.
      row.style.display = hidden[index] ? "none" : "";
    });
    const none = rows.length > 0 && hidden.every(Boolean);
    list.querySelector<HTMLElement>(":scope > .fp-fe")?.toggleAttribute("hidden", !none);
  };
  bar.addEventListener(
    "click",
    (event) => {
      const chip = (event.target as HTMLElement).closest<HTMLElement>(".fchip");
      if (!chip || !bar.contains(chip)) return;
      event.preventDefault();
      bar.querySelectorAll<HTMLElement>(".fchip").forEach((item) => {
        item.classList.toggle("on", item === chip);
        item.setAttribute("aria-pressed", String(item === chip));
      });
      apply();
    },
    { signal },
  );
  input?.addEventListener("input", apply, { signal });
  apply();
}

/** Documents > All documents: an accepted card opens its file on click, Enter or Space. */
export function mountDocOpen(root: HTMLElement, run: (card: HTMLElement) => Promise<void>, signal: AbortSignal) {
  const go = (card: HTMLElement) => {
    if (card.getAttribute("aria-busy") === "true") return;
    card.setAttribute("aria-busy", "true");
    void run(card).finally(() => card.removeAttribute("aria-busy"));
  };
  root.addEventListener(
    "click",
    (event) => {
      const card = (event.target as HTMLElement).closest<HTMLElement>("[data-doc-open]");
      // DOC-06: the card's Details button opens its dialog, not the file.
      if (!card || !root.contains(card) || (event.target as HTMLElement).closest("[data-doc-details], [data-redact]")) return;
      event.preventDefault();
      go(card);
    },
    { signal },
  );
  root.addEventListener(
    "keydown",
    (event) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      const card = (event.target as HTMLElement).closest<HTMLElement>("[data-doc-open]");
      if (!card || event.target !== card) return;
      event.preventDefault();
      go(card);
    },
    { signal },
  );
}

/** How often, and for how long, the Vo drafts page looks again while Vo is drafting. */
const DRAFTING_POLL_MS = 5000;
const DRAFTING_POLL_LIMIT = 24;

/**
 * Vo drafts: a draft's "Checked N sources" line opens and closes its list of sources (the
 * Designer's timeline), and while Vo is drafting ("Vo is drafting" under the heading) the page
 * looks again every few seconds, so the line clears when the draft is ready instead of staying.
 */
export function mountDrafts(root: HTMLElement, refresh: () => void, signal: AbortSignal) {
  root.addEventListener(
    "click",
    (event) => {
      const head = (event.target as HTMLElement).closest<HTMLButtonElement>(".k2-tl-h");
      if (!head || !root.contains(head) || head.disabled) return;
      const timeline = head.closest<HTMLElement>(".k2-tl");
      if (!timeline?.classList.contains("is-done")) return;
      event.preventDefault();
      const shut = timeline.classList.toggle("shut");
      head.setAttribute("aria-expanded", String(!shut));
    },
    { signal },
  );
  if (!root.querySelector("#ll")) return;
  let polls = 0;
  const timer = window.setInterval(() => {
    polls += 1;
    if (polls > DRAFTING_POLL_LIMIT || !root.querySelector("#ll")) {
      window.clearInterval(timer);
      return;
    }
    refresh();
  }, DRAFTING_POLL_MS);
  signal.addEventListener("abort", () => window.clearInterval(timer));
}

/** The sidebar group a top-bar crumb names ("Records" is the Records group), or null. */
export function crumbGroup(root: HTMLElement, crumb: HTMLElement): HTMLElement | null {
  const label = crumb.textContent?.trim() ?? "";
  return [...root.querySelectorAll<HTMLElement>(".side .grp")].find((group) => group.querySelector(":scope > button span")?.textContent?.trim() === label) ?? null;
}

/** Pages whose top bar's first crumb (with the Designer's dropdown mark) opens a place switcher. */
export const RECORDS_PAGES = new Set(["inbox", "documents", "agreements", "finance", "notifications", "drafts"]);

export function mountRecordsCrumb(root: HTMLElement, page: string, open: (group: HTMLElement | null) => void, signal: AbortSignal) {
  if (!RECORDS_PAGES.has(page)) return;
  const crumb = root.querySelector<HTMLElement>("header.top > button.crumb");
  if (!crumb?.querySelector(".ic.dd")) return;
  crumb.setAttribute("aria-haspopup", "dialog");
  crumb.addEventListener(
    "click",
    (event) => {
      event.preventDefault();
      open(crumbGroup(root, crumb));
    },
    { signal },
  );
}
