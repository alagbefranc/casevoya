"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";

/** Whether a click on this link should become a client navigation to a Sheet page. */
export function sheetNavHref(event: Pick<MouseEvent, "defaultPrevented" | "button" | "metaKey" | "ctrlKey" | "shiftKey" | "altKey">, link: HTMLAnchorElement | null, origin: string, current: string): string | null {
  if (!link || event.defaultPrevented || event.button !== 0) return null;
  if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return null;
  if (link.hasAttribute("download") || (link.target && link.target !== "_self")) return null;
  const raw = link.getAttribute("href");
  if (!raw || raw.startsWith("#")) return null;
  let url: URL;
  try {
    url = new URL(raw, origin);
  } catch {
    return null;
  }
  if (url.origin !== origin) return null;
  if (url.pathname !== "/sheet" && !url.pathname.startsWith("/sheet/")) return null;
  const href = `${url.pathname}${url.search}`;
  // Same page, only a #fragment: leave it to the browser.
  if (href === current && url.hash) return null;
  return href;
}

/**
 * Sheet pages are Designer markup with plain `<a href>` links, which made every click a full page
 * reload (the whole app, sidebar included, blanked out and booted again). This turns clicks on
 * same-origin /sheet links into client navigations, after the page's own handlers have had their
 * say (anything that called preventDefault is left alone), and shows a thin progress bar at the
 * top while the next page loads. The current page stays on screen until then.
 */
export function SheetNav() {
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams().toString();
  const [state, setState] = useState<"idle" | "loading" | "done">("idle");
  const timer = useRef<number | undefined>(undefined);

  // The URL changed: the navigation finished (or another one replaced it). Fill the bar, then fade.
  const at = `${pathname}?${search}`;
  const [seen, setSeen] = useState(at);
  if (seen !== at) {
    setSeen(at);
    if (state === "loading") setState("done");
  }
  useEffect(() => {
    if (state !== "done") return;
    window.clearTimeout(timer.current);
    const fade = window.setTimeout(() => setState("idle"), 450);
    return () => window.clearTimeout(fade);
  }, [state]);

  useEffect(() => {
    const onClick = (event: MouseEvent) => {
      const link = (event.target as Element | null)?.closest?.("a") ?? null;
      const current = `${window.location.pathname}${window.location.search}`;
      const href = sheetNavHref(event, link as HTMLAnchorElement | null, window.location.origin, current);
      if (!href) return;
      event.preventDefault();
      if (href === current) return;
      setState("loading");
      window.clearTimeout(timer.current);
      // Never leave the bar running if a navigation is dropped.
      timer.current = window.setTimeout(() => setState("idle"), 15000);
      router.push(href);
    };
    // Bubble phase on the document: page handlers on the Sheet root run first.
    document.addEventListener("click", onClick);
    return () => {
      document.removeEventListener("click", onClick);
      window.clearTimeout(timer.current);
    };
  }, [router]);

  return (
    <div className={"cv-navbar"} data-state={state} aria-hidden={"true"}>
      <style>{CSS}</style>
    </div>
  );
}

const CSS = `
.cv-navbar{position:fixed;top:0;left:0;height:3px;width:0;background:#0075de;box-shadow:0 0 8px rgba(0,117,222,.5);z-index:60;opacity:0;pointer-events:none}
.cv-navbar[data-state="loading"]{opacity:1;width:85%;transition:width 6s cubic-bezier(.1,.7,.2,1) .1s,opacity .1s ease .1s}
.cv-navbar[data-state="done"]{opacity:0;width:100%;transition:width .2s ease,opacity .25s ease .2s}
@media (prefers-reduced-motion:reduce){.cv-navbar[data-state]{transition:none}}
`;
