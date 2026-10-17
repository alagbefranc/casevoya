"use client";

import { useEffect, useRef, type RefObject } from "react";
import { clearBtn, icon, k2Count, k2Slider, k2Spark, morphText, runBtn, toast2, voPose } from "./kit";

export type PortResult =
  | { ok: true; href?: string; codes?: string[] }
  | { ok: false; state?: "error" | "locked"; message: string }
  | null;

export type PortEvent =
  | { type: "click"; page: string; step: number; el: HTMLElement; root: HTMLElement }
  | { type: "otp"; page: string; code: string; then: string; otp: HTMLElement; root: HTMLElement }
  | { type: "step"; page: string; step: number; root: HTMLElement };

const CHECK = `<svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>`;

function all<T extends Element>(root: ParentNode, selector: string) {
  return [...root.querySelectorAll<T>(selector)];
}

export function usePort(
  ref: RefObject<HTMLElement | null>,
  page: string,
  onAction?: (event: PortEvent) => Promise<PortResult>,
) {
  const actionRef = useRef(onAction);
  useEffect(() => {
    actionRef.current = onAction;
  }, [onAction]);

  useEffect(() => {
    const root = ref.current;
    if (!root || root.dataset.ready === "1") return;
    const ac = new AbortController();
    const listen = { signal: ac.signal };
    let current = -1;
    let stopped = false;

    const pose = (name: string, where?: Element | null) => {
      const host =
        where ||
        root.querySelector("[data-step].on .au-vo, [data-step].on .wz-vo") ||
        root.querySelector(".au-vo,.wz-vo");
      if (!host) return;
      const existing = host.querySelector("svg.vo-pose");
      const wrap = document.createElement("span");
      wrap.innerHTML = voPose(name, Number((host as HTMLElement).dataset.size || 56));
      const svg = wrap.firstChild as Element | null;
      if (!svg) return;
      svg.classList.add("sw-in");
      if (existing) existing.replaceWith(svg);
      else host.prepend(svg);
    };

    const go = (next: number, push = true) => {
      const panels = all<HTMLElement>(root, "[data-step]");
      if (!panels.length) return;
      const index = Math.max(0, Math.min(panels.length - 1, next));
      const back = index < current;
      panels.forEach((panel) => {
        const on = Number(panel.dataset.step) === index;
        panel.classList.toggle("on", on);
        panel.classList.toggle("back", on && back);
      });
      all<HTMLElement>(root, ".stp li").forEach((item, i) => {
        item.classList.toggle("done", i < index);
        item.classList.toggle("now", i === index);
        const badge = item.querySelector(".n");
        if (badge) badge.innerHTML = i < index ? CHECK : String(i + 1);
        item.querySelector("button")?.setAttribute("aria-current", i === index ? "step" : "false");
      });
      const rail = root.querySelector<HTMLElement>(".stp");
      if (rail) rail.style.setProperty("--p", (index / Math.max(1, panels.length - 1)).toFixed(3));
      all<HTMLElement>(root, ".dots").forEach((dots) => {
        [...dots.children].forEach((dot, k) => dot.classList.toggle("on", k <= index));
      });
      all<HTMLElement>(root, "[data-stepname]").forEach((label) => {
        const title = panels[index]?.dataset.title || "";
        const text = `Step ${index + 1} of ${panels.length}${title ? ` · ${title}` : ""}`;
        if (current < 0) label.textContent = text;
        else morphText(label, text);
      });
      all<HTMLElement>(root, ".wz-foot [data-prev]").forEach((button) => {
        button.style.visibility = index === 0 ? "hidden" : "visible";
      });
      const nextButton = root.querySelector<HTMLElement>(".wz-foot [data-next]");
      if (nextButton) {
        const cta = panels[index]?.dataset.cta;
        morphText(nextButton.querySelector<HTMLElement>(".lab"), cta || "Continue");
        nextButton.style.display = panels[index]?.dataset.nofoot != null ? "none" : "";
      }
      if (current >= 0) {
        const heading = panels[index]?.querySelector<HTMLElement>("h1,h2");
        if (heading) {
          heading.tabIndex = -1;
          heading.focus({ preventScroll: true });
        }
        root.querySelector<HTMLElement>(".wz-sheet")?.scrollTo?.(0, 0);
        window.scrollTo(0, 0);
      }
      current = index;
      if (push) {
        const url = new URL(location.href);
        url.searchParams.set("step", String(index));
        history.replaceState(null, "", url);
      }
      const nextPose = panels[index]?.dataset.vo;
      if (nextPose) pose(nextPose);
      if (actionRef.current) void actionRef.current({ type: "step", page, step: index, root });
    };

    const validate = (scope: ParentNode) => {
      const bad: [string, string][] = [];
      all<HTMLElement>(scope, ".fld[data-req]").forEach((field) => {
        const input = field.querySelector<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>("input,select,textarea");
        let ok = Boolean(input && (input.type === "checkbox" ? (input as HTMLInputElement).checked : input.value.trim() !== ""));
        if (ok && input?.type === "email") ok = /.+@.+\..+/.test(input.value);
        if (ok && field.dataset.min && input) ok = input.value.length >= Number(field.dataset.min);
        field.classList.toggle("err", !ok);
        if (!ok && input) bad.push([input.id, field.dataset.req || "Check this field"]);
      });
      all<HTMLElement>(scope, ".check[data-req]").forEach((field) => {
        const input = field.querySelector<HTMLInputElement>("input");
        const ok = Boolean(input?.checked);
        field.classList.toggle("cerr", !ok);
        if (!ok && input) bad.push([input.id, field.dataset.req || "Check this box"]);
      });
      let summary = scope.querySelector<HTMLElement>(".errsum");
      if (bad.length) {
        if (!summary) {
          summary = document.createElement("div");
          summary.className = "errsum";
          summary.setAttribute("role", "alert");
          summary.tabIndex = -1;
          scope.prepend(summary);
        }
        summary.innerHTML = `<h4>${icon("alert", "s")}${bad.length === 1 ? "One thing to fix" : `${bad.length} things to fix`}</h4><ul>${bad.map(([id, message]) => `<li><a href="#${id}">${message}</a></li>`).join("")}</ul>`;
        summary.focus();
        pose("worried");
      } else summary?.remove();
      return !bad.length;
    };

    const showState = (state: string | null) => {
      all<HTMLElement>(root, "[data-show]").forEach((alert) => {
        alert.style.display = alert.dataset.show === state ? "flex" : "none";
      });
      if (page === "sign-in" && state === "error") {
        document.getElementById("pw")?.closest(".fld")?.classList.add("err");
        window.setTimeout(() => pose("worried"), 50);
      }
      if (page === "sign-in" && state === "locked") {
        const button = root.querySelector<HTMLElement>('[data-href="/mfa"]');
        if (button && !button.dataset.lockedNote) {
          button.setAttribute("aria-disabled", "true");
          button.dataset.lockedNote = "1";
          button.insertAdjacentHTML(
            "afterend",
            `<p class="why">${icon("clock", "s")}Try again at 10:42 Toronto time, or reset your password.</p>`,
          );
        }
        window.setTimeout(() => pose("worried"), 50);
      }
      if (page === "accept-staff" && state) {
        const form = root.querySelector<HTMLElement>("[data-form]");
        if (form) form.style.display = "none";
        const badge = root.querySelector<HTMLElement>(".inv .meta .bd.unv");
        if (badge) badge.innerHTML = state === "expired" ? "<i></i>Expired 16 Oct" : "<i></i>Used 15 Oct";
        window.setTimeout(() => pose(state === "expired" ? "worried" : "search"), 50);
      }
    };

    const finishOtp = (otp: HTMLElement, code: string) => {
      const inputs = all<HTMLInputElement>(otp, "input");
      const message = otp.parentElement?.querySelector<HTMLElement>(".otp-msg");
      if (code === "000000") {
        otp.classList.add("err", "nudge");
        otp.classList.remove("ok");
        window.setTimeout(() => otp.classList.remove("nudge"), 200);
        if (message) {
          message.className = "emsg otp-msg";
          message.style.display = "flex";
          message.innerHTML = `${icon("alert", "s")}<span>That code didn’t match. Codes change every 30 seconds, so use the newest one.</span>`;
        }
        pose("worried");
        inputs.forEach((input) => {
          input.value = "";
          input.classList.remove("filled");
        });
        inputs[0]?.focus();
        return;
      }
      otp.classList.add("ok");
      otp.classList.remove("err");
      inputs.forEach((input) => input.blur());
      if (message) {
        message.style.display = "flex";
        message.className = "saved otp-msg";
        message.innerHTML = `${icon("check-circle", "s")}<span>Code accepted</span>`;
      }
      pose("cheer");
      const then = otp.dataset.then;
      window.setTimeout(() => {
        if (!then || stopped) return;
        if (then.startsWith("#")) go(Number(then.slice(1)));
        else location.href = then;
      }, 900);
    };

    const bindOtp = () => {
      all<HTMLElement>(root, ".otp").forEach((otp) => {
        const inputs = all<HTMLInputElement>(otp, "input");
        const done = () => {
          const code = inputs.map((input) => input.value).join("");
          if (code.length < 6) return;
          otp.classList.remove("err", "ok");
          if (!actionRef.current || code === "000000") {
            finishOtp(otp, code);
            return;
          }
          void actionRef.current({ type: "otp", page, code, then: otp.dataset.then || "", otp, root }).then((result) => {
            if (stopped) return;
            if (result && result.ok === false) {
              finishOtp(otp, "000000");
              return;
            }
            if (result && result.ok && result.codes) {
              const slots = all<HTMLElement>(root, ".codes span");
              result.codes.slice(0, slots.length).forEach((value, index) => {
                if (slots[index]) slots[index].textContent = value;
              });
            }
            if (result && result.ok && result.href) otp.dataset.then = result.href;
            finishOtp(otp, code);
          });
        };
        inputs.forEach((input, index) => {
          input.addEventListener("input", () => {
            input.value = input.value.replace(/\D/g, "").slice(-1);
            input.classList.toggle("filled", Boolean(input.value));
            if (input.value && index < 5) inputs[index + 1]?.focus();
            done();
          }, listen);
          input.addEventListener("keydown", (event) => {
            if (event.key === "Backspace" && !input.value && index > 0) {
              const prev = inputs[index - 1];
              prev?.focus();
              if (prev) {
                prev.value = "";
                prev.classList.remove("filled");
              }
            }
            if (event.key === "ArrowLeft" && index > 0) inputs[index - 1]?.focus();
            if (event.key === "ArrowRight" && index < 5) inputs[index + 1]?.focus();
          }, listen);
          input.addEventListener("paste", (event) => {
            const text = (event.clipboardData?.getData("text") || "").replace(/\D/g, "").slice(0, 6);
            if (!text) return;
            event.preventDefault();
            text.split("").forEach((char, j) => {
              if (!inputs[j]) return;
              inputs[j].value = char;
              inputs[j].classList.add("filled");
            });
            inputs[Math.min(5, text.length)]?.focus();
            done();
          }, listen);
        });
      });
    };

    const bindPw = () => {
      all<HTMLElement>(root, ".pw").forEach((wrap) => {
        const input = wrap.querySelector<HTMLInputElement>("input");
        const button = wrap.querySelector<HTMLButtonElement>(".eye");
        if (button && input) {
          button.innerHTML = icon("eye", "s");
          button.onclick = () => {
            const show = input.type === "password";
            input.type = show ? "text" : "password";
            button.setAttribute("aria-label", show ? "Hide password" : "Show password");
            button.setAttribute("aria-pressed", String(show));
          };
        }
        const rules = wrap.parentElement?.querySelector(".rules");
        if (rules && input) {
          const update = () => {
            const value = input.value;
            const flags: Record<string, boolean> = {
              len: value.length >= 12,
              mix: /[a-z]/i.test(value) && /[^a-z]/i.test(value),
              known: value.length > 0 && !/password|casevoya|123456|qwerty/i.test(value),
            };
            rules.querySelectorAll("li").forEach((item) => {
              const key = (item as HTMLElement).dataset.r || "";
              item.classList.toggle("ok", Boolean(flags[key]));
            });
          };
          input.addEventListener("input", update, listen);
          update();
        }
      });
    };

    const bindResend = () => {
      all<HTMLButtonElement>(root, "[data-resend]").forEach((button) => {
        let left = Number(button.dataset.resend || 30);
        if (!button.dataset.label) button.dataset.label = button.textContent || "Send a new code";
        const label = button.dataset.label;
        const tick = () => {
          if (stopped) return;
          if (left <= 0) {
            button.removeAttribute("aria-disabled");
            button.textContent = label;
            return;
          }
          button.setAttribute("aria-disabled", "true");
          if (!button.querySelector(".rc")) button.innerHTML = `Send a new code in 0:<span class="rc"></span>`;
          const slot = button.querySelector<HTMLElement>(".rc");
          if (slot) k2Count(slot, String(left).padStart(2, "0"));
          left -= 1;
          window.setTimeout(tick, 1000);
        };
        button.onclick = (event) => {
          event.preventDefault();
          if (button.getAttribute("aria-disabled") === "true") return;
          toast2("New code sent", { kind: "ok", sub: "Check the newest email. Older codes stop working." });
          left = 30;
          tick();
        };
        tick();
      });
    };

    const bindOpts = () => {
      all<HTMLElement>(root, '[role="radiogroup"]').forEach((group) => {
        const options = all<HTMLElement>(group, '[role="radio"]');
        options.forEach((option) => {
          option.addEventListener("click", () => {
            if (option.getAttribute("aria-disabled") === "true") return;
            options.forEach((item) => item.setAttribute("aria-checked", String(item === option)));
            group.dispatchEvent(new CustomEvent("pick", { detail: option.dataset.v || option }));
          }, listen);
        });
      });
    };

    root.querySelectorAll<HTMLElement>("[data-pose]").forEach((host) => {
      if (host.querySelector("svg.vo-pose")) return;
      host.insertAdjacentHTML("afterbegin", voPose(host.dataset.pose || "wave", Number(host.dataset.size || 56)));
    });

    const params = new URLSearchParams(location.search);
    let state = params.get("state");
    if (!state && params.get("error")) state = "error";
    showState(state);
    if (params.get("sent") === "1") {
      toast2("Check your email", { kind: "ok", sub: "Use the newest sign-in message." });
    }

    if (page === "setup") {
      const swatches = document.getElementById("sw");
      if (swatches) {
        swatches.onclick = (event) => {
          const button = (event.target as HTMLElement).closest("button");
          if (!button) return;
          swatches.querySelectorAll("button").forEach((item) => item.setAttribute("aria-pressed", String(item === button)));
          const color = button.dataset.c;
          if (color) document.getElementById("prev")?.style.setProperty("--brand", color);
        };
      }
      const slider = document.getElementById("retS");
      if (slider) k2Slider(slider, { min: 1, max: 15, value: 12, label: "Keep closed files for", unit: "years" });
      document.getElementById("retG")?.addEventListener("pick", (event) => {
        const detail = (event as CustomEvent<HTMLElement>).detail;
        const value = detail instanceof HTMLElement ? detail.dataset.v : String(detail ?? "");
        document.getElementById("retC")?.classList.toggle("on", value === "custom");
      }, listen);
      const footerNext = root.querySelector<HTMLElement>(".wz-foot [data-next]");
      if (footerNext) k2Spark(footerNext);
    }

    if (page === "accept-family" || page === "accept-sponsor") {
      const last = page === "accept-family" ? 3 : 2;
      const href = page === "accept-family" ? "/sheet/portal-olena" : "/sheet/portal-rafael";
      root.querySelector<HTMLElement>(".wz-foot [data-next]")?.addEventListener(
        "click",
        (event) => {
          if (current === last && !new URLSearchParams(location.search).has("token")) {
            event.stopImmediatePropagation();
            event.preventDefault();
            runBtn(event.currentTarget as HTMLElement);
            window.setTimeout(() => {
              location.href = href;
            }, 1300);
          }
        },
        { capture: true, signal: ac.signal },
      );
    }

    bindPw();
    bindOtp();
    bindResend();
    bindOpts();
    const step = params.get("step");
    go(step != null ? Number(step) : 0, false);
    all<HTMLElement>(root, ".fld input,.fld select,.fld textarea").forEach((input) => {
      input.addEventListener("input", () => input.closest(".fld")?.classList.remove("err"), listen);
    });
    all<HTMLButtonElement>(root, ".stp li button").forEach((button, index) => {
      button.onclick = () => {
        if (index <= current || button.closest("li")?.classList.contains("done")) go(index);
      };
    });

    root.addEventListener("click", (event) => {
      const target = (event.target as HTMLElement).closest<HTMLElement>("[data-next],[data-prev],[data-go],[data-href]");
      if (!target || !root.contains(target)) return;
      if (target.hasAttribute("data-prev")) {
        event.preventDefault();
        go(current - 1);
        return;
      }
      if (target.getAttribute("aria-disabled") === "true") {
        event.preventDefault();
        return;
      }
      const scope = root.querySelector<HTMLElement>("[data-step].on") || target.closest("form") || root;
      if (!(target.hasAttribute("data-next") || target.hasAttribute("data-go") || target.hasAttribute("data-href"))) return;
      event.preventDefault();
      if (target.dataset.novalidate == null && !validate(scope)) return;
      const after = () => {
        if (target.dataset.href) location.href = target.dataset.href;
        else if (target.dataset.go != null) go(Number(target.dataset.go));
        else go(current + 1);
      };
      const run = async () => {
        if (actionRef.current) {
          const result = await actionRef.current({ type: "click", page, step: current, el: target, root });
          if (stopped) return;
          if (result && result.ok === false) {
            clearBtn(target);
            if (result.state) showState(result.state);
            else toast2(result.message, { kind: "bad" });
            return;
          }
          if (result?.ok && result.href) target.dataset.href = result.href;
        }
        after();
      };
      if (target.classList.contains("btn") && target.querySelector(".spin") && target.dataset.instant == null) {
        const ms = target.dataset.ms ? Number(target.dataset.ms) : 900;
        runBtn(target, "ok", ms);
        window.setTimeout(() => void run(), ms + 450);
      } else void run();
    }, listen);

    root.addEventListener("click", (event) => {
      const button = (event.target as HTMLElement).closest("button");
      if (!button || !root.contains(button)) return;
      const label = button.textContent || "";
      if (label.includes("Download") && root.querySelector(".codes")) {
        const text = all(root, ".codes span").map((slot) => slot.textContent).join("\n");
        const blob = new Blob([`Casevoya recovery codes\n\n${text}\n`], { type: "text/plain" });
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.download = "casevoya-recovery-codes.txt";
        link.click();
        URL.revokeObjectURL(url);
      }
      if (label.trim() === "Copy" && root.querySelector(".codes")) {
        const text = all(root, ".codes span").map((slot) => slot.textContent).join("\n");
        void navigator.clipboard?.writeText(text);
      }
      if (label.includes("Copy key")) {
        const secret = root.querySelector(".key b")?.textContent || "";
        void navigator.clipboard?.writeText(secret);
      }
      if (label.trim() === "Print") window.print();
    }, listen);

    root.dataset.ready = "1";
    return () => {
      stopped = true;
      ac.abort();
      delete root.dataset.ready;
    };
  }, [page, ref]);
}
