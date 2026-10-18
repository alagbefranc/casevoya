"use client";

/**
 * The Lead pipeline's board behaviour and the lead page's actions.
 *
 * The board keeps the Designer's interaction model, built on the classes its stylesheet already
 * animates (`styles/kit/pipeline.css`): pick up a `.lc` card with the pointer and a `.ghost` copy
 * follows it while the card itself is `.lift`ed; the column under the pointer is `.over`; on drop
 * the card moves into that column at once (optimistic), the columns' counts, totals and rings
 * update, and the move is sent to `/api/leads/move`. If the firm refuses it (a converted or lost
 * column, a stale version, a role that cannot move leads) the card glides back to where it was
 * and shows the reason in an `.lflag` line. The ‹ › buttons do the same one column at a time.
 *
 * Every control is found by the data attributes the live components add; the Designer demo has
 * none of them, so nothing here runs on it.
 */
import { toast2 } from "@/components/port/kit";
import { LEAD_FIELDS, readLeadsCsv, type CsvLeadRow } from "@/modules/leads/csv";
import { cardFee, leadCount, ringOffset } from "@/modules/leads/present";

type Router = { push: (href: string) => void; replace: (href: string) => void; refresh: () => void };
type Result = { ok?: boolean; error?: string; version?: number | null; id?: string | null; reference?: string | null; imported?: number; skipped?: { row: number; reason: string }[] };

const DRAG_START_PX = 5;
const SETTLE_MS = 240;
const EASE = "cubic-bezier(.23,1,.32,1)";

async function post(action: string, body: Record<string, unknown>): Promise<Result & { status: number }> {
  try {
    const response = await fetch(`/api/leads/${action}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = (await response.json().catch(() => ({}))) as Result;
    return { ...data, status: response.status };
  } catch {
    return { error: "You’re offline or the server didn’t answer. Nothing was changed.", status: 0 };
  }
}

function reducedMotion(): boolean {
  return typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;
}

// ---------------------------------------------------------------------------
// Board
// ---------------------------------------------------------------------------

function cents(text: string): number {
  const match = text.replace(/,/g, "").match(/(\d+)(?:\.(\d{1,2}))?/);
  if (!match) return 0;
  return Number(match[1]) * 100 + Number((match[2] ?? "").padEnd(2, "0") || 0);
}

/** A column's header after cards moved: total, count and ring, as the server would render them. */
function syncColumn(column: HTMLElement) {
  const cardsEl = column.querySelector<HTMLElement>(".cards");
  if (!cardsEl) return;
  const cards = [...cardsEl.querySelectorAll<HTMLElement>(":scope > .lc")];
  let empty = cardsEl.querySelector<HTMLElement>(":scope > p.empty");
  if (cards.length && empty) empty.remove();
  if (!cards.length && !empty) {
    empty = document.createElement("p");
    empty.className = "empty";
    empty.textContent = "No leads here yet.";
    cardsEl.append(empty);
  }
  const total = cards.reduce((sum, card) => sum + cents(card.querySelector(".lf .num")?.textContent ?? ""), 0);
  const small = column.querySelector<HTMLElement>(".colh small");
  const num = small?.querySelector<HTMLElement>(".num");
  if (num) num.textContent = cardFee(total);
  const last = small?.lastChild;
  if (last && last.nodeType === Node.TEXT_NODE) last.textContent = ` ${leadCount(cards.length)}`;
  column.querySelector(".ring .fg")?.setAttribute("stroke-dashoffset", ringOffset(cards.length));
}

/** Plays a card from where it was (`from`) to where it now is. */
function glide(card: HTMLElement, from: DOMRect) {
  if (reducedMotion() || typeof card.animate !== "function") return;
  const to = card.getBoundingClientRect();
  const dx = from.left - to.left;
  const dy = from.top - to.top;
  if (!dx && !dy) return;
  card.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: "none" }], { duration: SETTLE_MS, easing: EASE });
}

function showError(card: HTMLElement, message: string) {
  card.querySelector(".lflag[data-move-error]")?.remove();
  const line = document.createElement("div");
  line.className = "lflag";
  line.setAttribute("data-move-error", "1");
  line.setAttribute("role", "alert");
  line.textContent = message;
  const footer = card.querySelector(".lf");
  card.insertBefore(line, footer);
  window.setTimeout(() => line.remove(), 6000);
}

async function moveCard(card: HTMLElement, target: HTMLElement, from: DOMRect, org: string, router: Router) {
  const origin = card.closest<HTMLElement>("section.col");
  const targetCards = target.querySelector<HTMLElement>(".cards");
  if (!origin || !targetCards || origin === target || card.getAttribute("aria-busy") === "true") {
    glide(card, from);
    return;
  }
  const originNext = card.nextElementSibling;
  card.querySelector(".lflag[data-move-error]")?.remove();
  // Optimistic: the card is in the new column straight away.
  targetCards.insertBefore(card, targetCards.querySelector(":scope > p.empty"));
  syncColumn(origin);
  syncColumn(target);
  glide(card, from);
  card.setAttribute("aria-busy", "true");

  const result = await post("move", {
    org,
    lead: card.dataset.id,
    stage: target.dataset.stageId,
    version: Number(card.dataset.version),
  });
  card.removeAttribute("aria-busy");
  if (result.ok) {
    if (typeof result.version === "number") card.dataset.version = String(result.version);
    // The server's page (pills, filters, the card's own data) catches up; the board is rebuilt from it.
    router.refresh();
    return;
  }
  // Refused: back where it was, with the reason on the card.
  const back = card.getBoundingClientRect();
  const originCards = origin.querySelector<HTMLElement>(".cards");
  if (originCards) {
    if (originNext && originNext.parentElement === originCards) originCards.insertBefore(card, originNext);
    else originCards.insertBefore(card, originCards.querySelector(":scope > p.empty"));
  }
  syncColumn(target);
  syncColumn(origin);
  glide(card, back);
  const message = result.error ?? "The move wasn’t saved.";
  showError(card, message);
  toast2(message, { kind: "bad", sub: "The lead stayed where it was." });
  if (result.status === 409) router.refresh();
}

type Drag = {
  card: HTMLElement;
  pointerId: number;
  startX: number;
  startY: number;
  rect: DOMRect;
  ghost: HTMLElement | null;
  over: HTMLElement | null;
};

export function wireBoard(root: HTMLElement, router: Router, signal: AbortSignal) {
  const listen = { signal };
  let drag: Drag | null = null;
  let suppressClick = false;
  const board = () => root.querySelector<HTMLElement>("#pipe[data-org]");

  const columnAt = (x: number, y: number) => {
    const hit = document.elementFromPoint(x, y);
    const column = hit?.closest<HTMLElement>("#pipe section.col");
    return column && board()?.contains(column) ? column : null;
  };

  const finish = () => {
    if (!drag) return;
    drag.ghost?.remove();
    drag.card.classList.remove("lift");
    drag.over?.classList.remove("over");
    drag = null;
  };

  root.addEventListener(
    "pointerdown",
    (event) => {
      const target = event.target as HTMLElement;
      const card = target.closest<HTMLElement>("#pipe[data-org] .lc");
      if (!card || event.button !== 0 || target.closest("button, a") || card.getAttribute("aria-busy") === "true") return;
      drag = { card, pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, rect: card.getBoundingClientRect(), ghost: null, over: null };
    },
    listen,
  );

  window.addEventListener(
    "pointermove",
    (event) => {
      if (!drag || event.pointerId !== drag.pointerId) return;
      const dx = event.clientX - drag.startX;
      const dy = event.clientY - drag.startY;
      if (!drag.ghost) {
        if (Math.hypot(dx, dy) < DRAG_START_PX) return;
        const ghost = drag.card.cloneNode(true) as HTMLElement;
        ghost.classList.add("ghost");
        ghost.removeAttribute("tabindex");
        ghost.removeAttribute("data-id");
        ghost.setAttribute("aria-hidden", "true");
        ghost.style.left = `${drag.rect.left}px`;
        ghost.style.top = `${drag.rect.top}px`;
        ghost.style.width = `${drag.rect.width}px`;
        ghost.style.margin = "0";
        root.append(ghost);
        drag.ghost = ghost;
        drag.card.classList.add("lift");
        window.getSelection()?.removeAllRanges();
      }
      event.preventDefault();
      drag.ghost.style.transform = `translate(${dx}px, ${dy}px) rotate(1.5deg)`;
      const over = columnAt(event.clientX, event.clientY);
      if (over !== drag.over) {
        drag.over?.classList.remove("over");
        over?.classList.add("over");
        drag.over = over;
      }
      // Near the board's edges, scroll it so far columns can be reached.
      const pipe = board();
      if (pipe) {
        const box = pipe.getBoundingClientRect();
        if (event.clientX > box.right - 48) pipe.scrollLeft += 14;
        else if (event.clientX < box.left + 48) pipe.scrollLeft -= 14;
      }
    },
    { ...listen, passive: false },
  );

  const drop = (event: PointerEvent) => {
    if (!drag || event.pointerId !== drag.pointerId) return;
    const { card, ghost, over } = drag;
    const from = ghost?.getBoundingClientRect() ?? null;
    finish();
    if (!ghost || !from) return;
    suppressClick = true;
    window.setTimeout(() => (suppressClick = false), 0);
    const org = board()?.dataset.org ?? "";
    const origin = card.closest<HTMLElement>("section.col");
    if (!over || over === origin) {
      glide(card, from);
      return;
    }
    void moveCard(card, over, from, org, router);
  };
  window.addEventListener("pointerup", drop, listen);
  window.addEventListener(
    "pointercancel",
    () => {
      if (drag?.ghost) glide(drag.card, drag.ghost.getBoundingClientRect());
      finish();
    },
    listen,
  );
  window.addEventListener(
    "keydown",
    (event) => {
      if (event.key === "Escape" && drag?.ghost) {
        const from = drag.ghost.getBoundingClientRect();
        const card = drag.card;
        finish();
        glide(card, from);
      }
    },
    listen,
  );

  root.addEventListener(
    "click",
    (event) => {
      const target = event.target as HTMLElement;
      const pipe = board();
      if (!pipe || !pipe.contains(target)) return;
      const arrow = target.closest<HTMLElement>("button[data-mv]");
      const card = target.closest<HTMLElement>(".lc");
      if (arrow && card) {
        event.preventDefault();
        event.stopPropagation();
        const columns = [...pipe.querySelectorAll<HTMLElement>(":scope > section.col")];
        const index = columns.indexOf(card.closest<HTMLElement>("section.col") as HTMLElement);
        const next = columns[index + Number(arrow.dataset.mv)];
        if (!next) return;
        void moveCard(card, next, card.getBoundingClientRect(), pipe.dataset.org ?? "", router);
        return;
      }
      if (card && !suppressClick && card.dataset.href && !target.closest("button, a")) {
        router.push(card.dataset.href);
      }
    },
    listen,
  );
  root.addEventListener(
    "keydown",
    (event) => {
      const card = (event.target as HTMLElement).closest?.<HTMLElement>("#pipe[data-org] .lc");
      if (!card || event.target !== card) return;
      if (event.key === "Enter" && card.dataset.href) {
        event.preventDefault();
        router.push(card.dataset.href);
      }
    },
    listen,
  );
}

// ---------------------------------------------------------------------------
// Stage and Owner filters (`.k2-gs`)
// ---------------------------------------------------------------------------

export function wireFilters(root: HTMLElement, router: Router, signal: AbortSignal) {
  const listen = { signal };
  const close = (select: HTMLElement) => {
    select.querySelector(".k2-gs-tr")?.setAttribute("aria-expanded", "false");
    select.querySelector(".k2-gs-m")?.setAttribute("data-state", "closed");
  };
  const all = () => [...root.querySelectorAll<HTMLElement>(".k2-pf .k2-gs")].filter((select) => select.querySelector("li[data-href]"));
  root.addEventListener(
    "click",
    (event) => {
      const target = event.target as HTMLElement;
      const trigger = target.closest<HTMLElement>(".k2-gs-tr");
      const select = target.closest<HTMLElement>(".k2-gs");
      if (!select || !all().includes(select)) {
        all().forEach(close);
        return;
      }
      if (trigger) {
        event.preventDefault();
        const open = trigger.getAttribute("aria-expanded") === "true";
        all().forEach(close);
        if (!open) {
          trigger.setAttribute("aria-expanded", "true");
          select.querySelector(".k2-gs-m")?.setAttribute("data-state", "open");
          select.querySelector<HTMLElement>(".k2-gs-l")?.focus();
        }
        return;
      }
      const option = target.closest<HTMLElement>("li[data-href]");
      if (option?.dataset.href) {
        event.preventDefault();
        close(select);
        router.push(option.dataset.href);
      }
    },
    listen,
  );
  root.addEventListener(
    "keydown",
    (event) => {
      const list = (event.target as HTMLElement).closest?.<HTMLElement>(".k2-gs-l");
      const select = list?.closest<HTMLElement>(".k2-gs");
      if (!list || !select || !all().includes(select)) return;
      const options = [...list.querySelectorAll<HTMLElement>("li[data-href]")];
      const current = options.findIndex((option) => option.classList.contains("kb"));
      if (event.key === "Escape") {
        close(select);
        select.querySelector<HTMLElement>(".k2-gs-tr")?.focus();
      } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        const next = options[(current + (event.key === "ArrowDown" ? 1 : options.length - 1) + (current < 0 ? 1 : 0)) % options.length];
        options.forEach((option) => option.classList.toggle("kb", option === next));
        list.setAttribute("aria-activedescendant", next.id);
      } else if (event.key === "Enter" && current >= 0) {
        event.preventDefault();
        router.push(options[current].dataset.href ?? "/sheet/pipeline");
      }
    },
    listen,
  );
}

// ---------------------------------------------------------------------------
// Pipeline page: New lead, CSV import, bookings
// ---------------------------------------------------------------------------

function field(root: ParentNode, id: string): string {
  return root.querySelector<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>(`#${id}`)?.value ?? "";
}

function checked(root: ParentNode, id: string): boolean {
  return root.querySelector<HTMLInputElement>(`#${id}`)?.checked === true;
}

let csvRows: CsvLeadRow[] = [];
let csvName = "";

function fillCsv(dialog: HTMLElement, file: File, text: string) {
  const read = readLeadsCsv(text);
  const submit = dialog.querySelector<HTMLElement>("[data-lead-act='import']");
  if ("error" in read) {
    csvRows = [];
    toast2(read.error, { kind: "warn", sub: "Nothing was imported." });
    if (submit) submit.textContent = "Import leads";
    return;
  }
  csvRows = read.rows;
  csvName = file.name.slice(0, 120);
  const heading = dialog.querySelector<HTMLElement>("#csvName");
  if (heading) {
    heading.textContent = "";
    heading.append(`${csvName} `);
    const sep = document.createElement("span");
    sep.className = "sep";
    sep.setAttribute("aria-hidden", "true");
    heading.append(sep, ` ${read.rows.length === 1 ? "1 row" : `${read.rows.length} rows`}${read.truncated ? " (first 500)" : ""}`);
    heading.hidden = false;
  }
  const rows = [...dialog.querySelectorAll<HTMLTableRowElement>("table tbody tr")];
  LEAD_FIELDS.forEach(({ field: key }, index) => {
    const cells = rows[index]?.cells;
    if (!cells) return;
    const column = read.map[key];
    cells[0].textContent = column == null ? (key === "email" || key === "phone") && read.rows.some((row) => row[key]) ? "Contact" : "—" : read.headers[column] || "—";
    cells[1].textContent = read.rows.find((row) => row[key])?.[key] ?? "—";
  });
  if (submit) submit.textContent = read.rows.length === 1 ? "Import 1 lead" : `Import ${read.rows.length} leads`;
}

async function runPipelineAct(button: HTMLElement, router: Router) {
  const act = button.dataset.leadAct;
  const dialog = button.closest("dialog");
  if (act === "create" && dialog) {
    const result = await post("create", {
      org: button.dataset.org,
      name: field(dialog, "nlN"),
      email: field(dialog, "nlE"),
      phone: field(dialog, "nlP"),
      preferred: field(dialog, "nlC") || null,
      service: field(dialog, "nlS"),
      country: field(dialog, "nlK"),
      language: field(dialog, "nlL"),
      source: field(dialog, "nlSrc"),
      owner: field(dialog, "nlO") || null,
      fee: field(dialog, "nlF"),
      note: field(dialog, "nlNote"),
      reply: checked(dialog, "nlR"),
      marketing: checked(dialog, "nlM"),
    });
    if (!result.ok || !result.id) {
      toast2(result.error ?? "The lead wasn’t added.", { kind: "bad", sub: "Nothing was saved." });
      return;
    }
    dialog.close();
    toast2("Lead added", { kind: "ok", sub: "It starts in the first stage." });
    router.push(`/sheet/lead?id=${result.id}`);
    return;
  }
  if (act === "import" && dialog) {
    if (!csvRows.length) {
      toast2("Choose a .csv file first", { kind: "warn", sub: "Name, email or phone, service interest, source." });
      return;
    }
    const result = await post("import", { org: button.dataset.org, file: csvName, rows: csvRows });
    if (!result.ok) {
      toast2(result.error ?? "The leads weren’t imported.", { kind: "bad", sub: "Nothing was saved." });
      return;
    }
    const skipped = result.skipped ?? [];
    toast2(result.imported === 1 ? "1 lead imported" : `${result.imported ?? 0} leads imported`, {
      kind: skipped.length ? "warn" : "ok",
      sub: skipped.length
        ? `Skipped ${skipped.length === 1 ? "row" : "rows"} ${skipped.slice(0, 5).map((row) => row.row + 1).join(", ")}${skipped.length > 5 ? "…" : ""}: ${skipped[0].reason}.`
        : "Possible duplicates are flagged on their cards for you to compare.",
    });
    csvRows = [];
    window.setTimeout(() => window.location.assign("/sheet/pipeline"), 700);
    return;
  }
  if (act === "from-booking") {
    const result = await post("from-booking", { org: button.dataset.org, booking: button.dataset.booking });
    if (!result.ok || !result.id) {
      toast2(result.error ?? "The lead wasn’t made.", { kind: "bad", sub: "Nothing was saved." });
      return;
    }
    dialog?.close();
    toast2("Lead made from the booking", { kind: "ok", sub: "The booking is linked to it." });
    router.push(`/sheet/lead?id=${result.id}`);
  }
}

export function wirePipeline(root: HTMLElement, router: Router, signal: AbortSignal, open: (id: string) => void) {
  if (!root.querySelector("#pipe[data-org]")) return;
  const listen = { signal };
  wireBoard(root, router, signal);
  wireFilters(root, router, signal);

  const params = new URLSearchParams(window.location.search);
  const newLead = root.querySelector<HTMLDialogElement>("dialog#dlgLead");
  if (newLead) {
    if (params.get("new") === "1") window.setTimeout(() => open("dlgLead"), 300);
    newLead.addEventListener(
      "close",
      () => {
        const search = new URLSearchParams(window.location.search);
        if (!search.has("new")) return;
        search.delete("new");
        const query = search.toString();
        router.replace(`${window.location.pathname}${query ? `?${query}` : ""}`);
      },
      listen,
    );
  }
  const input = root.querySelector<HTMLInputElement>("#csvIn");
  input?.addEventListener(
    "change",
    () => {
      const file = input.files?.[0];
      const dialog = input.closest("dialog");
      if (!file || !dialog) return;
      if (file.size > 2_000_000) {
        toast2("That file is too large", { kind: "warn", sub: "Import up to 500 leads (2 MB) at a time." });
        return;
      }
      void file.text().then((text) => fillCsv(dialog, file, text));
    },
    listen,
  );

  root.addEventListener(
    "click",
    (event) => {
      const target = event.target as HTMLElement;
      if (target.closest("[data-lead-open='new']")) {
        event.preventDefault();
        open("dlgLead");
        return;
      }
      if (target.closest("[data-csv-choose]")) {
        event.preventDefault();
        input?.click();
        return;
      }
      const button = target.closest<HTMLElement>("[data-lead-act]");
      if (!button || !root.contains(button)) return;
      event.preventDefault();
      if (button.getAttribute("aria-busy") === "true") return;
      button.setAttribute("aria-busy", "true");
      void runPipelineAct(button, router).finally(() => button.removeAttribute("aria-busy"));
    },
    listen,
  );
}

// ---------------------------------------------------------------------------
// The lead page
// ---------------------------------------------------------------------------

function wire(button: HTMLElement) {
  return { org: button.dataset.org, lead: button.dataset.lead, version: Number(button.dataset.version) };
}

const OPENERS: Record<string, string> = { edit: "dlgEdit", lost: "dlgLost", "follow-up": "dlgFu" };

async function runLeadAct(button: HTMLElement, router: Router) {
  const act = button.dataset.leadAct ?? "";
  const dialog = button.closest("dialog");
  const page = button.closest("#content") ?? document;
  let result: Result & { status: number };
  let done = { title: "Saved", sub: "" };
  switch (act) {
    case "note": {
      const body = field(page, "ln");
      result = await post("note", { org: button.dataset.org, lead: button.dataset.lead, body });
      done = { title: "Note saved", sub: "" };
      if (result.ok) {
        const area = page.querySelector<HTMLTextAreaElement>("#ln");
        if (area) area.value = "";
      }
      break;
    }
    case "follow-up":
      result = await post("follow-up", { org: button.dataset.org, lead: button.dataset.lead, title: field(dialog ?? page, "fuT"), owner: field(dialog ?? page, "fuO") || null, due: field(dialog ?? page, "fuD") || null });
      done = { title: "Follow-up added", sub: "" };
      break;
    case "follow-done":
      result = await post("follow-done", { org: button.dataset.org, followUp: button.dataset.followUp });
      done = { title: "Follow-up done", sub: "" };
      break;
    case "lost":
      result = await post("lost", { ...wire(button), reason: field(dialog ?? page, "lsR") });
      done = { title: "Closed as lost", sub: "The reason is kept with the lead." };
      break;
    case "conflict":
      result = await post("conflict", { ...wire(button), result: field(dialog ?? page, "cfR"), note: field(dialog ?? page, "cfN") || null });
      done = { title: "Conflict check recorded", sub: "" };
      break;
    case "dup-same":
    case "dup-different":
      result = await post("dup", { org: button.dataset.org, lead: button.dataset.lead, other: button.dataset.other, same: act === "dup-same" });
      done = act === "dup-same" ? { title: "Linked to the same person", sub: "Both leads stay, under one person." } : { title: "Marked as different people", sub: "We won’t suggest this pair again." };
      break;
    case "link-booking":
      result = await post("link-booking", { org: button.dataset.org, lead: button.dataset.lead, booking: field(page, "lbB") });
      done = { title: "Consultation linked", sub: "" };
      break;
    case "edit": {
      const box = dialog?.querySelector<HTMLInputElement>("#edM");
      const was = box?.dataset.marketingWas === "1";
      const now = box?.checked === true;
      result = await post("edit", {
        ...wire(button),
        name: field(dialog ?? page, "edN"),
        email: field(dialog ?? page, "edE"),
        phone: field(dialog ?? page, "edP"),
        preferred: field(dialog ?? page, "edC"),
        service: field(dialog ?? page, "edS"),
        country: field(dialog ?? page, "edK"),
        language: field(dialog ?? page, "edL"),
        dateOfBirth: field(dialog ?? page, "edD"),
        sourceDetail: field(dialog ?? page, "edSd"),
        owner: field(dialog ?? page, "edO"),
        fee: field(dialog ?? page, "edF"),
        tags: field(dialog ?? page, "edT"),
        marketing: was === now ? null : now,
      });
      done = { title: "Lead saved", sub: "" };
      break;
    }
    case "convert": {
      result = await post("convert", { ...wire(button), consultant: field(dialog ?? page, "cvC"), program: field(dialog ?? page, "cvT") || null });
      if (result.ok && result.id) {
        dialog?.close();
        toast2(result.reference ? `Matter ${result.reference} created` : "Matter created", { kind: "ok", sub: "Stage: Engagement pending." });
        router.push(`/sheet/matters/${result.id}`);
        return;
      }
      break;
    }
    default:
      return;
  }
  if (!result.ok) {
    toast2(result.error ?? "That couldn’t be saved.", { kind: "bad", sub: "Nothing was changed." });
    if (result.status === 409) router.refresh();
    return;
  }
  dialog?.close();
  toast2(done.title, { kind: "ok", sub: done.sub });
  if (act === "conflict") {
    const search = new URLSearchParams(window.location.search);
    search.delete("dlg");
    router.replace(`${window.location.pathname}?${search.toString()}`);
  }
  router.refresh();
}

export function wireLead(root: HTMLElement, router: Router, signal: AbortSignal, open: (id: string) => void) {
  const listen = { signal };
  const search = new URLSearchParams(window.location.search);
  const conflict = root.querySelector<HTMLDialogElement>("dialog#dlgConf");
  if (conflict && search.get("dlg") === "conflict") {
    window.setTimeout(() => open("dlgConf"), 300);
    conflict.addEventListener(
      "close",
      () => {
        const params = new URLSearchParams(window.location.search);
        if (!params.has("dlg")) return;
        params.delete("dlg");
        router.replace(`${window.location.pathname}?${params.toString()}`);
      },
      listen,
    );
  }
  root.addEventListener(
    "click",
    (event) => {
      const target = event.target as HTMLElement;
      const opener = target.closest<HTMLElement>("[data-lead-open]");
      if (opener && root.contains(opener)) {
        event.preventDefault();
        const kind = opener.dataset.leadOpen ?? "";
        if (kind === "conflict") {
          const params = new URLSearchParams(window.location.search);
          params.set("dlg", "conflict");
          if (root.querySelector("dialog#dlgConf")) open("dlgConf");
          else router.replace(`${window.location.pathname}?${params.toString()}`);
          return;
        }
        if (OPENERS[kind]) open(OPENERS[kind]);
        return;
      }
      const button = target.closest<HTMLElement>("[data-lead-act]");
      if (!button || !root.contains(button)) return;
      event.preventDefault();
      event.stopPropagation();
      if (button.getAttribute("aria-busy") === "true") return;
      button.setAttribute("aria-busy", "true");
      void runLeadAct(button, router).finally(() => button.removeAttribute("aria-busy"));
    },
    { ...listen, capture: true },
  );
}
