"use client";

import { toast2 } from "@/components/port/kit";
import { stepUpHref } from "@/lib/auth/mfa-step";

type Router = { refresh(): void; push(href: string): void };
type Reply = { ok: boolean; data: Record<string, unknown> };

async function send(url: string, body: BodyInit, json: boolean): Promise<Reply> {
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: json ? { "Content-Type": "application/json" } : undefined,
      body,
      credentials: "same-origin",
    });
    const data = ((await response.json().catch(() => ({}))) ?? {}) as Record<string, unknown>;
    return { ok: response.ok, data };
  } catch {
    return { ok: false, data: { error: "Check your connection and try again." } };
  }
}

const post = (action: string, body: unknown) => send(`/api/migration/${action}`, JSON.stringify(body), true);

function errorOf(data: Record<string, unknown>): string {
  return typeof data.error === "string" ? data.error : "That didn’t work. Try again.";
}

function n(value: unknown): number {
  return typeof value === "number" ? value : Number(value ?? 0) || 0;
}

/** Back to this import's Sign off tab after the authenticator step-up. */
function stepUp(batch: string) {
  const next = `${window.location.pathname}?tab=signoff&id=${encodeURIComponent(batch)}`;
  toast2("Confirm it’s you", { kind: "warn", sub: "Then choose the button again." });
  window.setTimeout(() => window.location.assign(stepUpHref(next, "import_signoff")), 900);
}

function withTab(tab: string, batch: string): string {
  const params = new URLSearchParams(window.location.search);
  params.set("tab", tab);
  if (batch) params.set("id", batch);
  else params.delete("id");
  return `${window.location.pathname}?${params.toString()}`;
}

/** The mapping on Map columns: each column's field, the date order, the default consultant, and each value's choice. */
function readMapping(root: HTMLElement): { mapping: Record<string, unknown> } | { error: string } {
  const columns: Record<string, number | null> = {};
  for (const select of root.querySelectorAll<HTMLSelectElement>("select[data-mig-col]")) {
    const field = select.value;
    if (!field) continue;
    if (field in columns) return { error: "Each Casevoya field can come from one column only." };
    columns[field] = Number(select.dataset.migCol);
  }
  if (!("name" in columns)) return { error: "Map a column to the person’s legal name." };
  const values: Record<string, Record<string, string>> = {};
  for (const select of root.querySelectorAll<HTMLSelectElement>("select[data-mig-val]")) {
    const field = select.dataset.migVal ?? "";
    const key = select.dataset.key ?? "";
    if (!field || !key || !select.value) continue;
    (values[field] ??= {})[key] = select.value;
  }
  const consultant = root.querySelector<HTMLSelectElement>("select[data-mig-default]")?.value || null;
  const order = root.querySelector<HTMLSelectElement>("select[data-mig-date]")?.value || "dmy";
  return { mapping: { columns, date_order: order, default_consultant: consultant, values } };
}

async function upload(button: HTMLElement, root: HTMLElement, router: Router) {
  const input = root.querySelector<HTMLInputElement>("input[data-mig-file]");
  if (!input) return;
  const file = await new Promise<File | null>((resolve) => {
    input.value = "";
    input.onchange = () => resolve(input.files?.[0] ?? null);
    input.click();
  });
  if (!file) return;
  if (file.size > 5 * 1024 * 1024) {
    toast2("The file is too large", { kind: "warn", sub: "Import up to 5 MB at a time. Split it and import each part." });
    return;
  }
  const form = new FormData();
  form.set("organizationId", button.dataset.org ?? "");
  form.set("file", file);
  toast2("Checking the file", { sub: "Counting rows and checking the checksum." });
  const result = await send("/api/migration/upload", form, false);
  if (!result.ok) {
    toast2("File not uploaded", { kind: "warn", sub: errorOf(result.data) });
    return;
  }
  toast2("File checked", { kind: "ok", sub: "Every row arrived intact. Map the columns next." });
  router.push(withTab("map", typeof result.data.id === "string" ? result.data.id : ""));
}

async function commit(button: HTMLElement, router: Router, first?: Reply) {
  const org = button.dataset.org ?? "";
  const batch = button.dataset.batch ?? "";
  let result = first;
  for (;;) {
    result ??= await post("commit", { org, batch });
    if (!result.ok) {
      if (result.data.stepUp) return stepUp(batch);
      toast2("Import stopped", { kind: "warn", sub: errorOf(result.data) });
      router.refresh();
      return;
    }
    const remaining = n(result.data.remaining);
    if (remaining <= 0) break;
    toast2("Importing", { sub: `${remaining.toLocaleString("en-CA")} matters to go.` });
    result = undefined;
  }
  // MIG-02: a pilot stops at its last matter and waits for the firm owner's sign-off.
  if (result.data.status === "pilot_done") toast2("Pilot finished", { kind: "ok", sub: "Check its records below, then sign off. The full import waits for it." });
  else toast2("Import finished", { kind: "ok", sub: "The run report is on Sign off. A copy is in the audit trail." });
  router.refresh();
}

/** MIG-02: run the pilot with the size and source system on Sign off. */
async function pilot(button: HTMLElement, root: HTMLElement, router: Router) {
  const org = button.dataset.org ?? "";
  const batch = button.dataset.batch ?? "";
  const sizeInput = root.querySelector<HTMLInputElement>("input[data-mig-pilot]");
  const size = Number(sizeInput?.value ?? "");
  const max = Number(sizeInput?.max || 50);
  if (!Number.isInteger(size) || size < 1 || size > max) {
    toast2("Check the pilot size", { kind: "warn", sub: `A pilot is 1 to ${max} matters.` });
    return;
  }
  const system = root.querySelector<HTMLInputElement>("input[data-mig-system]")?.value.trim() ?? "";
  if (!window.confirm(`Run a pilot of the first ${size} ${size === 1 ? "matter" : "matters"}?\n\nThe pilot creates real matters and people. You check them and sign off before the rest can be imported, or roll the pilot back.`)) return;
  const result = await post("pilot", { org, batch, size, ...(system ? { system } : {}) });
  return commit(button, router, result);
}

/** MIG-02: the firm owner signs the pilot off, with a note. */
async function signoff(button: HTMLElement, root: HTMLElement, router: Router) {
  const org = button.dataset.org ?? "";
  const batch = button.dataset.batch ?? "";
  const note = root.querySelector<HTMLTextAreaElement>("textarea[data-mig-note]")?.value.trim() ?? "";
  if (note.length < 3 || note.length > 1000) {
    toast2("Add a note", { kind: "warn", sub: "Say what you checked in the pilot’s records (3 to 1,000 characters)." });
    return;
  }
  if (!window.confirm("Sign off the pilot? The full import can then create the rest of the matters.")) return;
  const result = await post("signoff", { org, batch, note });
  if (!result.ok) {
    if (result.data.stepUp) return stepUp(batch);
    toast2("Not signed off", { kind: "warn", sub: errorOf(result.data) });
    return;
  }
  toast2("Pilot signed off", { kind: "ok", sub: "Run the full import next." });
  router.refresh();
}

/** What a mapping change does to its row's Check cell, until Continue re-checks the whole file. */
export function pendingCheck(field: string): string {
  if (!field) return "Not imported";
  if (field === "name_extra") return "Joined after the legal name with a space";
  if (field === "date_of_birth") return "Check the date order below";
  return "Checked when you choose Continue";
}

/** Map columns: a changed field updates its row's Check column at once. */
export function syncMigrationCheck(select: HTMLSelectElement) {
  const cell = select.closest("tr")?.lastElementChild as HTMLElement | null | undefined;
  if (!cell) return;
  const text = pendingCheck(select.value);
  // A plain-text cell is React's own text content and can be replaced; a badge stays in place
  // (React owns it), hidden, with the new words beside it.
  const own = [...cell.children].filter((child) => !(child as HTMLElement).dataset.pending);
  if (own.length === 0) {
    cell.textContent = text;
    return;
  }
  for (const child of own) (child as HTMLElement).hidden = true;
  let note = cell.querySelector<HTMLElement>("[data-pending]");
  if (!note) {
    note = document.createElement("span");
    note.dataset.pending = "1";
    cell.append(note);
  }
  note.textContent = text;
}

/** Migration import: upload, map and preview, duplicate decisions, sign-off, rollback, discard. */
export async function runMigrationAct(button: HTMLElement, root: HTMLElement, router: Router): Promise<void> {
  const act = button.dataset.migAct;
  const org = button.dataset.org ?? "";
  const batch = button.dataset.batch ?? "";

  if (act === "upload") return upload(button, root, router);
  if (act === "pilot") return pilot(button, root, router);
  if (act === "signoff") return signoff(button, root, router);

  if (act === "map") {
    const read = readMapping(root);
    if ("error" in read) {
      toast2("Check the mapping", { kind: "warn", sub: read.error });
      return;
    }
    const result = await post("map", { org, batch, mapping: read.mapping });
    if (!result.ok) {
      toast2("Mapping not saved", { kind: "warn", sub: errorOf(result.data) });
      return;
    }
    const counts = (result.data.counts ?? {}) as Record<string, unknown>;
    const ready = n(counts.create) + n(counts.link);
    toast2("Preview ready", { kind: "ok", sub: `${ready.toLocaleString("en-CA")} rows ready, ${n(counts.problem_rows).toLocaleString("en-CA")} with problems. Nothing is imported yet.` });
    router.push(withTab("preview", batch));
    return;
  }

  if (act === "decide") {
    const same = button.dataset.same === "1";
    const result = await post("decide", { org, batch, row: Number(button.dataset.row), same });
    if (!result.ok) {
      toast2("Not saved", { kind: "warn", sub: errorOf(result.data) });
      return;
    }
    toast2(same ? "Marked as the same person" : "Marked as different people", { kind: "ok", sub: "Nothing is merged. The preview is updated." });
    router.refresh();
    return;
  }

  if (act === "commit") {
    // Signing off creates real matters and people: it asks first, like Roll back and Discard.
    const summary = [...root.querySelectorAll<HTMLElement>(".fp-dl dt")].map((term) => `${term.textContent}: ${term.nextElementSibling?.textContent ?? ""}`).slice(0, 3).join("\n");
    const label = button.textContent?.trim() || "Continue the import";
    if (!window.confirm(`${label}?${summary ? `\n\n${summary}` : ""}\n\nThis creates matters and people. You can roll the import back while no one has changed them.`)) return;
    return commit(button, router);
  }

  if (act === "rollback") {
    if (!window.confirm("Roll back this import? Every matter and person it created is removed. Records someone changed since stop the rollback.")) return;
    const result = await post("rollback", { org, batch });
    if (!result.ok) {
      if (result.data.stepUp) return stepUp(batch);
      const reasons = Array.isArray(result.data.reasons) ? (result.data.reasons as string[]) : [];
      toast2("Not rolled back", { kind: "warn", sub: reasons[0] ?? errorOf(result.data) });
      router.refresh();
      return;
    }
    toast2("Import rolled back", { kind: "ok", sub: "Its records were removed. The audit trail keeps the history." });
    router.refresh();
    return;
  }

  if (act === "discard") {
    if (!window.confirm("Discard this import? The staged rows are removed and nothing is imported.")) return;
    const result = await post("discard", { org, batch });
    if (!result.ok) {
      toast2("Not discarded", { kind: "warn", sub: errorOf(result.data) });
      return;
    }
    toast2("Import discarded", { sub: "The staged rows were removed." });
    router.push(withTab("map", ""));
  }
}
