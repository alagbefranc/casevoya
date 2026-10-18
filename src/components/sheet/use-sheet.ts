"use client";

import { useEffect, useLayoutEffect, type RefObject } from "react";
import { useRouter } from "next/navigation";
import { toast2 } from "@/components/port/kit";
import { dialogId, withoutDialog } from "@/modules/sheet/matter-wire";
import { withoutNew } from "@/modules/sheet/new-matter";
import { sheetStateCopy } from "@/modules/sheet/present";
import { INVITE_DIALOG } from "@/modules/sheet/staff-present";
import { runMatterAct } from "./matter-acts";
import { runNewMatter } from "./new-matter-act";
import { runNewTask, syncNewTask } from "./new-task-act";
import { openPortalInvite, reopenPortalInvite, runPortalInvite } from "./portal-invite-act";
import { restoreStaffInvite, runStaffInvite, runStaffResend, runStaffRevoke } from "./staff-invite-act";

const ASSET = "/assets/icons-coreui/sprite.svg";
const NEW_MATTER = "/sheet/matters?new=1";

function icon(name: string, cls = ""): string {
  return `<svg class="ic ${cls}" aria-hidden="true"><use href="${ASSET}#i-${name}"/></svg>`;
}

function art(name: string, px: number) {
  return `<span class="art" style="--a:${px}px" aria-hidden="true"><img src="/assets/generated/b2/${name}-160@1x.webp" srcset="/assets/generated/b2/${name}-160@2x.webp 2x" width="${px}" height="${px}" alt="" loading="lazy" decoding="async"></span>`;
}

/** How long "Hold to revoke" must be held. */
const HOLD_MS = 900;

const FILTER_TOKEN: Record<string, string> = {
  Mine: "mine",
  Overdue: "overdue",
  Blocked: "blocked",
  "High priority": "high",
  Applicants: "applicant",
  Sponsors: "sponsor",
  Dependants: "dependant",
  Leads: "lead",
};
/** Pages whose `.fp-bar` chips and search filter real rows by their `data-f` tokens. */
const FILTER_PAGES = new Set(["tasks", "clients"]);

export function useSheet(ref: RefObject<HTMLElement | null>, page: string) {
  const router = useRouter();
  useEffect(() => {
    const root = ref.current;
    if (!root) return;
    const ac = new AbortController();
    const listen = { signal: ac.signal };

    const side = root.querySelector<HTMLElement>("#side");
    const scrim = root.querySelector<HTMLElement>("#scrimd");
    const shut = () => {
      side?.classList.remove("open");
      scrim?.classList.remove("on");
    };
    root.querySelector("#mOpen")?.addEventListener("click", () => {
      side?.classList.add("open");
      scrim?.classList.add("on");
    }, listen);
    root.querySelector("#mClose")?.addEventListener("click", shut, listen);
    scrim?.addEventListener("click", shut, listen);

    root.querySelectorAll<HTMLButtonElement>(".grp>button").forEach((button) => {
      button.addEventListener("click", () => {
        const group = button.parentElement;
        group?.classList.toggle("shut");
        button.setAttribute("aria-expanded", String(!group?.classList.contains("shut")));
      }, listen);
    });

    const place = () => {
      const underline = root.querySelector<HTMLElement>(".tabs .ul");
      const current = root.querySelector<HTMLElement>(".tabs button.on");
      if (!underline || !current) return;
      underline.style.left = `${current.offsetLeft}px`;
      underline.style.width = `${current.offsetWidth}px`;
    };
    place();
    root.querySelectorAll<HTMLButtonElement>(".tabs button[data-t]").forEach((button) => {
      button.addEventListener("click", () => {
        const url = new URL(window.location.href);
        url.searchParams.set("tab", button.dataset.t || "");
        router.replace(`${url.pathname}${url.search}`);
      }, listen);
    });

    const openDialog = (id: string) => {
      const dialog = root.querySelector<HTMLDialogElement>(`#${CSS.escape(id)}`);
      if (dialog && !dialog.open) dialog.showModal();
    };
    const closeDialog = (id: string) => {
      const dialog = root.querySelector<HTMLDialogElement>(`#${CSS.escape(id)}`);
      dialog?.close();
    };

    // The Tasks page's filter chips (All, Mine, Overdue, Blocked, High priority) and the Clients
    // page's (All, Applicants, Sponsors, Dependants, Leads), with search, narrow the real rows by
    // their `data-f` tokens and text, and keep "N of M shown" true where the page has it.
    const filters = FILTER_PAGES.has(page) ? root.querySelector<HTMLElement>(".fp-bar") : null;
    const applyFilters = () => {
      if (!filters) return;
      const q = (filters.querySelector("input")?.value ?? "").trim().toLowerCase();
      const token = FILTER_TOKEN[filters.querySelector(".fchip.on")?.textContent?.trim() ?? ""] ?? "";
      const rows = [...root.querySelectorAll<HTMLElement>(".t tbody tr")];
      let shown = 0;
      for (const row of rows) {
        const flags = (row.dataset.f ?? "").split(" ");
        const hide = (Boolean(q) && !row.textContent.toLowerCase().includes(q)) || (Boolean(token) && !flags.includes(token));
        row.hidden = hide;
        if (!hide) shown++;
      }
      const count = root.querySelector<HTMLElement>("#content > p.sr");
      if (count) count.textContent = `${shown} of ${rows.length} shown`;
      const none = shown === 0 && rows.length > 0;
      root.querySelector<HTMLElement>("#content > .tw")?.toggleAttribute("hidden", none);
      root.querySelector<HTMLElement>("#content > .fp-fe")?.toggleAttribute("hidden", !none);
    };

    root.addEventListener("click", (event) => {
      const target = event.target as HTMLElement;
      // Every "New matter" entry point: the dialog on the Matters page, or the Matters page with it open.
      const create = target.closest<HTMLElement>(`#newB, a[href="${NEW_MATTER}"], a.add`);
      if (create && root.contains(create) && (!create.matches("a.add") || create.textContent.trim() === "New matter")) {
        event.preventDefault();
        if (root.querySelector("#dlgNew")) openDialog("dlgNew");
        else window.location.assign(NEW_MATTER);
        return;
      }
      const save = target.closest<HTMLElement>("[data-new-matter]");
      if (save && root.contains(save)) {
        event.preventDefault();
        if (save.getAttribute("aria-busy") === "true") return;
        save.setAttribute("aria-busy", "true");
        void runNewMatter(save, router).finally(() => save.removeAttribute("aria-busy"));
        return;
      }
      // The Staff tab: Invite staff opens the Designer's dialog; Send, Resend and revoke go to the database.
      if (target.closest("#invB") && root.querySelector("#dlgS [data-org]")) {
        event.preventDefault();
        openDialog("dlgS");
        return;
      }
      const invite = target.closest<HTMLElement>("#dlgS [data-org]");
      if (invite && root.contains(invite)) {
        event.preventDefault();
        if (invite.getAttribute("aria-busy") === "true") return;
        invite.setAttribute("aria-busy", "true");
        void runStaffInvite(invite, router).finally(() => invite.removeAttribute("aria-busy"));
        return;
      }
      const invitation = target.closest<HTMLElement>("[data-invitation]");
      if (invitation && root.contains(invitation)) {
        event.preventDefault();
        if (invitation.getAttribute("aria-busy") === "true") return;
        // Revoking needs a press and hold (pointer or keyboard, below); a click alone does not revoke.
        if (invitation.hasAttribute("data-hold")) return;
        invitation.setAttribute("aria-busy", "true");
        void runStaffResend(invitation, root, router).finally(() => invitation.removeAttribute("aria-busy"));
        return;
      }
      const task = target.closest<HTMLElement>("[data-new-task]");
      if (task && root.contains(task)) {
        event.preventDefault();
        if (task.getAttribute("aria-busy") === "true") return;
        task.setAttribute("aria-busy", "true");
        void runNewTask(task, router).finally(() => task.removeAttribute("aria-busy"));
        return;
      }
      const palette = target.closest<HTMLElement>("[data-palette]");
      if (palette && root.contains(palette)) {
        event.preventDefault();
        openPalette(root);
        return;
      }
      const portalInvite = target.closest<HTMLElement>("[data-invite-open]");
      if (portalInvite && root.contains(portalInvite)) {
        event.preventDefault();
        openPortalInvite(portalInvite, root);
        return;
      }
      const send = target.closest<HTMLElement>("[data-invite]");
      if (send && root.contains(send)) {
        event.preventDefault();
        if (send.getAttribute("aria-busy") === "true") return;
        send.setAttribute("aria-busy", "true");
        void runPortalInvite(send, router).finally(() => send.removeAttribute("aria-busy"));
        return;
      }
      const act = target.closest<HTMLElement>("[data-act]");
      if (act && root.contains(act)) {
        event.preventDefault();
        if (act.getAttribute("aria-busy") === "true") return;
        act.setAttribute("aria-busy", "true");
        void runMatterAct(act, root, router).finally(() => act.removeAttribute("aria-busy"));
        return;
      }
      const opener = target.closest<HTMLElement>("[data-open], [data-dlg], [data-stage], [data-letter], [data-hold]");
      if (opener) {
        event.preventDefault();
        const id =
          opener.dataset.open ||
          opener.dataset.dlg ||
          (opener.hasAttribute("data-stage") ? "dStage" : opener.hasAttribute("data-letter") ? "dLetter" : "dHold");
        openDialog(id);
      }
      const closer = target.closest<HTMLElement>("[data-close], [data-x]");
      if (closer) {
        event.preventDefault();
        const dialog = closer.closest("dialog");
        if (closer.dataset.close) closeDialog(closer.dataset.close);
        else dialog?.close();
      }
      const toast = target.closest<HTMLElement>("[data-toast]");
      if (toast?.dataset.toast) {
        event.preventDefault();
        toast2(toast.dataset.toast, { kind: toast.dataset.toastKind || "", sub: toast.dataset.toastSub || "" });
      }
      const check = target.closest<HTMLElement>("[data-toggle-on], .ck");
      if (check && root.contains(check)) {
        event.preventDefault();
        event.stopPropagation();
        check.classList.toggle("on");
        check.setAttribute("aria-checked", String(check.classList.contains("on")));
        check.closest("li")?.classList.toggle("on", check.classList.contains("on"));
        check.closest("tr")?.classList.toggle("sel", check.classList.contains("on"));
      }
      const tab = target.closest<HTMLElement>("[data-goto-tab]");
      if (tab?.dataset.gotoTab) {
        event.preventDefault();
        const url = new URL(window.location.href);
        url.searchParams.set("tab", tab.dataset.gotoTab);
        router.replace(`${url.pathname}${url.search}`);
      }
      if (target.closest("[data-clear-search]")) {
        event.preventDefault();
        const url = new URL(window.location.href);
        url.searchParams.delete("state");
        router.replace(`${url.pathname}${url.search}`);
      }
      const bell = target.closest<HTMLElement>(".k2-bell");
      if (bell) bell.setAttribute("aria-pressed", String(bell.getAttribute("aria-pressed") !== "true"));
      const sw = target.closest<HTMLElement>(".k2-sw");
      if (sw) sw.setAttribute("aria-checked", String(sw.getAttribute("aria-checked") !== "true"));
      const fuse = target.closest<HTMLElement>(".k2-fb-idle, .k2-fb-undo");
      if (fuse) armFuse(fuse);
      const rubber = target.closest<HTMLElement>(".k2-rsw");
      const rubberButton = target.closest("button");
      if (rubber && rubberButton && rubber.contains(rubberButton)) {
        rubber.querySelectorAll("button").forEach((item) => item.setAttribute("aria-checked", String(item === rubberButton)));
        const mine = /Mine/.test(rubberButton.textContent || "");
        root.querySelectorAll<HTMLElement>("tbody tr").forEach((row) => {
          row.hidden = mine && !row.hasAttribute("data-mine");
        });
      }
      if (filters) {
        const chip = target.closest<HTMLElement>(".fchip");
        if (chip && filters.contains(chip)) {
          event.preventDefault();
          filters.querySelectorAll<HTMLElement>(".fchip").forEach((item) => {
            item.classList.toggle("on", item === chip);
            item.setAttribute("aria-pressed", String(item === chip));
          });
          applyFilters();
        }
        if (target.closest(".fp-fe button")) {
          event.preventDefault();
          const input = filters.querySelector("input");
          if (input) input.value = "";
          filters.querySelectorAll<HTMLElement>(".fchip").forEach((item, index) => {
            item.classList.toggle("on", index === 0);
            item.setAttribute("aria-pressed", String(index === 0));
          });
          applyFilters();
        }
      }
      const row = target.closest<HTMLElement>("tr[data-href]");
      if (row?.dataset.href && root.contains(row) && !target.closest("a, button, .ck")) {
        router.push(row.dataset.href);
      }
    }, listen);

    // "Hold to revoke" on a pending staff invitation: held for HOLD_MS, then revoked.
    let hold: number | undefined;
    const release = () => {
      window.clearTimeout(hold);
      hold = undefined;
    };
    const press = (event: Event) => {
      const button = (event.target as HTMLElement).closest<HTMLElement>("[data-invitation][data-hold]");
      if (!button || !root.contains(button) || button.getAttribute("aria-busy") === "true") return;
      if (event instanceof KeyboardEvent && (event.repeat || (event.key !== "Enter" && event.key !== " "))) return;
      event.preventDefault();
      release();
      hold = window.setTimeout(() => {
        hold = undefined;
        button.setAttribute("aria-busy", "true");
        void runStaffRevoke(button, root, router).finally(() => button.removeAttribute("aria-busy"));
      }, HOLD_MS);
    };
    root.addEventListener("pointerdown", press, listen);
    root.addEventListener("keydown", press, listen);
    for (const type of ["pointerup", "pointerout", "pointercancel", "keyup"]) root.addEventListener(type, release, listen);

    root.querySelectorAll<HTMLInputElement>('.bar input').forEach((input) => {
      if (filters?.contains(input)) {
        const preset = new URLSearchParams(window.location.search).get("q");
        if (preset && !input.value) input.value = preset;
        input.addEventListener("input", applyFilters, listen);
        applyFilters();
        return;
      }
      const apply = () => {
        const q = input.value.trim().toLowerCase();
        root.querySelectorAll<HTMLElement>(".t tbody tr").forEach((row) => {
          row.hidden = Boolean(q) && !row.textContent.toLowerCase().includes(q);
        });
      };
      const preset = new URLSearchParams(window.location.search).get("q");
      if (preset && !input.value) input.value = preset;
      input.addEventListener("input", apply, listen);
      apply();
    });

    root.querySelectorAll("form").forEach((form) => {
      if (form.getAttribute("data-live") === "1") return;
      form.addEventListener("submit", (event) => {
        event.preventDefault();
        toast2("This form isn’t connected yet", { kind: "warn", sub: "Nothing was saved." });
      }, listen);
    });

    const params = new URLSearchParams(window.location.search);
    const dialogParam = params.get("dlg");
    const dialog = dialogId(dialogParam);
    if (dialog) window.setTimeout(() => openDialog(dialog), 300);
    if (dialogParam === "invite") window.setTimeout(() => reopenPortalInvite(root, params.get("pid")), 300);
    const staffInvite = root.querySelector<HTMLDialogElement>("#dlgS");
    if (staffInvite && staffInvite.querySelector("[data-org]")) {
      // ?dlg=invite (coming back from step-up) reopens Invite staff with what was typed; closing drops the flag.
      if (dialogParam === INVITE_DIALOG) {
        window.setTimeout(() => {
          restoreStaffInvite(staffInvite);
          openDialog("dlgS");
        }, 300);
      }
      staffInvite.addEventListener("close", () => {
        if (new URLSearchParams(window.location.search).has("dlg")) router.replace(withoutDialog(window.location.pathname, window.location.search));
      }, listen);
    }
    const newMatter = root.querySelector<HTMLDialogElement>("#dlgNew");
    if (newMatter) {
      // ?new=1 (the sidebar link, or coming back from step-up) opens the dialog; closing it drops the flag.
      if (params.get("new") === "1") window.setTimeout(() => openDialog("dlgNew"), 300);
      newMatter.addEventListener("close", () => {
        if (new URLSearchParams(window.location.search).has("new")) router.replace(withoutNew(window.location.pathname, window.location.search));
      }, listen);
    }

    const newTask = root.querySelector<HTMLDialogElement>("dialog#dlgTask");
    if (newTask?.querySelector("[data-new-task]")) {
      // The live New task form: owners and dependencies follow the chosen matter and kind.
      syncNewTask(newTask);
      newTask.addEventListener("change", () => syncNewTask(newTask), listen);
    }

    window.addEventListener("resize", place, listen);
    return () => ac.abort();
  }, [page, ref, router]);

  useLayoutEffect(() => {
    const root = ref.current;
    if (!root) return;
    const state = new URLSearchParams(window.location.search).get("state");
    if (state) applyState(root, page, state);
  });
}

function armFuse(button: HTMLElement) {
  const wrap = button.closest<HTMLElement>(".k2-fb");
  if (!wrap) return;
  const idle = wrap.querySelector<HTMLElement>(".k2-fb-idle");
  const undo = wrap.querySelector<HTMLElement>(".k2-fb-undo");
  const done = wrap.querySelector<HTMLElement>(".k2-fb-done");
  if (button.classList.contains("k2-fb-undo")) {
    wrap.dataset.phase = "idle";
    wrap.querySelector(".k2-fb-rim rect")?.getAnimations().forEach((animation) => animation.cancel());
    return;
  }
  if (wrap.dataset.phase !== "idle") return;
  wrap.dataset.phase = "armed";
  const ms = Number(wrap.dataset.ms || 4000);
  const rect = wrap.querySelector(".k2-fb-rim rect");
  const animation = rect?.animate([{ strokeDashoffset: 0 }, { strokeDashoffset: -1 }], { duration: ms, easing: "linear", fill: "forwards" });
  if (animation) {
    animation.onfinish = () => {
      wrap.dataset.phase = "settled";
      if (done) done.setAttribute("aria-hidden", "false");
      idle?.setAttribute("hidden", "");
      undo?.setAttribute("hidden", "");
    };
  }
  void done;
}

function openPalette(root: HTMLElement) {
  let scrim = root.querySelector<HTMLElement>(".scrim");
  if (!scrim) {
    scrim = document.createElement("div");
    scrim.className = "scrim";
    const links = [...root.querySelectorAll<HTMLAnchorElement>(".tree a[href], .nav a[href], .tiles a[href]")]
      .filter((link) => link.getAttribute("href") && link.getAttribute("href") !== "#")
      .slice(0, 24);
    scrim.innerHTML = `<div class="palette" role="dialog" aria-label="Search"><input placeholder="Search matters, people and actions" aria-label="Search"><ul>${links
      .map((link) => `<li data-u="${link.getAttribute("href")}">${link.textContent?.trim() || "Open"}</li>`)
      .join("")}</ul></div>`;
    root.append(scrim);
    scrim.addEventListener("click", (event) => {
      if (event.target === scrim) scrim?.classList.remove("on");
    });
    scrim.querySelectorAll<HTMLElement>("li").forEach((item) => {
      item.addEventListener("click", () => {
        const href = item.dataset.u;
        if (href) window.location.assign(href);
      });
    });
    const input = scrim.querySelector("input");
    input?.addEventListener("input", () => {
      const q = input.value.trim().toLowerCase();
      scrim?.querySelectorAll<HTMLElement>("li").forEach((item) => {
        item.hidden = Boolean(q) && !item.textContent.toLowerCase().includes(q);
      });
    });
    input?.addEventListener("keydown", (event) => {
      if (event.key === "Escape") scrim?.classList.remove("on");
    });
  }
  scrim.classList.add("on");
  window.setTimeout(() => scrim?.querySelector("input")?.focus(), 30);
}

function applyState(root: HTMLElement, page: string, state: string) {
  const content = root.querySelector("#content");
  if (!content) return;
  const copy = sheetStateCopy(page);
  const heading = content.querySelector("h1")?.textContent || "This screen";
  if (state === "loading") {
    content.innerHTML = `<div class="fp-st" role="status"><span class="sr">Loading ${copy[4]}…</span><div class="sk h"></div><div class="sk" style="width:60%"></div>${'<div class="sk r"></div>'.repeat(4)}</div>`;
    return;
  }
  if (state === "empty") {
    content.innerHTML = `<div class="ph"><h1 class="display">${heading}</h1></div><div class="panel"><div class="emp">${art(copy[0], 88)}<b>${copy[1]}</b><small>${copy[2]}</small></div></div>`;
    return;
  }
  if (state === "error") {
    content.innerHTML = `<div class="ph"><h1 class="display">${heading}</h1></div><div class="alert bad" role="alert">${icon("alert")}<div><b>We couldn’t load ${copy[4]}</b>The server didn’t answer in time. Nothing was lost.</div></div>`;
    return;
  }
  if (state === "denied") {
    content.innerHTML = `<div class="ph"><h1 class="display">${heading}</h1></div><div class="panel"><div class="emp">${art("privacy-shield", 88)}<b>You don’t have permission to see ${copy[4]}</b><small>Your role doesn’t include this. Ask your firm owner if you need access.</small></div></div>`;
    return;
  }
  if (state === "offline") {
    content.insertAdjacentHTML("afterbegin", `<div class="alert warn" role="status">${icon("wifi-off")}<div><b>You’re offline</b>Showing ${copy[4]} from this device. Changes wait until you reconnect.</div></div>`);
  }
}
