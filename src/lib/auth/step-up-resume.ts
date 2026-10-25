import { isStepUpActionKey, type StepUpActionKey } from "@/lib/auth/mfa-step";

/**
 * One shared way back from a step-up (`/mfa?step=6`), for every Sheet act and portal action.
 *
 * Before the redirect, `goStepUp` keeps what the person was doing in this tab's sessionStorage
 * under a random token, and adds only that token to `next` (`?resume=<token>`). Back on the page,
 * `resumeStepUp` takes the record (once), checks it, and:
 * - in a dialog: reopens it with what was typed and chosen, and points at the button that
 *   finishes it: one click completes it (the person confirms what is sent);
 * - a single button or control outside a dialog: presses it again, once, since that press is
 *   what the person already did. A second step-up for the same press never presses it again.
 *
 * Never kept: file contents, passwords, one-time codes, or anything marked `data-no-resume`.
 * A token that isn't in this tab's storage, is older than 15 minutes, names an action key
 * outside `mfa-step`'s list, or was made on another page is ignored. The server re-checks the
 * step-up on the resumed call like on any other.
 */

export const RESUME_PARAM = "resume";
const KEY_PREFIX = "casevoya.stepUp.";
export const RESUME_MAX_AGE_MS = 15 * 60_000;
const NONCE = /^[a-f0-9]{32}$/;
const DATA_KEY = /^[a-zA-Z][a-zA-Z0-9]{0,63}$/;
const ELEMENT_ID = /^[A-Za-z][\w:-]{0,127}$/;
const MAX_FIELDS = 200;
const MAX_VALUE = 20_000;
const MAX_DATA = 1_000;
const FIELD_KEY = /^\d{1,3}:[\w:.\-[\]]{0,120}$/;

type FieldValue = string | boolean;
type Data = Record<string, string>;

/** How to find the pressed control again: by id, by its own data-* attributes, or by position under a marked ancestor. */
export type Locator = { tag: string; id?: string; data?: Data; anchor?: { id?: string; data?: Data }; index?: number };

export type PendingStepUp = {
  v: 1;
  action: StepUpActionKey;
  path: string;
  at: number;
  /** 1 for the first step-up of a press; 2 when the resumed press asked for another. */
  attempt: number;
  dialog: { id: string; data: Data } | null;
  /** The dialog's (or form's) fields, keyed `<position>:<id or name>`. */
  fields: Record<string, FieldValue>;
  /** A file was chosen: browsers can't keep it, so it is chosen again. */
  fileChosen: boolean;
  trigger: Locator;
  /** The pressed control's own value, when it is a select, checkbox or field. */
  value?: FieldValue;
  label: string;
};

/** The small part of the DOM this module reads and writes (real elements, or test doubles). */
export type ResumeNode = {
  tagName: string;
  id: string;
  dataset: DOMStringMap;
  children: ArrayLike<ResumeNode> & Iterable<ResumeNode>;
  parentElement: ResumeNode | null;
  textContent: string | null;
  getAttribute(name: string): string | null;
  hasAttribute(name: string): boolean;
  focus?: () => void;
  click?: () => void;
  dispatchEvent?: (event: Event) => boolean;
  // Fields and dialogs.
  type?: string;
  name?: string;
  value?: string;
  checked?: boolean;
  files?: { length: number } | null;
  open?: boolean;
  showModal?: () => void;
};

type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem"> & Partial<Pick<Storage, "key" | "length">>;

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

const PROBE = "https://app.invalid";

/** The step-up href with `resume=<token>` added to its `next`. Anything that isn't a step-up href is returned as is. */
export function withResumeToken(href: string, nonce: string): string {
  let url: URL;
  try {
    url = new URL(href, PROBE);
  } catch {
    return href;
  }
  const next = url.searchParams.get("next");
  if (url.origin !== PROBE || url.pathname !== "/mfa" || !next || !NONCE.test(nonce)) return href;
  const inner = new URL(next, PROBE);
  if (inner.origin !== PROBE) return href;
  inner.searchParams.set(RESUME_PARAM, nonce);
  url.searchParams.set("next", `${inner.pathname}${inner.search}${inner.hash}`);
  return `${url.pathname}${url.search}`;
}

/** What a step-up href says: the action key (`for=`) and the path it comes back to. */
export function readStepUpHref(href: string): { action: StepUpActionKey; path: string } | null {
  try {
    const url = new URL(href, PROBE);
    if (url.origin !== PROBE || url.pathname !== "/mfa") return null;
    const action = url.searchParams.get("for");
    const next = url.searchParams.get("next");
    if (!isStepUpActionKey(action) || !next) return null;
    const inner = new URL(next, PROBE);
    if (inner.origin !== PROBE) return null;
    return { action, path: inner.pathname };
  } catch {
    return null;
  }
}

/** The same path and query without `?resume=`. */
export function withoutResumeToken(pathname: string, search: string): string {
  const params = new URLSearchParams(search);
  params.delete(RESUME_PARAM);
  const query = params.toString();
  return `${pathname}${query ? `?${query}` : ""}`;
}

function isData(value: unknown): value is Data {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const entries = Object.entries(value);
  return entries.length <= 40 && entries.every(([key, item]) => DATA_KEY.test(key) && typeof item === "string" && item.length <= MAX_DATA);
}

function isLocator(value: unknown): value is Locator {
  if (!value || typeof value !== "object") return false;
  const locator = value as Locator;
  if (typeof locator.tag !== "string" || !/^[A-Z][A-Z0-9-]{0,31}$/.test(locator.tag)) return false;
  if (locator.id !== undefined && (typeof locator.id !== "string" || !ELEMENT_ID.test(locator.id))) return false;
  if (locator.data !== undefined && !isData(locator.data)) return false;
  if (locator.anchor !== undefined) {
    const anchor = locator.anchor;
    if (!anchor || typeof anchor !== "object") return false;
    if (anchor.id !== undefined && (typeof anchor.id !== "string" || !ELEMENT_ID.test(anchor.id))) return false;
    if (anchor.data !== undefined && !isData(anchor.data)) return false;
    if (!anchor.id && !anchor.data) return false;
    if (!Number.isInteger(locator.index) || (locator.index ?? -1) < 0 || (locator.index ?? 0) > 500) return false;
  }
  return Boolean(locator.id || (locator.data && Object.keys(locator.data).length) || locator.anchor);
}

function isFieldValue(value: unknown): value is FieldValue {
  return typeof value === "boolean" || (typeof value === "string" && value.length <= MAX_VALUE);
}

/**
 * A stored record, checked before anything is done with it. Null for anything that isn't exactly
 * what `goStepUp` writes, for an action key outside the allow-list, for another page, or when stale.
 */
export function parsePending(raw: unknown, pathname: string, now: number): PendingStepUp | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const record = raw as Partial<PendingStepUp>;
  if (record.v !== 1) return null;
  if (!isStepUpActionKey(record.action)) return null;
  if (typeof record.path !== "string" || record.path !== pathname) return null;
  if (typeof record.at !== "number" || !Number.isFinite(record.at) || record.at > now + 60_000 || now - record.at > RESUME_MAX_AGE_MS) return null;
  if (record.attempt !== 1 && record.attempt !== 2) return null;
  if (record.dialog !== null) {
    const dialog = record.dialog;
    if (!dialog || typeof dialog !== "object" || typeof dialog.id !== "string" || !ELEMENT_ID.test(dialog.id) || !isData(dialog.data)) return null;
  }
  const fields = record.fields;
  if (!fields || typeof fields !== "object" || Array.isArray(fields)) return null;
  const entries = Object.entries(fields);
  if (entries.length > MAX_FIELDS || !entries.every(([key, value]) => FIELD_KEY.test(key) && isFieldValue(value))) return null;
  if (typeof record.fileChosen !== "boolean") return null;
  if (!isLocator(record.trigger)) return null;
  if (record.value !== undefined && !isFieldValue(record.value)) return null;
  if (typeof record.label !== "string" || record.label.length > 120) return null;
  return {
    v: 1,
    action: record.action,
    path: record.path,
    at: record.at,
    attempt: record.attempt,
    dialog: record.dialog ? { id: record.dialog.id, data: { ...record.dialog.data } } : null,
    fields: Object.fromEntries(entries),
    fileChosen: record.fileChosen,
    trigger: record.trigger,
    ...(record.value !== undefined ? { value: record.value } : {}),
    label: record.label,
  };
}

/** A fresh random token (32 hex characters). */
export function makeNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** Keeps a record under its token, dropping stale ones. */
export function storePending(storage: StorageLike, nonce: string, record: PendingStepUp, now: number) {
  try {
    const count = typeof storage.length === "number" ? storage.length : 0;
    const stale: string[] = [];
    for (let index = 0; index < count; index += 1) {
      const key = storage.key?.(index);
      if (!key?.startsWith(KEY_PREFIX)) continue;
      const at = (JSON.parse(storage.getItem(key) ?? "null") as { at?: number } | null)?.at;
      if (typeof at !== "number" || now - at > RESUME_MAX_AGE_MS) stale.push(key);
    }
    stale.forEach((key) => storage.removeItem(key));
  } catch {
    // Pruning is housekeeping only.
  }
  storage.setItem(`${KEY_PREFIX}${nonce}`, JSON.stringify(record));
}

/** Takes (and always removes) the record a token names; null when it is unknown, tampered or stale. */
export function takePending(storage: StorageLike, nonce: string | null, pathname: string, now: number): PendingStepUp | null {
  if (!nonce || !NONCE.test(nonce)) return null;
  try {
    const key = `${KEY_PREFIX}${nonce}`;
    const raw = storage.getItem(key);
    storage.removeItem(key);
    return raw ? parsePending(JSON.parse(raw), pathname, now) : null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// The DOM side
// ---------------------------------------------------------------------------

const FIELD_TAGS = new Set(["INPUT", "TEXTAREA", "SELECT"]);
const SKIPPED_TYPES = new Set(["file", "password", "submit", "button", "reset", "image"]);
const ACTIONABLE_TAGS = new Set(["BUTTON", "A", "INPUT", "SELECT", "TEXTAREA", "SUMMARY"]);
const ACTIONABLE_ROLES = new Set(["button", "switch", "menuitem", "menuitemradio", "menuitemcheckbox", "tab", "checkbox", "radio", "option"]);

function* descendants(node: ResumeNode): Generator<ResumeNode> {
  for (const child of Array.from(node.children)) {
    yield child;
    yield* descendants(child);
  }
}

function ancestor(node: ResumeNode, test: (item: ResumeNode) => boolean): ResumeNode | null {
  for (let item: ResumeNode | null = node; item; item = item.parentElement) if (test(item)) return item;
  return null;
}

function dataOf(node: ResumeNode): Data {
  const out: Data = {};
  for (const [key, value] of Object.entries(node.dataset)) {
    if (typeof value === "string" && DATA_KEY.test(key) && value.length <= MAX_DATA) out[key] = value;
  }
  return out;
}

function hasData(data: Data | undefined): data is Data {
  return Boolean(data && Object.keys(data).length);
}

function dataMatches(node: ResumeNode, data: Data): boolean {
  return Object.entries(data).every(([key, value]) => node.dataset[key] === value);
}

/** Puts back data-* an opener had set (only where the page left it empty; never over a value it rendered). */
function fillData(node: ResumeNode, data: Data) {
  for (const [key, value] of Object.entries(data)) if (!node.dataset[key]) node.dataset[key] = value;
}

/** The control a click or change landed on, or null. */
export function actionableFrom(target: ResumeNode | null): ResumeNode | null {
  return target ? ancestor(target, (item) => ACTIONABLE_TAGS.has(item.tagName) || ACTIONABLE_ROLES.has(item.getAttribute("role") ?? "")) : null;
}

function isField(node: ResumeNode): boolean {
  return FIELD_TAGS.has(node.tagName);
}

function isToggle(node: ResumeNode): boolean {
  return node.tagName === "INPUT" && (node.type === "checkbox" || node.type === "radio");
}

/** Fields worth keeping: never files, passwords, one-time codes or anything marked data-no-resume. */
function keptField(node: ResumeNode): boolean {
  if (!isField(node)) return false;
  if (node.tagName === "INPUT" && SKIPPED_TYPES.has(node.type ?? "text")) return false;
  if ((node.getAttribute("autocomplete") ?? "").toLowerCase() === "one-time-code") return false;
  return !node.hasAttribute("data-no-resume");
}

function fieldsOf(scope: ResumeNode): ResumeNode[] {
  return [...descendants(scope)].filter(isField);
}

function fieldKey(node: ResumeNode, index: number): string {
  return `${index}:${(node.id || node.name || "").slice(0, 120)}`;
}

function readFields(scope: ResumeNode | null): { fields: Record<string, FieldValue>; fileChosen: boolean } {
  const fields: Record<string, FieldValue> = {};
  let fileChosen = false;
  if (!scope) return { fields, fileChosen };
  fieldsOf(scope).forEach((node, index) => {
    if (node.tagName === "INPUT" && node.type === "file" && (node.files?.length ?? 0) > 0) fileChosen = true;
    if (!keptField(node) || index >= MAX_FIELDS || !FIELD_KEY.test(fieldKey(node, index))) return;
    const value = isToggle(node) ? Boolean(node.checked) : (node.value ?? "").slice(0, MAX_VALUE);
    fields[fieldKey(node, index)] = value;
  });
  return { fields, fileChosen };
}

function fire(node: ResumeNode, type: "input" | "change") {
  if (typeof Event === "function") node.dispatchEvent?.(new Event(type, { bubbles: true }));
}

function setField(node: ResumeNode, value: FieldValue): boolean {
  if (isToggle(node)) {
    if (typeof value !== "boolean" || node.checked === value) return false;
    node.checked = value;
  } else {
    if (typeof value !== "string" || node.value === value) return false;
    node.value = value;
  }
  return true;
}

function restoreFields(scope: ResumeNode, fields: Record<string, FieldValue>) {
  fieldsOf(scope).forEach((node, index) => {
    const key = fieldKey(node, index);
    if (!Object.hasOwn(fields, key) || !keptField(node)) return;
    if (setField(node, fields[key])) {
      fire(node, "input");
      fire(node, "change");
    }
  });
}

function scopeOf(node: ResumeNode, root: ResumeNode): { dialog: ResumeNode | null; form: ResumeNode | null } {
  const inside = (test: (item: ResumeNode) => boolean) => {
    const found = ancestor(node, (item) => item === root || test(item));
    return found && found !== root ? found : null;
  };
  return { dialog: inside((item) => item.tagName === "DIALOG"), form: inside((item) => item.tagName === "FORM") };
}

/** How to find `node` again: its id, its own data-* attributes, or its position under the nearest marked ancestor (or its dialog). */
export function locate(node: ResumeNode, root: ResumeNode): Locator | null {
  const tag = node.tagName;
  if (node.id && ELEMENT_ID.test(node.id)) return { tag, id: node.id, data: dataOf(node) };
  const data = dataOf(node);
  const { dialog } = scopeOf(node, root);
  const marked = ancestor(node.parentElement ?? node, (item) => item === root || item === dialog || Boolean(item.id) || hasData(dataOf(item)));
  const anchor = marked && marked !== root ? marked : null;
  let place: Pick<Locator, "anchor" | "index"> = {};
  if (anchor && (anchor.id ? ELEMENT_ID.test(anchor.id) : true)) {
    const index = [...descendants(anchor)].filter((item) => item.tagName === tag).indexOf(node);
    if (index >= 0) place = { anchor: anchor.id ? { id: anchor.id } : { data: dataOf(anchor) }, index };
  }
  if (!hasData(data) && !place.anchor) return null;
  return { tag, ...(hasData(data) ? { data } : {}), ...place };
}

function only(nodes: ResumeNode[]): ResumeNode | null {
  return nodes.length === 1 ? nodes[0] : null;
}

/** Finds the control again under `scope`; null when it isn't there or more than one fits. */
export function findLocated(scope: ResumeNode, locator: Locator): ResumeNode | null {
  const all = [...descendants(scope)];
  if (locator.id) return only(all.filter((item) => item.id === locator.id && item.tagName === locator.tag));
  if (hasData(locator.data)) {
    const found = only(all.filter((item) => item.tagName === locator.tag && dataMatches(item, locator.data as Data)));
    if (found) return found;
  }
  if (locator.anchor && locator.index !== undefined) {
    const anchor = locator.anchor;
    const at = anchor.id
      ? only(all.filter((item) => item.id === anchor.id))
      : hasData(anchor.data)
        ? only(all.filter((item) => dataMatches(item, anchor.data as Data)))
        : null;
    // The anchor can be the scope itself (a dialog whose button has no marks of its own).
    const base = at ?? (anchor.id && scope.id === anchor.id ? scope : null);
    if (base) return [...descendants(base)].filter((item) => item.tagName === locator.tag)[locator.index] ?? null;
  }
  return null;
}

function labelOf(node: ResumeNode): string {
  const text = (node.getAttribute("aria-label") || node.textContent || "").replace(/\s+/g, " ").trim();
  return text.length > 60 ? `${text.slice(0, 59)}…` : text;
}

/** The record for a press that the server answered with "step-up needed". Null when it can't be resumed. */
export function capturePending(
  trigger: ResumeNode,
  root: ResumeNode,
  href: string,
  now: number,
  attempt: 1 | 2 = 1,
): PendingStepUp | null {
  const target = readStepUpHref(href);
  if (!target) return null;
  const locator = locate(trigger, root);
  if (!locator) return null;
  const { dialog, form } = scopeOf(trigger, root);
  if (dialog && !(dialog.id && ELEMENT_ID.test(dialog.id))) return null;
  const { fields, fileChosen } = readFields(dialog ?? form);
  const own = isField(trigger) && keptField(trigger) ? (isToggle(trigger) ? Boolean(trigger.checked) : (trigger.value ?? "").slice(0, MAX_VALUE)) : undefined;
  return {
    v: 1,
    action: target.action,
    path: target.path,
    at: now,
    attempt,
    dialog: dialog ? { id: dialog.id, data: dataOf(dialog) } : null,
    fields,
    fileChosen,
    trigger: locator,
    ...(own !== undefined ? { value: own } : {}),
    label: labelOf(trigger),
  };
}

export type ResumeOutcome = "wait" | "reopened" | "dispatched" | "pointed";
export type Notify = (title: string, sub: string, kind: "ok" | "warn") => void;

function pressSub(record: PendingStepUp): string {
  const press = record.label ? `Press “${record.label}” to finish.` : "Press the button again to finish.";
  return record.fileChosen ? `Choose the file again, then ${press.charAt(0).toLowerCase()}${press.slice(1)}` : press;
}

/**
 * Puts a pending action back on the page. "wait" means the page hasn't rendered what it needs yet
 * (the caller tries again shortly). `onDispatch` runs just before a press is repeated.
 */
export function applyPending(root: ResumeNode, record: PendingStepUp, notify: Notify, onDispatch: (record: PendingStepUp) => void): ResumeOutcome {
  if (record.dialog) {
    const dialogId = record.dialog.id;
    const dialog = [...descendants(root)].find((item) => item.tagName === "DIALOG" && item.id === dialogId) ?? null;
    if (!dialog) return "wait";
    // The same values the page's own `?dlg=` return puts back, when it has one (setting is idempotent).
    fillData(dialog, record.dialog.data);
    restoreFields(dialog, record.fields);
    if (!dialog.open) dialog.showModal?.();
    const trigger = findLocated(dialog, record.trigger);
    // A dialog button filled by its opener gets back what it carried.
    if (trigger && hasData(record.trigger.data)) fillData(trigger, record.trigger.data);
    trigger?.focus?.();
    notify("Check done", pressSub(record), "ok");
    return "reopened";
  }

  const trigger = findLocated(root, record.trigger);
  if (!trigger) return "wait";
  const { form } = scopeOf(trigger, root);
  if (form) restoreFields(form, record.fields);
  if (record.attempt > 1 || record.fileChosen) {
    trigger.focus?.();
    notify("Check done", pressSub(record), "ok");
    return "pointed";
  }
  if (isField(trigger)) {
    const differs = record.value !== undefined && (isToggle(trigger) ? trigger.checked !== record.value : trigger.value !== record.value);
    if (!differs) {
      trigger.focus?.();
      notify("Check done", pressSub(record), "ok");
      return "pointed";
    }
    onDispatch(record);
    if (isToggle(trigger)) {
      trigger.click?.();
      return "dispatched";
    }
    setField(trigger, record.value as FieldValue);
    fire(trigger, "input");
    fire(trigger, "change");
    return "dispatched";
  }
  onDispatch(record);
  trigger.click?.();
  return "dispatched";
}

// ---------------------------------------------------------------------------
// The browser entry points
// ---------------------------------------------------------------------------

let lastTrigger: ResumeNode | null = null;
let lastRoot: ResumeNode | null = null;
let lastNotedAt = 0;
/** A press older than this is not the one the server just answered. */
const TRIGGER_MAX_AGE_MS = 2 * 60_000;
/** Set while a resumed press runs, so a second step-up for it is never pressed again. */
let resumedUntil = 0;

/** The Sheet's and the portal's root listeners call this on every click and change. */
export function noteStepUpTrigger(target: EventTarget | null, root: ResumeNode) {
  const hit = target && typeof target === "object" && "tagName" in target ? (target as unknown as ResumeNode) : null;
  // A control, else the nearest element an act handler can key on (one with data-*).
  const marked = hit ? ancestor(hit, (item) => item === root || hasData(dataOf(item))) : null;
  const node = hit ? (actionableFrom(hit) ?? (marked === root ? null : marked)) : null;
  // A click on something that isn't a control forgets the last one: an older press is never resumed.
  lastTrigger = node;
  lastRoot = root;
  lastNotedAt = Date.now();
}

function rootFor(trigger: ResumeNode): ResumeNode {
  if (lastRoot && ancestor(trigger, (item) => item === lastRoot)) return lastRoot;
  return ancestor(trigger, (item) => item.parentElement === null || item.tagName === "BODY") ?? trigger;
}

/**
 * Sends the person to a step-up href, keeping what they were doing so it resumes on return.
 * `trigger` defaults to the last control pressed in the Sheet or portal.
 */
export function goStepUp(href: string, trigger?: Element | null) {
  let target = href;
  try {
    const now = Date.now();
    const pressed = (trigger as unknown as ResumeNode | null | undefined) ?? (now - lastNotedAt < TRIGGER_MAX_AGE_MS ? lastTrigger : null);
    const record = pressed ? capturePending(pressed, rootFor(pressed), href, now, now < resumedUntil ? 2 : 1) : null;
    if (record) {
      const nonce = makeNonce();
      storePending(window.sessionStorage, nonce, record, now);
      target = withResumeToken(href, nonce);
    }
  } catch {
    // Without storage the person goes back and does it again, as before.
  }
  window.location.assign(target);
}

/**
 * Back from a step-up: finds `?resume=`, takes it off the URL, and puts the action back (polling
 * briefly while the page renders). Returns a function that stops the polling.
 */
export function resumeStepUp(root: HTMLElement, notify: Notify): () => void {
  if (!new URLSearchParams(window.location.search).has(RESUME_PARAM)) return () => {};
  let timer = 0;
  let tries = 0;
  let pending: PendingStepUp | null = null;
  const attempt = () => {
    if (!pending) {
      // Taken only now, so an effect that is torn down before this runs (React's dev double run) keeps it.
      const nonce = new URLSearchParams(window.location.search).get(RESUME_PARAM);
      if (nonce === null) return;
      window.history.replaceState(window.history.state, "", withoutResumeToken(window.location.pathname, window.location.search));
      try {
        pending = takePending(window.sessionStorage, nonce, window.location.pathname, Date.now());
      } catch {
        pending = null;
      }
      if (!pending) return;
    }
    const outcome = applyPending(root as unknown as ResumeNode, pending, notify, () => {
      resumedUntil = Date.now() + 60_000;
    });
    if (outcome !== "wait") return;
    tries += 1;
    if (tries < 25) {
      timer = window.setTimeout(attempt, 200);
      return;
    }
    notify("Check done", "Do it again to finish. Nothing was saved before the check.", "warn");
  };
  // After the page's own `?dlg=` returns (300 ms), so a dialog they reopen keeps their values.
  timer = window.setTimeout(attempt, 600);
  return () => window.clearTimeout(timer);
}
