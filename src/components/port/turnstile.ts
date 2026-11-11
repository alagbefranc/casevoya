"use client";

import { turnstileSiteKey } from "@/lib/auth/turnstile";

const SCRIPT_ID = "cf-turnstile-script";
export const TURNSTILE_SCRIPT_SRC = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";

type TurnstileRender = {
  render: (element: HTMLElement, options: { sitekey: string }) => unknown;
};

function turnstileApi(): TurnstileRender | null {
  const value = (window as Window & { turnstile?: TurnstileRender }).turnstile;
  return value && typeof value.render === "function" ? value : null;
}

function loadScript(): Promise<void> {
  if (turnstileApi()) return Promise.resolve();
  const existing = document.getElementById(SCRIPT_ID);
  if (existing) {
    return new Promise((resolve) => {
      if (turnstileApi()) resolve();
      else existing.addEventListener("load", () => resolve(), { once: true });
    });
  }
  return new Promise((resolve) => {
    const script = document.createElement("script");
    script.id = SCRIPT_ID;
    script.src = TURNSTILE_SCRIPT_SRC;
    script.async = true;
    script.onload = () => resolve();
    document.head.append(script);
  });
}

/** The token Turnstile writes into the page, or "" when the challenge is off or not finished. */
export function readTurnstileToken(root: ParentNode): string {
  return root.querySelector<HTMLInputElement>('input[name="cf-turnstile-response"]')?.value.trim() ?? "";
}

/**
 * Renders a widget in each empty [data-turnstile] slot when the site key is set.
 * Returns false when the key is absent, so the forms ship with no challenge.
 */
export function mountTurnstile(root: ParentNode): boolean {
  const key = turnstileSiteKey();
  if (!key) return false;
  const slots = [...root.querySelectorAll<HTMLElement>("[data-turnstile]:not([data-turnstile-ready])")];
  if (slots.length === 0) return false;
  for (const slot of slots) slot.dataset.turnstileReady = "1";
  void loadScript().then(() => {
    const api = turnstileApi();
    if (!api) return;
    for (const slot of slots) api.render(slot, { sitekey: key });
  });
  return true;
}
