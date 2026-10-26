"use client";

/** Ports of the designer's kit helpers used by the auth screens. Timings match kit2.js / rb.js. */

const ASSET = "/assets/icons-coreui/sprite.svg";

export function icon(name: string, cls = ""): string {
  return `<svg class="ic ${cls}" aria-hidden="true"><use href="${ASSET}#i-${name}"/></svg>`;
}

export function reducedMotion(): boolean {
  return typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
}

const SPIN = `<svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="10" cy="10" r="7.5" fill="none" stroke="currentColor" stroke-opacity=".25" stroke-width="2.2"/><path class="ring" d="M10 2.5a7.5 7.5 0 0 1 7.5 7.5" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg>`;

const MARK = `<svg class="k2-mark" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M7.5 12.25 10.5 15.25 16.75 8.75" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

export function runBtn(button: HTMLElement, outcome: "ok" | "fail" = "ok", ms = 1100) {
  if (button.classList.contains("is-loading")) return;
  const spin = button.querySelector<HTMLElement>(".spin");
  button.classList.add("is-loading");
  button.setAttribute("aria-busy", "true");
  if (spin) spin.innerHTML = SPIN;
  window.setTimeout(() => {
    button.classList.remove("is-loading");
    button.removeAttribute("aria-busy");
    button.classList.add(outcome === "ok" ? "is-ok" : "is-fail");
    if (spin) {
      spin.innerHTML = `<span class="sw-in" style="display:flex;gap:6px;align-items:center">${icon(outcome === "ok" ? "check-circle" : "alert", "s")}${outcome === "ok" ? "Saved" : "Retry"}</span>`;
      if (outcome === "ok") {
        const markHost = spin.querySelector("svg");
        if (markHost) markHost.outerHTML = MARK;
      }
    }
    if (outcome === "ok") {
      window.setTimeout(() => {
        button.classList.remove("is-ok");
        if (spin) spin.innerHTML = "";
      }, 1600);
    }
  }, ms);
}

/** Loading state while a request is in flight. Pair with `settleBtn` once the server answers. */
export function busyBtn(button: HTMLElement) {
  const spin = button.querySelector<HTMLElement>(".spin");
  button.classList.add("is-loading");
  button.setAttribute("aria-busy", "true");
  if (spin) spin.innerHTML = SPIN;
}

/** Shows the server's answer on a busy button. Resolves after the confirmation has been visible. */
export function settleBtn(button: HTMLElement, outcome: "ok" | "fail"): Promise<void> {
  button.classList.remove("is-loading");
  runBtn(button, outcome, 0);
  return new Promise((resolve) => window.setTimeout(resolve, outcome === "ok" ? 450 : 0));
}

export function clearBtn(button: HTMLElement) {
  button.classList.remove("is-loading", "is-ok", "is-fail");
  button.removeAttribute("aria-busy");
  const spin = button.querySelector(".spin");
  if (spin) spin.innerHTML = "";
}

type ToastOpts = { kind?: string; sub?: string; undo?: boolean; icon?: string; duration?: number };

export function toast2(title: string, opts: ToastOpts = {}) {
  let wrap = document.querySelector<HTMLElement>(".toasts");
  if (!wrap) {
    wrap = document.createElement("div");
    wrap.className = "toasts";
    wrap.setAttribute("role", "status");
    wrap.setAttribute("aria-live", "polite");
    document.body.append(wrap);
  }
  const kind = opts.kind ?? "";
  const ic = opts.icon || ({ ok: "check-circle", bad: "x-circle", warn: "alert" } as Record<string, string>)[kind] || "info";
  const toast = document.createElement("div");
  toast.className = `toast k2-swt ${kind}`.trim();
  toast.tabIndex = 0;
  toast.setAttribute("aria-label", `${title}. Swipe down or press Escape to dismiss.`);
  toast.innerHTML = `${icon(ic, "s")}<span class="tx"><b>${escapeHtml(title)}</b>${opts.sub ? `<small>${escapeHtml(opts.sub)}</small>` : ""}</span>${opts.undo ? '<button type="button">Undo</button>' : ""}<i class="k2-fuse" aria-hidden="true"></i>`;
  wrap.append(toast);
  const ms = opts.duration || (kind === "bad" ? 7000 : 4200);
  const fuseEl = toast.querySelector(".k2-fuse");
  const fuse = fuseEl?.animate([{ transform: "scaleX(1)" }, { transform: "scaleX(0)" }], {
    duration: ms,
    easing: "linear",
    fill: "forwards",
  });
  let gone = false;
  let y0: number | null = null;
  let started = 0;
  let dy = 0;
  const kill = () => {
    if (gone) return;
    gone = true;
    fuse?.cancel();
    toast.classList.add("out");
    window.setTimeout(() => toast.remove(), 160);
  };
  if (fuse) fuse.onfinish = kill;
  const hold = () => {
    if (fuse && fuse.playState === "running") fuse.pause();
  };
  const go = () => {
    if (!gone && !toast.matches(":hover") && !toast.contains(document.activeElement) && !document.hidden && y0 == null) {
      fuse?.play();
    }
  };
  toast.addEventListener("pointerenter", hold);
  toast.addEventListener("pointerleave", go);
  toast.addEventListener("focusin", hold);
  toast.addEventListener("focusout", () => window.setTimeout(go));
  document.addEventListener("visibilitychange", () => (document.hidden ? hold() : go()));
  toast.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      event.stopPropagation();
      kill();
    }
  });
  toast.addEventListener("pointerdown", (event) => {
    if ((event.target as HTMLElement).closest("button")) return;
    y0 = event.clientY;
    started = performance.now();
    dy = 0;
    toast.setPointerCapture(event.pointerId);
    toast.classList.add("drag");
    hold();
  });
  toast.addEventListener("pointermove", (event) => {
    if (y0 == null) return;
    const delta = event.clientY - y0;
    if (Math.abs(delta) < 3) return;
    dy = delta < 0 ? -24 * (1 - Math.exp(delta / 24)) : delta;
    toast.style.transform = `translateY(${dy}px)`;
    toast.style.opacity = String(dy > 0 ? Math.max(0.35, 1 - dy / 140) : 1);
  });
  const end = () => {
    if (y0 == null) return;
    const velocity = dy / Math.max(1, performance.now() - started);
    y0 = null;
    toast.classList.remove("drag");
    if (dy > 40 || (velocity > 0.11 && dy > 8)) {
      gone = true;
      fuse?.cancel();
      toast.animate(
        [
          { transform: `translateY(${dy}px)`, opacity: Number(toast.style.opacity) || 1 },
          { transform: `translateY(${dy + toast.offsetHeight}px)`, opacity: 0 },
        ],
        { duration: reducedMotion() ? 1 : 200, easing: "cubic-bezier(.23,1,.32,1)", fill: "forwards" },
      );
      window.setTimeout(() => toast.remove(), 200);
    } else {
      toast.style.transform = "";
      toast.style.opacity = "";
      go();
    }
  };
  toast.addEventListener("pointerup", end);
  toast.addEventListener("pointercancel", end);
  if (opts.undo) {
    toast.querySelector("button")?.addEventListener("click", () => {
      kill();
      toast2("Undone", { kind: "ok" });
    });
  }
  return toast;
}

export function morphText(el: HTMLElement | null, text: string) {
  if (!el || el.textContent === text) return;
  if (reducedMotion()) {
    el.textContent = text;
    return;
  }
  const animation = el.animate(
    [
      { opacity: 1, filter: "blur(0)" },
      { opacity: 0, filter: "blur(4px)" },
    ],
    { duration: 120, easing: "ease-out" },
  );
  animation.onfinish = () => {
    el.textContent = text;
    el.animate(
      [
        { opacity: 0, filter: "blur(4px)", transform: "translateY(3px)" },
        { opacity: 1, filter: "blur(0)", transform: "none" },
      ],
      { duration: 200, easing: "cubic-bezier(.23,1,.32,1)" },
    );
  };
}

export function k2Count(el: HTMLElement, value: string) {
  const text = String(value);
  if (el.dataset.len !== String(text.length)) {
    el.innerHTML =
      text
        .split("")
        .map((ch) =>
          /\d/.test(ch)
            ? `<span class="k2-dg"><span class="k2-st">${[...Array(10).keys()].map((n) => `<span>${n}</span>`).join("")}</span></span>`
            : `<span>${ch}</span>`,
        )
        .join("") + `<span class="k2-sr">${text}</span>`;
    el.dataset.len = String(text.length);
    el.classList.add("k2-count");
  }
  const digits = [...el.querySelectorAll<HTMLElement>(".k2-st")];
  let index = 0;
  text.split("").forEach((ch) => {
    if (/\d/.test(ch)) {
      const digit = digits[index];
      if (digit) digit.style.transform = `translateY(${-Number(ch)}em)`;
      index += 1;
    }
  });
  const sr = el.querySelector(".k2-sr");
  if (sr) sr.textContent = text;
}

export function k2Slider(
  el: HTMLElement,
  { min = 1, max = 15, value = 10, step = 1, unit = "years", label = "Value" }: {
    min?: number;
    max?: number;
    value?: number;
    step?: number;
    unit?: string;
    label?: string;
  } = {},
) {
  el.classList.add("k2-sl");
  el.innerHTML = `<div class="k2-sl-top"><span>${label}</span><b class="num"><span class="v"></span> ${unit}</b></div><div class="k2-sl-body"><span class="k2-sl-cap">${min}</span><div class="k2-sl-tr" role="slider" tabindex="0" aria-label="${label}" aria-valuemin="${min}" aria-valuemax="${max}"><i class="k2-sl-fill"></i><i class="k2-sl-th"></i></div><span class="k2-sl-cap">${max}</span></div>`;
  const track = el.querySelector<HTMLElement>(".k2-sl-tr");
  const fill = el.querySelector<HTMLElement>(".k2-sl-fill");
  const thumb = el.querySelector<HTMLElement>(".k2-sl-th");
  const out = el.querySelector<HTMLElement>(".v");
  if (!track || !fill || !thumb || !out) return;
  let current = value;
  let drag = false;
  const draw = () => {
    const pct = ((current - min) / (max - min)) * 100;
    fill.style.width = `${pct}%`;
    thumb.style.left = `${pct}%`;
    out.textContent = String(current);
    track.setAttribute("aria-valuenow", String(current));
    track.setAttribute("aria-valuetext", `${current} ${unit}`);
  };
  const at = (x: number) => {
    const rect = track.getBoundingClientRect();
    const raw = (x - rect.left) / rect.width;
    const over = raw < 0 ? raw : raw > 1 ? raw - 1 : 0;
    track.style.transform = reducedMotion() || !over ? "" : `scaleX(${1 + Math.min(0.06, Math.abs(over) * 0.12)})`;
    track.style.transformOrigin = over < 0 ? "right" : "left";
    current = Math.round((min + Math.max(0, Math.min(1, raw)) * (max - min)) / step) * step;
    draw();
  };
  track.addEventListener("pointerdown", (event) => {
    drag = true;
    track.setPointerCapture(event.pointerId);
    track.classList.add("on");
    at(event.clientX);
  });
  track.addEventListener("pointermove", (event) => {
    if (drag) at(event.clientX);
  });
  const up = () => {
    drag = false;
    track.classList.remove("on");
    track.style.transform = "";
  };
  track.addEventListener("pointerup", up);
  track.addEventListener("pointercancel", up);
  track.addEventListener("keydown", (event) => {
    const delta: Record<string, number> = {
      ArrowRight: step,
      ArrowUp: step,
      ArrowLeft: -step,
      ArrowDown: -step,
      PageUp: step * 5,
      PageDown: -step * 5,
    };
    if (event.key === "Home") current = min;
    else if (event.key === "End") current = max;
    else if (event.key in delta) current = Math.max(min, Math.min(max, current + delta[event.key]));
    else return;
    event.preventDefault();
    draw();
  });
  draw();
}

let sparkBound = false;
export function k2Spark(button: HTMLElement | null) {
  if (!button) return;
  if (!sparkBound) {
    sparkBound = true;
    const canvas = document.createElement("canvas");
    Object.assign(canvas.style, { position: "fixed", inset: "0", pointerEvents: "none", zIndex: "95" });
    document.body.append(canvas);
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    let sparks: { x: number; y: number; a: number; t: number }[] = [];
    const fit = () => {
      canvas.width = innerWidth * devicePixelRatio;
      canvas.height = innerHeight * devicePixelRatio;
      ctx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
    };
    fit();
    addEventListener("resize", fit);
    const draw = (now: number) => {
      ctx.clearRect(0, 0, innerWidth, innerHeight);
      sparks = sparks.filter((spark) => {
        const p = (now - spark.t) / 280;
        if (p >= 1) return false;
        const eased = p * (2 - p);
        const dist = eased * 22;
        const length = 10 * (1 - eased);
        ctx.strokeStyle = "#0075DE";
        ctx.lineWidth = 2;
        ctx.lineCap = "round";
        ctx.beginPath();
        ctx.moveTo(spark.x + dist * Math.cos(spark.a), spark.y + dist * Math.sin(spark.a));
        ctx.lineTo(spark.x + (dist + length) * Math.cos(spark.a), spark.y + (dist + length) * Math.sin(spark.a));
        ctx.stroke();
        return true;
      });
      if (sparks.length) requestAnimationFrame(draw);
    };
    document.addEventListener("click", (event) => {
      const target = event.target as HTMLElement | null;
      if (!target?.closest("[data-spark], .wz-foot [data-next]")) return;
      if (reducedMotion()) return;
      const t = performance.now();
      for (let i = 0; i < 8; i += 1) sparks.push({ x: event.clientX, y: event.clientY, a: (2 * Math.PI * i) / 8, t });
      if (sparks.length === 8) requestAnimationFrame(draw);
    });
  }
  button.dataset.spark = "1";
}

export function openDlg(id: string, from?: HTMLElement) {
  const dialog = document.getElementById(id) as HTMLDialogElement | null;
  if (!dialog?.showModal) return;
  dialog.dataset.fromId = from?.id ?? "";
  dialog.showModal();
  const focusable = [...dialog.querySelectorAll<HTMLElement>("button,[href],input,select,textarea,[tabindex]:not([tabindex='-1'])")];
  (dialog.querySelector<HTMLElement>("[autofocus]") ?? focusable[0])?.focus();
  dialog.onkeydown = (event) => {
    if (event.key !== "Tab") return;
    const items = focusable.filter((item) => !item.hasAttribute("disabled"));
    const first = items[0];
    const last = items[items.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      last?.focus();
      event.preventDefault();
    } else if (!event.shiftKey && document.activeElement === last) {
      first?.focus();
      event.preventDefault();
    }
  };
  dialog.oncancel = (event) => {
    event.preventDefault();
    closeDlg(id);
  };
  dialog.onclick = (event) => {
    if (event.target === dialog) closeDlg(id);
  };
}

export function closeDlg(id: string) {
  const dialog = document.getElementById(id) as HTMLDialogElement | null;
  if (!dialog) return;
  dialog.classList.add("out");
  window.setTimeout(() => {
    dialog.classList.remove("out");
    dialog.close();
  }, 150);
}

/**
 * A setup connection row's Connect. With `href` the connection is set up in Settings, opened in a
 * new tab so setup stays where it is; without it the provider isn't built yet, and the row says so.
 */
export function connectOrRun(button: HTMLElement, href?: string) {
  if (href && href.startsWith("/") && !href.startsWith("//")) {
    window.open(href, "_blank", "noopener");
    return;
  }
  const conn = button.closest(".conn");
  if (conn) {
    // The Designer markup names the provider as the label's own text, before its <small> description:
    // <div class="conn"><img/><div>Google Calendar<small>…</small></div><button/></div>
    const label = conn.querySelector(":scope > div");
    const own = label
      ? Array.from(label.childNodes)
          .filter((node) => node.nodeType === Node.TEXT_NODE)
          .map((node) => node.textContent ?? "")
          .join("")
          .trim()
      : "";
    const name = own || conn.querySelector("b, strong")?.textContent?.trim() || "This connection";
    toast2(`${name} is coming later`, {
      kind: "warn",
      sub: "It isn’t available in Casevoya yet. You can skip this step.",
    });
    return;
  }
  runBtn(button);
}

export function voPose(pose = "wave", size = 96): string {
  const blue = "#0075DE";
  const light = "#62aef0";
  const eyes: Record<string, string> = {
    sleep: `<path d="M37 61 q5 3 10 0M53 61 q5 3 10 0" fill="none" stroke="#111" stroke-width="2.4" stroke-linecap="round"/>`,
    worried: `<ellipse cx="42" cy="61" rx="3.2" ry="4" fill="#111"/><ellipse cx="58" cy="61" rx="3.2" ry="4" fill="#111"/><path d="M36 53 l9 -2M64 53 l-9 -2" stroke="#111" stroke-width="2" stroke-linecap="round"/>`,
    cheer: `<path d="M37 61 q5 -5 10 0M53 61 q5 -5 10 0" fill="none" stroke="#111" stroke-width="2.4" stroke-linecap="round"/>`,
  };
  const mouths: Record<string, string> = {
    worried: `<path d="M45 72 q5 -3 10 0" fill="none" stroke="#111" stroke-width="2.2" stroke-linecap="round"/>`,
    cheer: `<path d="M44 68 q6 8 12 0z" fill="#111"/>`,
    sleep: `<ellipse cx="50" cy="71" rx="2.4" ry="1.8" fill="#111"/>`,
  };
  const eye = eyes[pose] || `<ellipse cx="42" cy="60" rx="3.4" ry="3.9" fill="#111"/><ellipse cx="58" cy="60" rx="3.4" ry="3.9" fill="#111"/><circle cx="43.1" cy="58.7" r="1" fill="#fff"/><circle cx="59.1" cy="58.7" r="1" fill="#fff"/>`;
  const mouth = mouths[pose] || `<path d="M45 70 q5 4 10 0" fill="none" stroke="#111" stroke-width="2.2" stroke-linecap="round"/>`;
  const arm = (d: string, cls = "") => `<path class="${cls}" d="${d}" fill="none" stroke="${blue}" stroke-width="7" stroke-linecap="round"/>`;
  const extra: Record<string, string> = {
    wave: arm("M80 60 q10 -8 8 -24", "m-wave"),
    point: arm("M80 62 q12 -2 18 -10") + `<circle cx="99" cy="51" r="3" fill="${blue}"/>`,
    holding:
      `<g transform="rotate(-8 74 72)"><rect x="62" y="56" width="30" height="38" rx="3" fill="#fff" stroke="#111" stroke-width="2"/><path d="M68 66h18M68 73h18M68 80h11" stroke="#c9c5c0" stroke-width="2.4" stroke-linecap="round"/></g>` +
      arm("M22 66 q-8 6 -6 14") +
      arm("M78 70 q4 4 2 10"),
    cheer:
      arm("M22 56 q-10 -10 -8 -26") +
      arm("M78 56 q10 -10 8 -26") +
      `<path d="M12 22l2 6M8 30l6 -1M88 22l-2 6M92 30l-6 -1" stroke="#ffb110" stroke-width="2.4" stroke-linecap="round"/>`,
    worried: arm("M24 70 q-6 8 2 12") + arm("M76 70 q6 8 -2 12") + `<path d="M84 34 q3 5 0 8 q-3 -3 0 -8z" fill="${light}"/>`,
    search:
      `<circle cx="82" cy="72" r="11" fill="#fff" fill-opacity=".6" stroke="#111" stroke-width="3"/><path d="M90 80l8 8" stroke="#111" stroke-width="4" stroke-linecap="round"/>` +
      arm("M76 64 q4 2 4 6"),
    lock: `<rect x="66" y="70" width="26" height="22" rx="5" fill="#ffb110"/><path d="M71 70v-6a8 8 0 0 1 16 0v6" fill="none" stroke="#111" stroke-width="3"/><circle cx="79" cy="80" r="2.6" fill="#111"/>`,
  };
  const tilt: Record<string, string> = { sleep: "rotate(-6 50 90)", worried: "", cheer: "translate(0 -3)" };
  const labels: Record<string, string> = {
    wave: "waving hello",
    point: "pointing to the next step",
    holding: "holding a document",
    cheer: "celebrating",
    worried: "worried, something needs attention",
    search: "searching",
    lock: "holding a lock, private",
  };
  return `<svg class="mascot vo-pose p-${pose}" width="${size}" height="${size}" viewBox="0 0 100 100" role="img" aria-label="Vo ${labels[pose] || pose}" style="overflow:visible"><g class="m-body" style="transform-origin:50px 90px" transform="${tilt[pose] || ""}"><path d="M38 20 C 42 28, 46 32, 50 31 C 55 26, 60 18, 68 14" fill="none" stroke="${blue}" stroke-width="7" stroke-linecap="round"/><ellipse cx="50" cy="60" rx="32" ry="30" fill="${blue}"/><ellipse cx="50" cy="64" rx="21" ry="17" fill="#fff"/>${eye}${mouth}<ellipse cx="34" cy="70" rx="3.4" ry="2" fill="${light}" opacity=".7"/><ellipse cx="66" cy="70" rx="3.4" ry="2" fill="${light}" opacity=".7"/></g>${extra[pose] || ""}</svg>`;
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch] ?? ch);
}
