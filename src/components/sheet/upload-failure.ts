"use client";

import { checkUpload, uploadFailed, UPLOAD_RULES, type UploadFailure, type UploadRuleKey } from "@/modules/sheet/upload-failure";

/**
 * DES-04: a failed upload on a staff surface, shown where the file was chosen: the Designer's
 * error state from its System states sheet (the red `.lock` line with its x-circle, then a
 * `btn p sm` retry), built from those parts only. The message says what went wrong and what to
 * do next; the button chooses the file again (or tries again after a dropped connection).
 */
const SPRITE = "/assets/icons-coreui/sprite.svg";
const MARK = "data-upload-failure";

function host(anchor: Element): Element {
  return anchor.closest("dialog")?.querySelector(".db") ?? anchor.closest(".pad") ?? anchor.closest(".panel") ?? anchor.parentElement ?? anchor;
}

export function clearUploadFailure(anchor: Element) {
  host(anchor).querySelector(`[${MARK}]`)?.remove();
}

export function showUploadFailure(anchor: Element, failure: UploadFailure, retry: () => void) {
  const where = host(anchor);
  where.querySelector(`[${MARK}]`)?.remove();
  const box = document.createElement("div");
  box.setAttribute(MARK, "1");
  box.style.marginTop = "12px";
  const line = document.createElement("div");
  line.className = "lock";
  line.setAttribute("role", "alert");
  line.style.background = "#fdecea";
  line.style.color = "#8f2a22";
  line.innerHTML = `<svg class="ic s" aria-hidden="true"><use href="${SPRITE}#i-x-circle"/></svg>`;
  const text = document.createElement("span");
  const title = document.createElement("b");
  title.style.fontWeight = "500";
  title.textContent = failure.title;
  text.append(title, document.createTextNode(` ${failure.detail} ${failure.next}`));
  line.append(text);
  const row = document.createElement("div");
  row.style.display = "flex";
  row.style.gap = "8px";
  row.style.marginTop = "14px";
  const button = document.createElement("button");
  button.type = "button";
  button.className = "btn p sm";
  button.textContent = failure.retry;
  button.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    box.remove();
    retry();
  });
  row.append(button);
  box.append(line, row);
  where.append(box);
  box.scrollIntoView?.({ block: "nearest" });
}

/**
 * Checks a chosen file against the surface's limits. A file that can't go shows the failure with
 * a retry and resolves false; a good one clears any earlier failure and resolves true.
 */
export function acceptChosen(anchor: Element, file: File, rule: UploadRuleKey, retry: () => void): boolean {
  const failure = checkUpload(file, UPLOAD_RULES[rule]);
  if (failure) {
    showUploadFailure(anchor, failure, retry);
    return false;
  }
  clearUploadFailure(anchor);
  return true;
}

/** A refusal or dropped connection after sending: the server's words with the next step and a retry. */
export function failUpload(anchor: Element, error: string, rule: UploadRuleKey, retry: () => void) {
  showUploadFailure(anchor, uploadFailed(error, UPLOAD_RULES[rule]), retry);
}
