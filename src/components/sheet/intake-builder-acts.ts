"use client";

import { toast2 } from "@/components/port/kit";
import { publishIntakeDraft, saveIntakeDraft } from "@/modules/intake/builder-actions";
import { fieldLabel, fieldToggles, newField, readSchema, relabel, toggleField, type IntakeField } from "@/modules/sheet/intake-builder-present";

type Router = { refresh: () => void };

type State = {
  org: string;
  key: string;
  title: string;
  id: string | null;
  version: number | null;
  fields: IntakeField[];
  selected: string | null;
  timer: number | undefined;
  saving: Promise<void> | null;
  stale: boolean;
};

const SAVE_DELAY_MS = 700;

function read(qs: HTMLElement): State {
  const version = Number(qs.dataset.intakeVersion);
  const fields = (() => {
    try {
      return readSchema(JSON.parse(qs.dataset.intakeSchema ?? "{}")).fields;
    } catch {
      return [];
    }
  })();
  return {
    org: qs.dataset.intakeOrg ?? "",
    key: qs.dataset.intakeKey ?? "intake_form",
    title: qs.dataset.intakeTitle ?? "Intake form",
    id: qs.dataset.intakeId || null,
    version: Number.isFinite(version) && qs.dataset.intakeVersion ? version : null,
    fields,
    selected: qs.querySelector<HTMLElement>(".qq.on")?.dataset.key ?? fields[0]?.key ?? null,
    timer: undefined,
    saving: null,
    stale: false,
  };
}

/** The browser builder: select a field, rename it, flip its switches, add fields, autosave, publish. */
export function mountIntakeBuilder(root: HTMLElement, router: Router, signal: AbortSignal) {
  const qs = root.querySelector<HTMLElement>("#qs[data-intake-org]");
  if (!qs) return;
  let state = read(qs);
  const fresh = () => {
    if (state.stale && !state.timer && !state.saving) state = { ...read(qs), stale: false };
    return state;
  };
  const listen = { signal };
  const labelInput = () => root.querySelector<HTMLInputElement>("#rbar label input");

  const showSettings = () => {
    const field = state.fields.find((item) => item.key === state.selected);
    const input = labelInput();
    if (input) input.value = field ? fieldLabel(field) : "";
    const toggles = field ? fieldToggles(field) : [];
    root.querySelectorAll<HTMLElement>("#rbar .rank .tog").forEach((tog, index) => tog.classList.toggle("on", Boolean(toggles[index]?.on)));
  };

  const select = (key: string | null) => {
    state.selected = key;
    qs.querySelectorAll<HTMLElement>(".qq").forEach((row) => row.classList.toggle("on", row.dataset.key === key));
    showSettings();
    // The server renders the same selection after the next refresh.
    const url = new URL(window.location.href);
    if (key) url.searchParams.set("field", key);
    else url.searchParams.delete("field");
    url.searchParams.set("form", state.key);
    window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}`);
  };

  const save = async () => {
    window.clearTimeout(state.timer);
    state.timer = undefined;
    if (state.fields.length === 0) return;
    const run = (async () => {
      const result = await saveIntakeDraft({ organizationId: state.org, stableKey: state.key, title: state.title, schema: { fields: state.fields }, templateId: state.id, version: state.version });
      if ("error" in result) {
        toast2(result.error, { kind: result.conflict ? "warn" : "bad", sub: result.conflict ? "Your last change wasn’t saved." : "Nothing was saved." });
        state.stale = true;
        router.refresh();
        return;
      }
      state.id = result.id ?? state.id;
      state.version = result.version ?? state.version;
      router.refresh();
    })();
    state.saving = run;
    await run;
    state.saving = null;
  };

  const later = () => {
    window.clearTimeout(state.timer);
    state.timer = window.setTimeout(() => void save(), SAVE_DELAY_MS);
  };

  const add = (label: string) => {
    fresh();
    const field = newField(label, state.fields);
    if (!field) return;
    state.fields = [...state.fields, field];
    select(field.key);
    void save();
  };

  root.addEventListener(
    "click",
    (event) => {
      const target = event.target as HTMLElement;
      if (!root.contains(target)) return;
      const edit = target.closest<HTMLElement>("#qs .qq .btn");
      const row = target.closest<HTMLElement>("#qs .qq[data-key]");
      if (row) {
        event.preventDefault();
        fresh();
        select(row.dataset.key ?? null);
        if (edit) labelInput()?.focus();
        return;
      }
      if (target.closest("#addq")) {
        event.preventDefault();
        add("Short text");
        return;
      }
      const type = target.closest<HTMLElement>(".ib .ft[data-type]");
      if (type) {
        event.preventDefault();
        add(type.dataset.type ?? "");
        return;
      }
      const tog = target.closest<HTMLElement>("#rbar .rank .tog");
      if (tog) {
        event.preventDefault();
        fresh();
        const index = [...root.querySelectorAll("#rbar .rank .tog")].indexOf(tog);
        const position = state.fields.findIndex((item) => item.key === state.selected);
        if (position < 0 || index < 0) return;
        state.fields = state.fields.map((item, at) => (at === position ? toggleField(item, index) : item));
        showSettings();
        later();
        return;
      }
      const publish = target.closest<HTMLElement>("[data-intake-publish]");
      if (publish) {
        event.preventDefault();
        if (publish.getAttribute("aria-busy") === "true") return;
        publish.setAttribute("aria-busy", "true");
        void (async () => {
          if (state.timer) await save();
          if (state.saving) await state.saving;
          if (!state.id || state.version === null) {
            toast2("Nothing new to publish", { kind: "warn", sub: "Change a field first: your edit starts the next version as a draft." });
            return;
          }
          const result = await publishIntakeDraft({ organizationId: state.org, templateId: state.id, version: state.version });
          if ("error" in result) {
            if (result.stepUp) {
              toast2("Confirm it’s you", { kind: "warn", sub: "Then publish again. Your draft is saved." });
              const next = `${window.location.pathname}${window.location.search}`;
              window.setTimeout(() => window.location.assign(`/mfa?step=6&next=${encodeURIComponent(next)}`), 900);
              return;
            }
            toast2(result.error, { kind: "bad", sub: "The draft is unchanged." });
            if (result.conflict) state.stale = true;
            router.refresh();
            return;
          }
          state.id = null;
          state.version = null;
          state.stale = true;
          toast2(`${publish.textContent?.replace(/^Publish/, "Published") || "Published"}`, { kind: "ok", sub: "In effect today. Matters already using an earlier version keep it." });
          router.refresh();
        })().finally(() => publish.removeAttribute("aria-busy"));
      }
    },
    listen,
  );

  root.addEventListener(
    "input",
    (event) => {
      const input = event.target as HTMLElement;
      if (input !== labelInput()) return;
      fresh();
      const position = state.fields.findIndex((item) => item.key === state.selected);
      if (position < 0) return;
      const value = (input as HTMLInputElement).value;
      if (!value.trim()) return;
      state.fields = state.fields.map((item, at) => (at === position ? relabel(item, value.trim()) : item));
      later();
    },
    listen,
  );

  // Drag a field type onto the question list to add it.
  root.addEventListener(
    "dragstart",
    (event) => {
      const type = (event.target as HTMLElement).closest?.<HTMLElement>(".ib .ft[data-type]");
      if (type && event.dataTransfer) event.dataTransfer.setData("text/plain", type.dataset.type ?? "");
    },
    listen,
  );
  qs.addEventListener("dragover", (event) => event.preventDefault(), listen);
  qs.addEventListener(
    "drop",
    (event) => {
      event.preventDefault();
      const label = event.dataTransfer?.getData("text/plain") ?? "";
      if (label) add(label);
    },
    listen,
  );
}
