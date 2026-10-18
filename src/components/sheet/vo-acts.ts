"use client";

import { toast2 } from "@/components/port/kit";
import { askVo, discardVoDraft, rateVoRun, saveVoSetting } from "@/modules/vo/actions";
import type { VoSettingKey } from "@/modules/vo/errors";

type Router = { push: (href: string) => void; refresh: () => void };

/** Vo drafts: Reject discards the draft; it is never sent and stays in the draft audit. */
export async function runVoDiscard(button: HTMLElement, router: Router) {
  const draftId = button.dataset.voDiscard ?? "";
  const organizationId = button.dataset.org ?? "";
  const result = await discardVoDraft({ organizationId, draftId });
  if ("error" in result) {
    toast2(result.error, { kind: "bad", sub: "Nothing was changed." });
    return;
  }
  toast2("Draft rejected", { kind: "ok", sub: "It wasn’t sent. The draft audit keeps the record." });
  router.refresh();
}

/** A Vo switch (firm owner): saved at once; put back if the database refuses it. */
export async function runVoSetting(button: HTMLElement, router: Router) {
  const setting = (button.dataset.voSetting ?? "") as VoSettingKey;
  const organizationId = button.dataset.org ?? "";
  const on = button.getAttribute("aria-checked") !== "true";
  button.setAttribute("aria-checked", String(on));
  const result = await saveVoSetting({ organizationId, setting, on });
  if ("error" in result) {
    button.setAttribute("aria-checked", String(!on));
    toast2(result.error, { kind: "bad", sub: "Nothing was changed." });
    return;
  }
  toast2(on ? "Turned on" : "Turned off", { kind: "ok", sub: "Vo uses the new setting from its next run." });
  router.refresh();
}

/** Run log: the reviewer's "useful?" vote. */
export async function runVoUseful(button: HTMLElement, router: Router) {
  const result = await rateVoRun({ organizationId: button.dataset.org ?? "", runId: button.dataset.run ?? "", useful: button.dataset.voUseful === "1" });
  if ("error" in result) {
    toast2(result.error, { kind: "bad", sub: "Nothing was changed." });
    return;
  }
  toast2("Thanks, noted for the prompt review", { kind: "ok", sub: "" });
  router.refresh();
}

/** Ask Vo: the answer and the records it read appear in the dialog (text only, never HTML). */
export async function runVoAsk(button: HTMLElement) {
  const dialog = button.closest("dialog");
  if (!dialog) return;
  const matterId = dialog.querySelector<HTMLSelectElement>("#askM")?.value ?? "";
  const question = dialog.querySelector<HTMLTextAreaElement>("#askQ")?.value ?? "";
  const out = dialog.querySelector<HTMLElement>("#askOut");
  const text = dialog.querySelector<HTMLElement>("#askText");
  const sources = dialog.querySelector<HTMLElement>("#askSrc");
  if (!out || !text || !sources) return;
  if (!question.trim()) {
    toast2("Write a question first", { kind: "warn", sub: "" });
    return;
  }
  out.hidden = false;
  text.textContent = "Vo is checking this matter’s records…";
  sources.textContent = "";
  const result = await askVo({ organizationId: button.dataset.org ?? "", matterId, question });
  if ("error" in result) {
    text.textContent = result.error;
    return;
  }
  if ("abstained" in result) {
    text.textContent = "This needs a consultant. Vo has no approved source for it, so it won’t guess.";
    sources.textContent = "Run logged · no answer kept";
    return;
  }
  text.textContent = result.text;
  sources.textContent = `Sources: ${result.sources.map((source) => source.label).join(", ")} · for you only, not kept`;
}
