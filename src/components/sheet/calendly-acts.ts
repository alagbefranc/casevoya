"use client";

import { toast2 } from "@/components/port/kit";
import { importCalendlyEvents } from "@/modules/integrations/calendly-import-run";

type Router = { refresh: () => void };

/** Imports the signed-in person's Calendly events. The button is only rendered when that account can import. */
export async function runCalendlyImport(button: HTMLElement, router: Router) {
  const result = await importCalendlyEvents(button.dataset.org ?? "");
  if ("error" in result) {
    toast2(result.error, { kind: "bad", sub: "Nothing was imported." });
    return;
  }
  const more = result.truncated ? " Calendly had more events than this page, so nothing already imported was marked canceled." : "";
  toast2("Calendly imported", {
    kind: "ok",
    sub: `${result.imported} scheduled ${result.imported === 1 ? "event" : "events"} on your calendar.${more}`,
  });
  router.refresh();
}
