"use client";

import { useEffect, type RefObject } from "react";
import { toast2 } from "@/components/port/kit";
import { nextPrototypePayState } from "@/modules/portal/pay";

const EMPTY: Record<string, [string, string, string, string?]> = {
  matters: ["matters-empty", "No matters yet", "When your firm opens an application for you, it appears here with its first step."],
  tasks: ["portal-caught-up", "You’re all caught up", "Nothing needs you right now. Your firm will email you when something does."],
  documents: ["portal-docs-empty", "No documents requested yet", "When your firm asks for a document, it appears here with what it should show."],
  messages: ["portal-messages-empty", "No messages yet", "Write to your firm any time. You’ll see who can read it before you send.", '<a class="btn p sm" href="/portal/messages">Write a message</a>'],
  payments: ["portal-nothing-due", "Nothing to pay", "No invoices are due. Receipts for past payments stay here."],
};

function art(name: string, px: number) {
  return `<span class="art" style="--a:${px}px" aria-hidden="true"><img src="/assets/generated/b2/${name}-160@1x.webp" srcset="/assets/generated/b2/${name}-160@2x.webp 2x" width="${px}" height="${px}" alt="" loading="lazy" decoding="async"></span>`;
}

function narrow() {
  return window.matchMedia("(max-width:900px)").matches;
}

export function usePortal(ref: RefObject<HTMLElement | null>, page: string) {
  useEffect(() => {
    const root = ref.current;
    if (!root || root.dataset.portalReady === "1") return;
    root.dataset.portalReady = "1";
    const ac = new AbortController();
    const listen = { signal: ac.signal };

    const side = root.querySelector<HTMLElement>("#side");
    const scrim = root.querySelector<HTMLElement>("#scrimd");
    const open = root.querySelector<HTMLElement>("#mOpen");
    const close = root.querySelector<HTMLElement>("#mClose");
    const shut = () => {
      side?.classList.remove("open");
      scrim?.classList.remove("on");
      open?.setAttribute("aria-expanded", "false");
    };
    open?.addEventListener("click", () => {
      side?.classList.add("open");
      scrim?.classList.add("on");
      open.setAttribute("aria-expanded", "true");
    }, listen);
    close?.addEventListener("click", shut, listen);
    scrim?.addEventListener("click", shut, listen);

    root.querySelector("#lang")?.addEventListener("click", (event) => {
      event.preventDefault();
      toast2("Français arrive bientôt", {
        sub: "French isn’t available on this screen yet.",
      });
    }, listen);

    root.querySelectorAll<HTMLElement>("[data-toast]").forEach((button) => {
      button.addEventListener("click", (event) => {
        event.preventDefault();
        toast2(button.dataset.toast || "", { kind: button.dataset.kind || "", sub: button.dataset.sub || "" });
      }, listen);
    });

    root.querySelectorAll<HTMLButtonElement>(".k2-sw").forEach((button) => {
      button.addEventListener("click", () => {
        const on = button.getAttribute("aria-checked") !== "true";
        button.setAttribute("aria-checked", String(on));
      }, listen);
    });

    // The Designer's demo pages: their buttons go to fixed pages and the switches filter the DOM.
    // Live pages render their own links and filter in React, so none of this runs there.
    const demo = Boolean(root.querySelector(".statusbar .demo"));

    const help = root.querySelector<HTMLButtonElement>("button#help");
    help?.addEventListener("click", () => {
      location.href = "/help/client-home-screen";
    }, listen);
    if (demo) root.querySelector<HTMLButtonElement>("#cont")?.addEventListener("click", () => {
      location.href = "/portal/upload";
    }, listen);
    if (demo) root.querySelector<HTMLButtonElement>("#pay")?.addEventListener("click", () => {
      location.href = "/portal/pay";
    }, listen);

    if (demo) root.querySelectorAll<HTMLElement>(".seg[role=radiogroup], .seg[role=group]").forEach((group) => {
      group.addEventListener("click", (event) => {
        const button = (event.target as HTMLElement).closest("button");
        if (!button || !group.contains(button)) return;
        const label = button.textContent || "";
        group.querySelectorAll("button").forEach((item) => {
          const on = item === button;
          item.setAttribute("aria-checked", String(on));
          if (item.getAttribute("role") === "radio") item.tabIndex = on ? 0 : -1;
        });
        const thumb = group.querySelector<HTMLElement>(".k2-rs-th");
        if (thumb) {
          const box = group.getBoundingClientRect();
          const own = button.getBoundingClientRect();
          thumb.style.left = `${own.left - box.left}px`;
          thumb.style.right = `${box.right - own.right}px`;
          thumb.style.width = "auto";
        }
        if (!/Needs you|Accepted|All/.test(label) || !root.querySelector("#pc .fcard")) return;
        root.querySelectorAll<HTMLElement>("#pc .fcard").forEach((card) => {
          const status = card.querySelector(".states")?.textContent || "";
          const hidden = /Needs you/.test(label) ? !/Changes needed|Requested|Quarantined|Check failed|Expired/.test(status) : /Accepted/.test(label) ? !/Accepted/.test(status) : false;
          card.hidden = hidden;
          const alert = card.nextElementSibling;
          if (alert instanceof HTMLElement && alert.classList.contains("alert")) alert.hidden = hidden;
        });
      }, listen);
    });

    const params = new URLSearchParams(location.search);
    const empty = EMPTY[page];
    if (demo && params.has("empty") && empty) {
      const pc = root.querySelector("#pc");
      const heading = pc?.querySelector(".ph");
      if (pc) {
        const [name, title, copy, action] = empty;
        pc.innerHTML = `${heading ? heading.outerHTML : ""}<div class="panel rv" style="--i:1"><div class="emp">${art(name, 88)}<b>${title}</b><small>${copy}</small>${action ? `<div class="emp-a">${action}</div>` : ""}</div></div>`;
      }
    }

    // The demo pay page walks the Designer's states; the live pay page uses Stripe's Payment Element.
    if (demo && page === "pay") armPay(root, listen);
    if (demo && page === "upload") armUpload(root, listen);
    if (demo && narrow()) armSwipe(root);
    if (demo) armDocs(root, listen);

    const sum = root.querySelector<HTMLDetailsElement>("#sum");
    if (sum && window.matchMedia("(max-width:860px)").matches) sum.open = false;

    return () => ac.abort();
  }, [page, ref]);
}

function armPay(root: HTMLElement, listen: AddEventListenerOptions) {
  const state = new URLSearchParams(location.search).get("state") || "ready";
  const press = () => {
    if (root.dataset.stripe === "1") return;
    root.querySelector("#card")?.classList.add("busy");
    for (const id of ["go", "go2"]) {
      const button = root.querySelector<HTMLButtonElement>(`#${id}`);
      if (!button) continue;
      button.classList.add("is-loading");
      button.setAttribute("aria-busy", "true");
    }
    window.setTimeout(() => {
      location.href = `?state=${nextPrototypePayState(state)}`;
    }, 1100);
  };
  root.querySelector("#go")?.addEventListener("click", press, listen);
  root.querySelector("#go2")?.addEventListener("click", press, listen);
}

function armUpload(root: HTMLElement, listen: AddEventListenerOptions) {
  const steps = [...root.querySelectorAll<HTMLElement>(".fstep")];
  const items = [...root.querySelectorAll<HTMLElement>("#stp li")];
  if (!steps.length) return;
  let current = 0;
  const back = root.querySelector<HTMLElement>("#back");
  const next = root.querySelector<HTMLElement>("#next");
  const label = next?.querySelector<HTMLElement>(".lab");

  const addPages = () => {
    const order = root.querySelector<HTMLElement>("#ordh");
    const pages = root.querySelector<HTMLElement>("#pages");
    if (!pages || pages.childElementCount) return;
    if (order) order.hidden = false;
    const positions = ["top", "center", "bottom"];
    pages.innerHTML = [1, 2, 3]
      .map(
        (n) =>
          `<div class="pg"><div class="im" style="padding:0;overflow:hidden"><img src="/assets/docs/relationship-photos-600.webp" alt="" style="width:100%;height:100%;object-fit:cover;object-position:${positions[n - 1]}"></div><div class="ctl"><span class="num">Page ${n}</span></div></div>`,
      )
      .join("");
  };

  const send = () => {
    const box = root.querySelector<HTMLElement>("#sendbox");
    if (!box) return;
    const fail = new URLSearchParams(location.search).has("fail");
    box.innerHTML = `<div style="display:flex;gap:12px;align-items:center;margin-bottom:12px"><img src="/assets/vo/vo-holding-96.png" srcset="/assets/vo/vo-holding-192.png 2x" width="48" height="48" alt=""><span class="lbl">Keep this page open for a moment. Your file goes straight to your firm.</span></div><div class="pmeta"><b>Relationship photos, 3 pages</b><span class="num" id="pct">0%</span></div><div class="prog"><i id="pi"></i></div><p class="lbl" id="ph" style="margin-top:10px">Uploading…</p>`;
    let value = 0;
    const timer = window.setInterval(() => {
      value = Math.min(100, value + 18);
      root.querySelector<HTMLElement>("#pi")?.style.setProperty("--v", `${value}%`);
      const pct = root.querySelector("#pct");
      if (pct) pct.textContent = `${value}%`;
      if (value < 100) return;
      window.clearInterval(timer);
      box.innerHTML = fail
        ? `<div><b style="font-weight:500;font-size:18px">We couldn’t accept this file</b><p class="lbl" style="margin-top:4px">Our scan flagged something in it, so nobody has opened it. A fresh photo or scan of the same pages usually works.</p><div style="display:flex;gap:8px;margin-top:10px"><a class="btn sm p" href="/portal/upload?step=1">Try again</a><a class="btn sm" href="/portal/messages">Ask your firm</a></div></div>`
        : `<div><b style="font-weight:500;font-size:18px">Sent</b><p class="lbl" style="margin-top:4px">Uploaded means we have it. Your consultant still needs to accept it.</p></div>`;
    }, 120);
  };

  const go = (nextIndex: number) => {
    current = Math.max(0, Math.min(steps.length - 1, nextIndex));
    steps.forEach((step, index) => step.classList.toggle("on", index === current));
    items.forEach((item, index) => {
      item.className = index < current ? "d" : index === current ? "c" : "";
    });
    if (back) back.style.visibility = current === 0 || current === steps.length - 1 ? "hidden" : "visible";
    if (label) label.textContent = current === 3 ? "Send to your consultant" : current === 4 ? "Back to documents" : "Continue";
    if (current === 2) addPages();
    if (current === 4) send();
  };

  back?.addEventListener("click", () => go(current - 1), listen);
  next?.addEventListener("click", () => {
    if (current === 4) {
      location.href = "/portal/documents";
      return;
    }
    go(current + 1);
  }, listen);
  root.querySelector("#cam")?.addEventListener("click", () => {
    addPages();
    toast2("Camera opens on a phone", { sub: "Pages added from the demo set" });
  }, listen);
  const drop = root.querySelector<HTMLElement>("#drop");
  if (drop) {
    for (const name of ["dragenter", "dragover"] as const) {
      drop.addEventListener(name, (event) => {
        event.preventDefault();
        drop.classList.add("over");
      }, listen);
    }
    for (const name of ["dragleave", "drop"] as const) {
      drop.addEventListener(name, (event) => {
        event.preventDefault();
        drop.classList.remove("over");
        if (name === "drop") addPages();
      }, listen);
    }
  }
  const requested = new URLSearchParams(location.search).get("step");
  go(requested ? Number(requested) : 0);
}

function armSwipe(root: HTMLElement) {
  const rows = [
    ...root.querySelectorAll<HTMLElement>("#pc .fcard:not(.locked)"),
    ...root.querySelectorAll<HTMLElement>(".thread .list>a"),
  ];
  for (const row of rows) {
    if (row.closest(".k2-swr")) continue;
    const wrap = document.createElement("div");
    wrap.className = "k2-swr";
    const actions = document.createElement("div");
    actions.className = "k2-swr-a";
    const accepted = /Accepted/.test(row.querySelector(".states")?.textContent || "");
    const title = row.querySelector("h4")?.textContent || "this thread";
    actions.innerHTML = row.matches(".fcard")
      ? accepted
        ? `<button type="button" data-toast="Opened ${title}">Open</button>`
        : `<a href="/portal/upload" class="up">Upload</a>`
      : `<button type="button" class="mr">Mark read</button>`;
    const more = document.createElement("button");
    more.type = "button";
    more.className = "k2-swr-m";
    more.setAttribute("aria-label", "More actions");
    more.setAttribute("aria-expanded", "false");
    more.innerHTML = `<svg class="ic s" aria-hidden="true"><use href="/assets/icons-coreui/sprite.svg#i-more"></use></svg>`;
    const face = document.createElement("div");
    face.className = "k2-swr-fg";
    row.before(wrap);
    face.append(row, more);
    wrap.append(actions, face);
    const setOpen = (open: boolean) => {
      const width = actions.offsetWidth || 96;
      face.style.transform = open ? `translateX(${-width}px)` : "";
      wrap.classList.toggle("open", open);
      more.setAttribute("aria-expanded", String(open));
    };
    more.addEventListener("click", () => setOpen(!wrap.classList.contains("open")));
    actions.addEventListener("click", (event) => {
      const button = (event.target as HTMLElement).closest("button");
      if (!button) return;
      event.preventDefault();
      toast2(button.dataset.toast || "Marked as read");
      setOpen(false);
    });
  }
}

function armDocs(root: HTMLElement, listen: AddEventListenerOptions) {
  root.addEventListener("click", (event) => {
    const button = (event.target as HTMLElement).closest<HTMLElement>("[data-doc]");
    if (!button || !root.contains(button)) return;
    event.preventDefault();
    const name = button.dataset.doc || "";
    const title = button.dataset.docT || "Preview";
    let dialog = document.getElementById("docPrev") as HTMLDialogElement | null;
    if (!dialog) {
      document.body.insertAdjacentHTML(
        "beforeend",
        `<dialog class="dlg doc-prev" id="docPrev" aria-labelledby="docPrevH"><div class="dh"><h2 id="docPrevH"></h2><button class="x" aria-label="Close" type="button"><svg class="ic s" aria-hidden="true"><use href="/assets/icons-coreui/sprite.svg#i-close"></use></svg></button></div><div class="db"><img alt="" width="600" height="800" decoding="async"><p class="fp-note">Sample document, fictional. Preview is an inert render; the original file is never altered.</p></div></dialog>`,
      );
      dialog = document.getElementById("docPrev") as HTMLDialogElement;
      dialog.querySelector(".x")?.addEventListener("click", () => dialog?.close());
      dialog.addEventListener("click", (click) => {
        if (click.target === dialog) dialog?.close();
      });
    }
    const heading = dialog.querySelector("h2");
    if (heading) heading.textContent = title;
    const image = dialog.querySelector("img");
    if (image) {
      image.src = `/assets/docs/${name}-1200.webp`;
      image.alt = `Preview: ${title}`;
    }
    dialog.showModal();
  }, listen);
}
