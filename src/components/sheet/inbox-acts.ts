"use client";

import { toast2 } from "@/components/port/kit";
import { dismissInboundEmail, fileInboundEmail, fileInboundEmailToMatter, moveInboundFiles, searchFilingMatters, type FilingChoice, type FilingMatter } from "@/modules/inbox/actions";
import { needsStepUp, stepUpLocation } from "@/modules/sheet/matter-wire";

type Router = { refresh: () => void };

function stepUp() {
  window.location.assign(stepUpLocation(window.location.pathname, window.location.search, null, "file_email"));
}

function filesLine(files: number, moved: number, problem: string | null): { kind: string; sub: string } {
  if (files === 0) return { kind: "ok", sub: "No files to move. Sender access unchanged." };
  if (moved === files) return { kind: "ok", sub: `${moved === 1 ? "Its file is" : `All ${moved} files are`} in their documents, waiting for review. Sender access unchanged.` };
  return { kind: "warn", sub: `${moved} of ${files} files moved. ${problem ?? ""} The email stays in triage until its files move.`.trim() };
}

/** "Confirm match" or a person's button on an email to triage: files it to that person and matter. */
export async function runInboxFile(button: HTMLElement, router: Router) {
  const data = button.dataset;
  const result = await fileInboundEmail({
    organizationId: data.org ?? "",
    emailId: data.inboxFile ?? "",
    matterId: data.matter ?? "",
    personId: data.person ?? "",
  });
  if ("error" in result) {
    if (needsStepUp(result.error)) return stepUp();
    toast2(result.error ?? "That action could not be completed.", { kind: "bad", sub: "The email is still in triage." });
    return;
  }
  const line = filesLine(result.files, result.moved, result.problem);
  toast2(`Filed to ${data.name || "the client"}`, { kind: line.kind, sub: line.sub });
  router.refresh();
}

/** "Move files" on a filed email whose files did not all move. */
export async function runInboxMove(button: HTMLElement, router: Router) {
  const result = await moveInboundFiles({ organizationId: button.dataset.org ?? "", emailId: button.dataset.inboxMove ?? "" });
  if ("error" in result) {
    if (needsStepUp(result.error)) return stepUp();
    toast2(result.error ?? "That action could not be completed.", { kind: "bad", sub: "Nothing was moved." });
    return;
  }
  const line = filesLine(result.files, result.moved, result.problem);
  toast2(line.kind === "ok" ? "Files moved" : "Some files didn’t move", { kind: line.kind, sub: line.sub });
  router.refresh();
}

/** "Not case mail": the email leaves triage; its files are never opened. */
export async function runInboxDismiss(button: HTMLElement, router: Router) {
  const result = await dismissInboundEmail({ organizationId: button.dataset.org ?? "", emailId: button.dataset.inboxDismiss ?? "" });
  if ("error" in result) {
    if (needsStepUp(result.error)) return stepUp();
    toast2(result.error ?? "That action could not be completed.", { kind: "bad", sub: "The email is still in triage." });
    return;
  }
  toast2("Removed from triage", { kind: "ok", sub: "Not case mail. Its files stay closed." });
  router.refresh();
}

/* ------------------------------------------------- File to matter (OPS-06) */

const FILE_DIALOG = "dlgFileTo";
/** The last search's matters, by id, with the people on each. */
let found = new Map<string, FilingMatter>();

function option(value: string, label: string): HTMLOptionElement {
  const node = document.createElement("option");
  node.value = value;
  node.textContent = label;
  return node;
}

function fillPeople(dialog: HTMLElement) {
  const matterSelect = dialog.querySelector<HTMLSelectElement>("#ftM");
  const personSelect = dialog.querySelector<HTMLSelectElement>("#ftP");
  if (!matterSelect || !personSelect) return;
  const matter = found.get(matterSelect.value);
  const people = matter?.people ?? [];
  personSelect.replaceChildren(...(people.length ? people.map((person) => option(person.id, person.name)) : [option("", matter ? "No one is on this matter yet" : "Choose a matter first")]));
  personSelect.disabled = !people.length;
}

function fileRow(file: { id: string; name: string }): HTMLElement {
  const row = document.createElement("div");
  row.className = "fp-row";
  row.style.flexWrap = "nowrap";
  row.style.alignItems = "center";
  const label = document.createElement("label");
  label.className = "check";
  label.style.flex = "1";
  const box = document.createElement("input");
  box.type = "checkbox";
  box.checked = true;
  box.dataset.ftItem = file.id;
  const name = document.createElement("span");
  name.textContent = `Save ${file.name} to Documents`;
  label.append(box, name);
  const audience = document.createElement("select");
  audience.className = "sel";
  audience.dataset.ftAud = file.id;
  audience.setAttribute("aria-label", `Who may see ${file.name}`);
  audience.append(option("staff", "Firm staff only"), option("subject", "The client can see it"));
  box.addEventListener("change", () => {
    audience.disabled = !box.checked;
  });
  row.append(label, audience);
  return row;
}

/** "File to matter" on an email to triage: opens the dialog for that email and its files. */
export function openInboxPick(button: HTMLElement, root: HTMLElement, openDialog: (id: string) => void) {
  const dialog = root.querySelector<HTMLDialogElement>(`#${FILE_DIALOG}`);
  if (!dialog) return;
  dialog.dataset.email = button.dataset.inboxPick ?? "";
  let files: { id: string; name: string }[] = [];
  try {
    const parsed: unknown = JSON.parse(button.dataset.files ?? "[]");
    if (Array.isArray(parsed)) files = parsed.filter((file): file is { id: string; name: string } => Boolean(file && typeof file.id === "string" && typeof file.name === "string"));
  } catch {
    files = [];
  }
  const cells = button.closest("tr")?.querySelectorAll("td");
  const intro = dialog.querySelector<HTMLElement>("#ftE");
  if (intro) intro.textContent = cells && cells.length > 1 ? `From ${cells[0].textContent ?? ""}: ${(cells[1].firstChild?.textContent ?? "").trim()}` : "";
  const list = dialog.querySelector<HTMLElement>("#ftF");
  if (list) {
    if (files.length) list.replaceChildren(...files.map(fileRow));
    else {
      const none = document.createElement("small");
      none.style.color = "var(--t2)";
      none.textContent = "No checked attachments to save. Files still being checked or quarantined stay out.";
      list.replaceChildren(none);
    }
  }
  found = new Map();
  const query = dialog.querySelector<HTMLInputElement>("#ftQ");
  if (query) query.value = "";
  const matterSelect = dialog.querySelector<HTMLSelectElement>("#ftM");
  if (matterSelect) {
    matterSelect.replaceChildren(option("", "Search for a matter first"));
    matterSelect.disabled = true;
    if (!dialog.dataset.wired) {
      dialog.dataset.wired = "1";
      matterSelect.addEventListener("change", () => fillPeople(dialog));
      query?.addEventListener("keydown", (event) => {
        if (event.key !== "Enter") return;
        event.preventDefault();
        dialog.querySelector<HTMLElement>("[data-inbox-search]")?.click();
      });
    }
  }
  fillPeople(dialog);
  openDialog(FILE_DIALOG);
}

/** Search in File to matter: the server returns only matters the signed-in staff member can open. */
export async function runInboxSearch(button: HTMLElement, root: HTMLElement) {
  const dialog = root.querySelector<HTMLDialogElement>(`#${FILE_DIALOG}`);
  const matterSelect = dialog?.querySelector<HTMLSelectElement>("#ftM");
  if (!dialog || !matterSelect) return;
  const result = await searchFilingMatters({ organizationId: button.dataset.org ?? "", query: dialog.querySelector<HTMLInputElement>("#ftQ")?.value ?? "" });
  if ("error" in result) {
    if (needsStepUp(result.error)) return stepUp();
    toast2(result.error, { kind: "bad", sub: "Nothing was filed." });
    return;
  }
  found = new Map(result.matters.map((matter) => [matter.id, matter]));
  matterSelect.replaceChildren(...(result.matters.length ? result.matters.map((matter) => option(matter.id, matter.label)) : [option("", "No matter you can open matches")]));
  matterSelect.disabled = !result.matters.length;
  fillPeople(dialog);
}

/** "File to matter" in the dialog: files the email and saves the chosen files. */
export async function runInboxFileGo(button: HTMLElement, root: HTMLElement, router: Router) {
  const dialog = root.querySelector<HTMLDialogElement>(`#${FILE_DIALOG}`);
  if (!dialog) return;
  const matterId = dialog.querySelector<HTMLSelectElement>("#ftM")?.value ?? "";
  const personId = dialog.querySelector<HTMLSelectElement>("#ftP")?.value ?? "";
  if (!matterId || !personId) {
    toast2(!matterId ? "Choose a matter" : "Choose who it’s from or about", { kind: "warn", sub: "Nothing was filed." });
    return;
  }
  const files: FilingChoice[] = [...dialog.querySelectorAll<HTMLInputElement>("[data-ft-item]")].map((box) => {
    const itemId = box.dataset.ftItem ?? "";
    const audience = dialog.querySelector<HTMLSelectElement>(`[data-ft-aud="${CSS.escape(itemId)}"]`)?.value === "subject" ? "subject" : "staff";
    return { itemId, save: box.checked, audience };
  });
  const result = await fileInboundEmailToMatter({ organizationId: button.dataset.org ?? "", emailId: dialog.dataset.email ?? "", matterId, personId, files });
  if ("error" in result) {
    if (needsStepUp(result.error)) return stepUp();
    toast2(result.error ?? "That action could not be completed.", { kind: "bad", sub: "The email is still in triage." });
    return;
  }
  dialog.close();
  const matter = found.get(matterId)?.label ?? "the matter";
  const line = filesLine(result.files, result.moved, result.problem);
  const left = result.leftOut ? ` ${result.leftOut === 1 ? "One file was" : `${result.leftOut} files were`} left out.` : "";
  toast2(`Filed to ${matter}`, { kind: line.kind, sub: `${line.sub}${left}` });
  router.refresh();
}
