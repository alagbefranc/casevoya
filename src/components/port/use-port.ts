"use client";

import { useEffect, useLayoutEffect, useRef, type RefObject } from "react";
import { messageParts, rateLimitText, secondsLeft } from "@/lib/auth/signup-errors";
import { busyBtn, clearBtn, icon, k2Count, k2Slider, k2Spark, morphText, settleBtn, toast2, voPose } from "./kit";

export type PortResult =
  /** `stay` keeps the person on this step (the step changed in place, e.g. a code was sent). */
  | { ok: true; href?: string; codes?: string[]; stay?: boolean; message?: string }
  /**
   * `inline`: shown in the step's error summary (`.errsum`), where `[label](/path)` becomes a link.
   * `retryAfter`: a rate limit; the summary counts the seconds down and the button waits for it.
   */
  | { ok: false; state?: "error" | "locked"; message: string; inline?: boolean; retryAfter?: number | null }
  | null;

export type PortEvent =
  | { type: "click"; page: string; step: number; el: HTMLElement; root: HTMLElement }
  | { type: "otp"; page: string; code: string; then: string; otp: HTMLElement; root: HTMLElement }
  | { type: "step"; page: string; step: number; root: HTMLElement }
  | { type: "resend"; page: string; el: HTMLElement; root: HTMLElement };

const CHECK = `<svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>`;

/** The class that plays a step panel's slide-back animation (auth.css `[data-step].on.st-back`). */
export const STEP_BACK = "st-back";

/**
 * Which `[data-show]` notice a screen opens with, from its query: `?state=`, `?error=` (the sign-in
 * error) or `?idle=1` (#272: the Sheet's idle guard signed the person out).
 */
export function portNoticeState(search: string): string | null {
  const params = new URLSearchParams(search);
  const state = params.get("state");
  if (state) return state;
  if (params.get("error")) return "error";
  if (params.get("idle") === "1") return "idle";
  return null;
}

function all<T extends Element>(root: ParentNode, selector: string) {
  return [...root.querySelectorAll<T>(selector)];
}

export function usePort(
  ref: RefObject<HTMLElement | null>,
  page: string,
  onAction?: (event: PortEvent) => Promise<PortResult>,
  initialStep?: number,
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
      const requested = Number.isFinite(next) ? next : 0;
      const index = Math.max(0, Math.min(panels.length - 1, requested));
      const back = index < current;
      panels.forEach((panel) => {
        const on = Number(panel.dataset.step) === index;
        panel.classList.toggle("on", on);
        // Not "back": the Sheet's global `.back` (shell.css) is the 34px back-arrow link.
        panel.classList.toggle(STEP_BACK, on && back);
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
      // A part of the step that is hidden (another sign-in method, say) is not asked for.
      all<HTMLElement>(scope, ".fld[data-req]").forEach((field) => {
        if (field.closest("[hidden]")) return;
        const input = field.querySelector<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>("input,select,textarea");
        let ok = Boolean(input && (input.type === "checkbox" ? (input as HTMLInputElement).checked : input.value.trim() !== ""));
        if (ok && input?.type === "email") ok = /.+@.+\..+/.test(input.value);
        if (ok && field.dataset.min && input) ok = input.value.length >= Number(field.dataset.min);
        field.classList.toggle("err", !ok);
        if (!ok && input) bad.push([input.id, field.dataset.req || "Check this field"]);
      });
      all<HTMLElement>(scope, ".check[data-req]").forEach((field) => {
        if (field.closest("[hidden]")) return;
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

    /**
     * A server refusal shown in the step's error summary, the same `.errsum` that validate uses
     * (an email that already has an account, a rate limit). Only `[label](/path)` becomes a link;
     * everything else is text. With `retryAfter`, the wait counts down and `button` waits for it.
     */
    let countdown = 0;
    const showProblem = (scope: HTMLElement, message: string, retryAfter: number | null | undefined, button: HTMLElement) => {
      scope.querySelector(".errsum")?.remove();
      window.clearTimeout(countdown);
      const summary = document.createElement("div");
      summary.className = "errsum";
      summary.setAttribute("role", "alert");
      summary.tabIndex = -1;
      summary.innerHTML = `<h4>${icon("alert", "s")}One thing to fix</h4><ul><li></li></ul>`;
      const item = summary.querySelector("li")!;
      const write = (text: string) => {
        item.replaceChildren(
          ...messageParts(text).map((part) => {
            if (!("href" in part)) return document.createTextNode(part.text);
            const link = document.createElement("a");
            link.href = part.href;
            link.textContent = part.text;
            return link;
          }),
        );
      };
      write(message);
      scope.prepend(summary);
      summary.focus();
      pose("worried");
      if (retryAfter && retryAfter > 0) {
        // Off the clock, not by counting ticks: a throttled background tab must not re-enable early (#261).
        const until = Date.now() + Math.min(Math.ceil(retryAfter), 3600) * 1000;
        button.setAttribute("aria-disabled", "true");
        const tick = () => {
          if (stopped || !summary.isConnected) {
            button.removeAttribute("aria-disabled");
            return;
          }
          const left = secondsLeft(until, Date.now());
          write(rateLimitText(left));
          if (left <= 0) {
            button.removeAttribute("aria-disabled");
            return;
          }
          countdown = window.setTimeout(tick, (until - Date.now()) % 1000 || 1000);
        };
        countdown = window.setTimeout(tick, (until - Date.now()) % 1000 || 1000);
      }
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

    const finishOtp = (otp: HTMLElement, accepted: boolean, failure?: string) => {
      const inputs = all<HTMLInputElement>(otp, "input");
      const message = otp.parentElement?.querySelector<HTMLElement>(".otp-msg");
      if (!accepted) {
        otp.classList.add("err", "nudge");
        otp.classList.remove("ok");
        window.setTimeout(() => otp.classList.remove("nudge"), 200);
        if (message) {
          message.className = "emsg otp-msg";
          message.style.display = "flex";
          message.innerHTML = `${icon("alert", "s")}<span></span>`;
          message.querySelector("span")!.textContent =
            failure ?? "That code didn’t match. Codes change every 30 seconds, so use the newest one.";
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
          if (!actionRef.current) {
            finishOtp(otp, false, "This code can’t be checked right now. Reload the page and try again.");
            return;
          }
          void actionRef.current({ type: "otp", page, code, then: otp.dataset.then || "", otp, root }).then((result) => {
            if (stopped) return;
            // No handler means nothing checked the code, which is never a success.
            if (!result || result.ok === false) {
              finishOtp(otp, false, result?.message ?? "This code can’t be checked right now. Reload the page and try again.");
              return;
            }
            if (result.ok && result.codes) {
              const slots = all<HTMLElement>(root, ".codes span");
              result.codes.slice(0, slots.length).forEach((value, index) => {
                if (slots[index]) slots[index].textContent = value;
              });
            }
            if (result.ok && result.href) otp.dataset.then = result.href;
            finishOtp(otp, true);
          });
        };
        inputs.forEach((input, index) => {
          // maxlength=1 would cut an autofilled or pasted-by-keyboard code to its first digit.
          input.removeAttribute("maxlength");
          input.addEventListener("input", () => {
            const digits = input.value.replace(/\D/g, "");
            // Phone keyboards and password managers can drop the whole code into one box.
            // Two digits is a keypress over an existing one; more is a whole code arriving at once.
            if (digits.length > 2) {
              digits.slice(0, 6 - index).split("").forEach((char, j) => {
                inputs[index + j].value = char;
                inputs[index + j].classList.add("filled");
              });
              inputs[Math.min(5, index + digits.length)]?.focus();
              done();
              return;
            }
            input.value = digits.slice(-1);
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
          // A screen that really sends the code says whether it went; others keep the prototype's note.
          const sent = actionRef.current
            ? actionRef.current({ type: "resend", page, el: button, root })
            : Promise.resolve<PortResult>(null);
          button.setAttribute("aria-disabled", "true");
          void sent.then((result) => {
            if (stopped) return;
            if (result && result.ok === false) {
              button.removeAttribute("aria-disabled");
              toast2(result.message, { kind: "bad" });
              return;
            }
            // The screen moved on instead of sending a code (the email was confirmed already).
            if (result?.ok && result.message) {
              button.removeAttribute("aria-disabled");
              toast2(result.message, { kind: "ok" });
              return;
            }
            // Supabase answers success without sending when the email is already confirmed, so don't promise a code.
            toast2("If you haven’t confirmed yet, a new code is on its way", { kind: "ok", sub: "Check the newest email. Older codes stop working." });
            left = 30;
            tick();
          });
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
    showState(portNoticeState(location.search));
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

    bindPw();
    bindOtp();
    bindResend();
    bindOpts();
    const fromUrl = params.get("step");
    const raw = initialStep != null ? initialStep : fromUrl != null ? Number(fromUrl) : 0;
    go(Number.isFinite(raw) ? raw : 0, false);
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
      // The button shows "Saved" only after the server confirms; a pure navigation button just moves on.
      const animated = target.classList.contains("btn") && Boolean(target.querySelector(".spin")) && target.dataset.instant == null;
      const run = async () => {
        if (animated) busyBtn(target);
        const result = actionRef.current
          ? await actionRef.current({ type: "click", page, step: current, el: target, root })
          : null;
        if (stopped) return;
        if (result && result.ok === false) {
          clearBtn(target);
          if (result.state) showState(result.state);
          else if (result.inline) showProblem(scope, result.message, result.retryAfter, target);
          else toast2(result.message, { kind: "bad" });
          return;
        }
        if (result?.ok && result.stay) {
          clearBtn(target);
          if (result.message) toast2(result.message, { kind: "ok" });
          return;
        }
        if (result?.ok && result.href) target.dataset.href = result.href;
        if (animated) {
          if (result?.ok) await settleBtn(target, "ok");
          else clearBtn(target);
          if (stopped) return;
        }
        after();
      };
      void run();
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

    // A screen's own code can move the steps on (`#<step>`) or leave the page (a path), e.g. the
    // portal code step once the email was confirmed through the link instead of the code.
    root.addEventListener("port-go", (event) => {
      const to = (event as CustomEvent<unknown>).detail;
      if (typeof to !== "string" || stopped) return;
      if (to.startsWith("#")) go(Number(to.slice(1)));
      else if (to.startsWith("/") && !to.startsWith("//")) location.href = to;
    }, listen);

    root.dataset.ready = "1";
    return () => {
      stopped = true;
      ac.abort();
      delete root.dataset.ready;
    };
  }, [page, ref, initialStep]);

  // A suspense swap can replace the panels after the binder ran and drop `.on`.
  // CSS hides every `[data-step]` without it, which is the blank card.
  useLayoutEffect(() => {
    const root = ref.current;
    if (!root || root.querySelector("[data-step].on")) return;
    const panels = [...root.querySelectorAll<HTMLElement>("[data-step]")];
    if (!panels.length) return;
    const fromUrl = new URLSearchParams(location.search).get("step");
    const raw = initialStep != null ? initialStep : fromUrl != null ? Number(fromUrl) : 0;
    const index = Number.isFinite(raw) ? raw : 0;
    panels.forEach((panel) => panel.classList.toggle("on", Number(panel.dataset.step) === index));
  });
}
