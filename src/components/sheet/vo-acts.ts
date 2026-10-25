"use client";

import { toast2 } from "@/components/port/kit";
import { acceptVoDraft, askVo, discardVoDraft, rateVoRun, saveVoSetting } from "@/modules/vo/actions";
import type { VoSettingKey } from "@/modules/vo/errors";
import { VO_CANT_ANSWER, type VoCitation } from "@/modules/vo/grounding";

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

/** Vo drafts: Accept sends the draft to the client as written. Edit opens it in the composer instead. */
export async function runVoAccept(button: HTMLElement, router: Router) {
  const result = await acceptVoDraft({ organizationId: button.dataset.org ?? "", draftId: button.dataset.voAccept ?? "" });
  if ("error" in result) {
    toast2(result.error, { kind: "bad", sub: "Nothing was sent. Choose Edit to change it first." });
    return;
  }
  toast2("Draft accepted and sent", { kind: "ok", sub: "It went to the client as a message on the matter. The draft audit records who sent it." });
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
  // A run that fails or never answers must not leave "checking" on screen.
  let result: Awaited<ReturnType<typeof askVo>>;
  try {
    result = await askVo({ organizationId: button.dataset.org ?? "", matterId, question });
  } catch {
    text.textContent = "Vo didn’t answer. Try again, or answer it from the matter’s records yourself.";
    sources.textContent = "Nothing was kept";
    return;
  }
  if ("error" in result) {
    text.textContent = result.error;
    return;
  }
  // SRC-09: no supporting record or approved source, or it needs a consultant: Vo says so plainly.
  if ("abstained" in result) {
    text.textContent =
      result.reason === "consultant"
        ? `${VO_CANT_ANSWER} It needs a consultant’s judgement, so Vo won’t guess.`
        : `${VO_CANT_ANSWER} Nothing on this matter or in the firm’s approved official content supports an answer, so Vo won’t guess.`;
    sources.textContent = "Run logged · no answer kept";
    return;
  }
  text.textContent = result.text;
  showCitations(sources, result.sources);
}

/**
 * The citations under an answer, each linked: the matter tab that holds the record, or the official
 * page (with its section, dates and fingerprint). Built as DOM text, never HTML.
 */
export function showCitations(target: HTMLElement, citations: VoCitation[]) {
  target.textContent = "Sources: ";
  citations.forEach((citation, index) => {
    if (index) target.append(", ");
    const name = `${citation.marker ? `[${citation.marker}] ` : ""}${citation.label}`;
    if (citation.href) {
      const link = document.createElement("a");
      link.href = citation.href;
      link.textContent = name;
      if (/^https:\/\//.test(citation.href)) {
        link.target = "_blank";
        link.rel = "noopener noreferrer";
      }
      if (citation.detail) link.title = citation.detail;
      target.append(link);
    } else {
      target.append(name);
    }
    if (citation.kind === "official" && citation.detail) target.append(` (${citation.detail})`);
  });
  target.append(" · for you only, not kept");
}
