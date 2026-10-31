import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { stepUpHref } from "@/lib/auth/mfa-step";
import { safeAccessError } from "@/lib/auth/step-up";
import {
  applyPending,
  capturePending,
  goStepUp,
  noteStepUpTrigger,
  parsePending,
  readStepUpHref,
  resumeStepUp,
  RESUME_MAX_AGE_MS,
  storePending,
  takePending,
  withResumeToken,
  withoutResumeToken,
  type PendingStepUp,
  type ResumeNode,
} from "@/lib/auth/step-up-resume";
import { FakeEl, FakeStorage, h } from "./helpers/fake-dom";

/**
 * Bug 1 (2026-10-25): after a fresh step-up the pending action was lost (SRC "Approve and
 * publish", the document request). One shared resume now carries a token through /mfa.
 */

const reviewRuleVersion = vi.fn();
const createDocumentRequest = vi.fn();
const toast2 = vi.fn();

vi.mock("@/modules/content-governance/claim-actions", () => ({
  addRuleClaim: vi.fn(),
  resolveRuleApplicability: vi.fn(),
  reviewRuleVersion: (...args: unknown[]) => reviewRuleVersion(...args),
  suspendRuleVersion: vi.fn(),
}));
vi.mock("@/modules/documents/actions", () => ({ createDocumentRequest: (...args: unknown[]) => createDocumentRequest(...args) }));
vi.mock("@/components/port/kit", () => ({ toast2: (...args: unknown[]) => toast2(...args) }));

const { runClaimAct } = await import("@/components/sheet/source-claim-acts");
const { runDocRequest } = await import("@/components/sheet/doc-request-act");

const STEP_UP = safeAccessError("step-up is required");
const ORG = "00000000-0000-4000-8000-0000000000a1";
const VERSION = "00000000-0000-4000-8000-0000000000b2";
const MATTER = "00000000-0000-4000-8000-0000000000c3";
const PERSON = "00000000-0000-4000-8000-0000000000d4";
const NONCE = "0123456789abcdef0123456789abcdef";

type Win = {
  location: { pathname: string; search: string; assign: ReturnType<typeof vi.fn> };
  sessionStorage: FakeStorage;
  history: { state: null; replaceState: (state: unknown, title: string, url: string) => void };
  setTimeout: typeof setTimeout;
  clearTimeout: typeof clearTimeout;
};

let win: Win;

function goTo(href: string) {
  const url = new URL(href, "https://app.invalid");
  win.location.pathname = url.pathname;
  win.location.search = url.search;
}

beforeEach(() => {
  reviewRuleVersion.mockReset();
  createDocumentRequest.mockReset();
  toast2.mockReset();
  win = {
    location: { pathname: "/", search: "", assign: vi.fn() },
    sessionStorage: new FakeStorage(),
    history: { state: null, replaceState: (_state, _title, url) => goTo(url) },
    setTimeout: ((...args: Parameters<typeof setTimeout>) => setTimeout(...args)) as typeof setTimeout,
    clearTimeout: ((id: Parameters<typeof clearTimeout>[0]) => clearTimeout(id)) as typeof clearTimeout,
  };
  vi.stubGlobal("window", win);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const node = (el: FakeEl) => el as unknown as ResumeNode;
const html = (el: FakeEl) => el as unknown as HTMLElement;

/** Where goStepUp sent the person: the /mfa href and the `next` it comes back to. */
function sentTo(): { href: string; next: URL } {
  const href = String(win.location.assign.mock.calls.at(-1)?.[0]);
  const next = new URL(new URL(href, "https://app.invalid").searchParams.get("next") ?? "", "https://app.invalid");
  return { href, next };
}

/** Back from /mfa on `next`: the page renders anew and the shared resume runs. */
async function comeBack(next: URL, page: FakeEl) {
  goTo(`${next.pathname}${next.search}`);
  const notify = vi.fn();
  vi.useFakeTimers();
  resumeStepUp(html(page), notify);
  await vi.advanceTimersByTimeAsync(700);
  vi.useRealTimers();
  return notify;
}

// ---------------------------------------------------------------------------
// The SRC review workbench: Approve and publish (#dlgClaimApprove).
// ---------------------------------------------------------------------------

function approvePage(): { root: FakeEl; dialog: FakeEl; button: FakeEl } {
  const button = h("button", { class: "btn p", "data-claim-act": "approve", "data-org": ORG, "data-id": VERSION, "data-v": "3" }, "Approve and publish");
  const dialog = h(
    "dialog",
    { class: "dlg", id: "dlgClaimApprove" },
    h("div", { class: "db" },
      h("input", { class: "inp", id: "caD", type: "date", min: "2026-10-25", value: "2027-10-25" }),
      h("textarea", { class: "ta", id: "caN" }),
      h("label", {}, h("input", { type: "date", max: "2026-10-25", value: "2026-10-25", "data-attest-on": "" })),
      h("label", {}, h("input", { type: "checkbox", "data-attest": "" })),
    ),
    h("div", { class: "df" }, h("button", { class: "btn", "data-close": "dlgClaimApprove" }, "Cancel"), button),
  );
  const root = h("div", { class: "shell" }, h("main", {}, h("button", { "data-dlg": "dlgClaimApprove" }, "Approve")), dialog);
  return { root, dialog, button };
}

describe("Approve and publish after a fresh step-up", () => {
  it("comes back to the claim with the dialog open, what was typed intact, and one press approves it", async () => {
    goTo(`/sheet/templates?tab=rule&view=${VERSION}`);
    const first = approvePage();
    first.dialog.showModal();
    (first.dialog.querySelector("#caN") as FakeEl).value = "Matches the page as of today.";
    (first.dialog.querySelector("#caD") as FakeEl).value = "2027-04-01";
    (first.dialog.querySelector("input[data-attest-on]") as FakeEl).value = "2026-10-24";
    (first.dialog.querySelector("input[data-attest]") as FakeEl).checked = true;

    // The press: the server answers that a fresh step-up is needed; nothing is approved.
    reviewRuleVersion.mockResolvedValueOnce({ error: STEP_UP });
    noteStepUpTrigger(first.button as unknown as EventTarget, node(first.root));
    await runClaimAct(first.button as unknown as HTMLElement, first.root as unknown as HTMLElement, { refresh: vi.fn(), replace: vi.fn() });
    expect(reviewRuleVersion).toHaveBeenCalledTimes(1);
    const { href, next } = sentTo();
    expect(href).toMatch(/^\/mfa\?step=6&next=/);
    expect(href).toContain("for=rule_approve");
    expect(next.pathname).toBe("/sheet/templates");
    expect(next.searchParams.get("view")).toBe(VERSION);
    expect(next.searchParams.get("resume")).toMatch(/^[a-f0-9]{32}$/);
    // Only the token travels in the URL; what was typed stays in this tab.
    expect(href).not.toContain("Matches");

    // Back from /mfa: a fresh page, the dialog reopened with the inputs, the button pointed at.
    const again = approvePage();
    const notify = await comeBack(next, again.root);
    expect(win.location.search).not.toContain("resume=");
    expect(again.dialog.open).toBe(true);
    expect((again.dialog.querySelector("#caN") as FakeEl).value).toBe("Matches the page as of today.");
    expect((again.dialog.querySelector("#caD") as FakeEl).value).toBe("2027-04-01");
    expect((again.dialog.querySelector("input[data-attest-on]") as FakeEl).value).toBe("2026-10-24");
    expect((again.dialog.querySelector("input[data-attest]") as FakeEl).checked).toBe(true);
    expect(again.button.focused).toBe(true);
    // A confirmation dialog is never sent on its own.
    expect(again.button.clicks).toBe(0);
    expect(reviewRuleVersion).toHaveBeenCalledTimes(1);
    expect(notify).toHaveBeenCalledWith("Check done", "Press “Approve and publish” to finish.", "ok");

    // One press completes it, through the same server action (which re-checks the step-up).
    reviewRuleVersion.mockResolvedValueOnce({ ok: true });
    await runClaimAct(again.button as unknown as HTMLElement, again.root as unknown as HTMLElement, { refresh: vi.fn(), replace: vi.fn() });
    expect(reviewRuleVersion).toHaveBeenLastCalledWith({
      organizationId: ORG,
      versionId: VERSION,
      version: 3,
      decision: "approved",
      note: "Matches the page as of today.",
      nextReviewOn: "2027-04-01",
      pageOpenedOn: "2026-10-24",
    });
    expect(again.dialog.open).toBe(false);
    expect(toast2).toHaveBeenLastCalledWith("Approved and published", expect.objectContaining({ kind: "ok" }));
  });

  it("keeps the record single-use: a reload of the same URL does nothing", async () => {
    goTo(`/sheet/templates?tab=rule&view=${VERSION}`);
    const first = approvePage();
    reviewRuleVersion.mockResolvedValueOnce({ error: STEP_UP });
    noteStepUpTrigger(first.button as unknown as EventTarget, node(first.root));
    await runClaimAct(first.button as unknown as HTMLElement, first.root as unknown as HTMLElement, { refresh: vi.fn(), replace: vi.fn() });
    const { next } = sentTo();
    await comeBack(next, approvePage().root);
    const reload = approvePage();
    const notify = await comeBack(next, reload.root);
    expect(reload.dialog.open).toBe(false);
    expect(notify).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// The document request (#dReq): what the client is asked to upload in their portal.
// ---------------------------------------------------------------------------

function requestPage(): { root: FakeEl; dialog: FakeEl; button: FakeEl } {
  const button = h("button", { class: "btn p", "data-doc-request": "1", "data-org": ORG, "data-matter": MATTER }, "Send request");
  const dialog = h(
    "dialog",
    { class: "dlg wide", id: "dReq" },
    h("select", { class: "sel", id: "drqP", value: PERSON }, h("option", { value: PERSON }, "Priya")),
    h("input", { class: "inp", id: "drqW" }),
    h("input", { class: "inp", id: "drqD", type: "date", min: "2026-10-25" }),
    h("select", { class: "sel", id: "drqS", value: "ordinary" }),
    h("textarea", { class: "ta", id: "drqE" }),
    h("textarea", { class: "ta", id: "drqR" }),
    h("select", { class: "sel", id: "drqA", value: "subject" }),
    h("label", {}, h("input", { type: "checkbox", name: "drqF", value: "pdf", checked: true })),
    h("label", {}, h("input", { type: "checkbox", name: "drqF", value: "jpeg" })),
    h("label", {}, h("input", { type: "file", id: "drqX" })),
    h("label", {}, h("input", { id: "drqC", autocomplete: "one-time-code" })),
    h("div", { class: "df" }, button),
  );
  return { root: h("div", { class: "shell" }, dialog), dialog, button };
}

describe("Request a document after a fresh step-up", () => {
  it("reopens the request with every field, never a one-time code, and one press sends it", async () => {
    goTo(`/sheet/matters/${MATTER}?tab=documents`);
    const first = requestPage();
    const set = (id: string, value: string) => ((first.dialog.querySelector(`#${id}`) as FakeEl).value = value);
    set("drqW", "Passport, all pages");
    set("drqE", "Every page, including blank ones.");
    set("drqD", "2026-11-30");
    set("drqC", "123456");
    (first.dialog.querySelectorAll('input[name="drqF"]')[1] as FakeEl).checked = true;

    createDocumentRequest.mockResolvedValueOnce({ error: STEP_UP });
    noteStepUpTrigger(first.button as unknown as EventTarget, node(first.root));
    await runDocRequest(first.button as unknown as HTMLElement, { replace: vi.fn(), refresh: vi.fn() });
    const { href, next } = sentTo();
    expect(href).toContain("for=document_request");
    expect(next.searchParams.get("dlg")).toBe("request");
    const stored = [...win.sessionStorage.map.entries()].find(([key]) => key.startsWith("casevoya.stepUp."));
    expect(stored?.[1]).toContain("Passport, all pages");
    expect(stored?.[1]).not.toContain("123456");

    const again = requestPage();
    await comeBack(next, again.root);
    const value = (id: string) => (again.dialog.querySelector(`#${id}`) as FakeEl).value;
    expect(again.dialog.open).toBe(true);
    expect(value("drqW")).toBe("Passport, all pages");
    expect(value("drqE")).toBe("Every page, including blank ones.");
    expect(value("drqD")).toBe("2026-11-30");
    expect(value("drqC")).toBe("");
    expect((again.dialog.querySelectorAll('input[name="drqF"]:checked') as FakeEl[]).map((box) => box.value)).toEqual(["pdf", "jpeg"]);
    expect(again.button.focused).toBe(true);
    expect(again.button.clicks).toBe(0);

    createDocumentRequest.mockResolvedValueOnce({ id: "r-1" });
    await runDocRequest(again.button as unknown as HTMLElement, { replace: vi.fn(), refresh: vi.fn() });
    expect(createDocumentRequest).toHaveBeenLastCalledWith(
      expect.objectContaining({
        organizationId: ORG,
        matterId: MATTER,
        personId: PERSON,
        purpose: "Passport, all pages",
        explanation: "Every page, including blank ones.",
        dueOn: "2026-11-30",
        acceptableFormats: ["pdf", "jpeg"],
      }),
    );
    expect(toast2).toHaveBeenLastCalledWith("Document requested", expect.objectContaining({ kind: "ok" }));
  });
});

// ---------------------------------------------------------------------------
// A single press outside a dialog (the portal's privacy download, Support access, go live…).
// ---------------------------------------------------------------------------

function downloadPage(): { root: FakeEl; button: FakeEl } {
  const button = h("button", { class: "btn sm", type: "button", "data-privacy-download": "d-1" }, "Download");
  return { root: h("div", { class: "shell-portal" }, h("span", {}, button)), button };
}

describe("A single press resumes on its own, once", () => {
  it("presses it again after the check; if that press needs another check, it only points at it", async () => {
    goTo("/portal");
    const first = downloadPage();
    goStepUp(stepUpHref("/portal", "privacy_download"), first.button as unknown as Element);
    const { next } = sentTo();
    expect(next.searchParams.get("resume")).toMatch(/^[a-f0-9]{32}$/);

    // Back: pressed again, once. The resumed press is answered "step-up needed" again.
    const again = downloadPage();
    again.button.onclick = () => goStepUp(stepUpHref("/portal", "privacy_download"), again.button as unknown as Element);
    await comeBack(next, again.root);
    expect(again.button.clicks).toBe(1);
    const second = sentTo();
    expect(second.next.searchParams.get("resume")).toMatch(/^[a-f0-9]{32}$/);

    // Back the second time: no loop, the person presses it themselves.
    const third = downloadPage();
    const notify = await comeBack(second.next, third.root);
    expect(third.button.clicks).toBe(0);
    expect(third.button.focused).toBe(true);
    expect(notify).toHaveBeenCalledWith("Check done", "Press “Download” to finish.", "ok");
  });

  it("finds a button with no marks of its own by its marked ancestor (Switch to live)", () => {
    const button = h("button", { type: "button", class: "btn p" }, "Switch to live");
    const root = h("div", {}, h("div", { "data-golive": "steps" }, h("button", {}, "Other")), h("div", { "data-golive": "switch" }, button));
    goTo("/sheet/sample-mode");
    const record = capturePending(node(button), node(root), stepUpHref("/sheet/sample-mode", "go_live"), Date.now());
    expect(record?.trigger).toEqual({ tag: "BUTTON", anchor: { data: { golive: "switch" } }, index: 0 });
    const fresh = h("button", { type: "button", class: "btn p" }, "Switch to live");
    const page = h("div", {}, h("div", { "data-golive": "steps" }, h("button", {}, "Other")), h("div", { "data-golive": "switch" }, fresh));
    const onDispatch = vi.fn();
    expect(applyPending(node(page), record as PendingStepUp, vi.fn(), onDispatch)).toBe("dispatched");
    expect(fresh.clicks).toBe(1);
    expect(onDispatch).toHaveBeenCalledTimes(1);
  });

  it("only points when the control now at the saved position reads differently (a list re-rendered)", () => {
    const button = h("button", { type: "button" }, "Approve");
    const root = h("div", {}, h("div", { "data-rows": "list" }, button, h("button", { type: "button" }, "Decline")));
    goTo("/sheet/grants");
    const record = capturePending(node(button), node(root), stepUpHref("/sheet/grants", "go_live"), Date.now());
    expect(record?.trigger).toEqual({ tag: "BUTTON", anchor: { data: { rows: "list" } }, index: 0 });
    const neighbour = h("button", { type: "button" }, "Decline");
    const page = h("div", {}, h("div", { "data-rows": "list" }, neighbour, h("button", { type: "button" }, "Approve")));
    const onDispatch = vi.fn();
    expect(applyPending(node(page), record as PendingStepUp, vi.fn(), onDispatch)).toBe("pointed");
    expect(neighbour.clicks).toBe(0);
    expect(onDispatch).not.toHaveBeenCalled();
  });

  it("never resumes an older press: a click elsewhere forgets it", () => {
    goTo("/portal");
    const page = downloadPage();
    const text = h("p", {}, "Some words");
    page.root.children.push(text);
    text.parentElement = page.root;
    noteStepUpTrigger(page.button as unknown as EventTarget, node(page.root));
    noteStepUpTrigger(text as unknown as EventTarget, node(page.root));
    goStepUp(stepUpHref("/portal", "privacy_download"));
    expect(sentTo().next.searchParams.has("resume")).toBe(false);
    expect(win.sessionStorage.length).toBe(0);
  });

  it("never presses a control it can't tell apart from another", () => {
    const record = capturePending(node(h("button", {}, "Save")), node(h("div", {})), stepUpHref("/sheet", "firm_settings"), Date.now());
    expect(record).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Tampered, unknown or stale records are ignored.
// ---------------------------------------------------------------------------

function validRecord(over: Partial<PendingStepUp> = {}): PendingStepUp {
  return {
    v: 1,
    action: "privacy_download",
    path: "/portal",
    at: 1_000_000,
    attempt: 1,
    dialog: null,
    fields: {},
    fileChosen: false,
    trigger: { tag: "BUTTON", data: { privacyDownload: "d-1" } },
    label: "Download",
    ...over,
  };
}

describe("An invalid or tampered pending action is ignored", () => {
  it("accepts only what goStepUp writes, for an allow-listed action, on the same page, while fresh", () => {
    const now = 1_000_000;
    expect(parsePending(validRecord(), "/portal", now)).toEqual(validRecord());
    expect(parsePending({ ...validRecord(), action: "drop_firm" }, "/portal", now)).toBeNull();
    expect(parsePending(validRecord(), "/portal/payments", now)).toBeNull();
    expect(parsePending(validRecord(), "/portal", now + RESUME_MAX_AGE_MS + 1)).toBeNull();
    expect(parsePending({ ...validRecord(), attempt: 7 }, "/portal", now)).toBeNull();
    expect(parsePending({ ...validRecord(), v: 2 }, "/portal", now)).toBeNull();
    expect(parsePending({ ...validRecord(), dialog: { id: "x onerror=alert(1)", data: {} } }, "/portal", now)).toBeNull();
    expect(parsePending({ ...validRecord(), fields: { "0:caN": { evil: true } } }, "/portal", now)).toBeNull();
    expect(parsePending({ ...validRecord(), fields: { "../x": "1" } }, "/portal", now)).toBeNull();
    expect(parsePending({ ...validRecord(), trigger: { tag: "BUTTON" } }, "/portal", now)).toBeNull();
    expect(parsePending({ ...validRecord(), trigger: { tag: "BUTTON", data: { "on-click": "x" } } }, "/portal", now)).toBeNull();
    expect(parsePending("not a record", "/portal", now)).toBeNull();
  });

  it("takes a record once, and only by a well-formed token this tab wrote", () => {
    const storage = new FakeStorage();
    storePending(storage, NONCE, validRecord(), 1_000_000);
    expect(takePending(storage, "../../etc", "/portal", 1_000_000)).toBeNull();
    expect(takePending(storage, "f".repeat(32), "/portal", 1_000_000)).toBeNull();
    expect(takePending(storage, NONCE, "/portal", 1_000_000)).toEqual(validRecord());
    expect(takePending(storage, NONCE, "/portal", 1_000_000)).toBeNull();
    // Changed in storage after it was written: refused, and removed.
    storePending(storage, NONCE, validRecord(), 1_000_000);
    storage.setItem(`casevoya.stepUp.${NONCE}`, JSON.stringify({ ...validRecord(), action: "everything" }));
    expect(takePending(storage, NONCE, "/portal", 1_000_000)).toBeNull();
    expect(storage.length).toBe(0);
  });

  it("does nothing for a crafted link whose token this tab never wrote", async () => {
    const page = downloadPage();
    const notify = await comeBack(new URL(`/portal?resume=${NONCE}`, "https://app.invalid"), page.root);
    expect(page.button.clicks).toBe(0);
    expect(notify).not.toHaveBeenCalled();
    expect(win.location.search).toBe("");
  });

  it("says so plainly when what was pending is no longer on the page", async () => {
    win.sessionStorage.setItem(`casevoya.stepUp.${NONCE}`, JSON.stringify(validRecord({ at: Date.now() })));
    const notify = await (async () => {
      goTo(`/portal?resume=${NONCE}`);
      const spy = vi.fn();
      vi.useFakeTimers();
      resumeStepUp(html(h("div", {})), spy);
      await vi.advanceTimersByTimeAsync(6_000);
      vi.useRealTimers();
      return spy;
    })();
    expect(notify).toHaveBeenCalledWith("Check done", "Do it again to finish. Nothing was saved before the check.", "warn");
  });
});

describe("The token in the step-up href", () => {
  it("rides inside `next` only, and comes off again", () => {
    const href = stepUpHref("/sheet/templates?tab=rule&view=v1", "rule_approve");
    const withToken = withResumeToken(href, NONCE);
    expect(readStepUpHref(withToken)).toEqual({ action: "rule_approve", path: "/sheet/templates" });
    const next = new URL(withToken, "https://app.invalid").searchParams.get("next") ?? "";
    expect(next).toBe(`/sheet/templates?tab=rule&view=v1&resume=${NONCE}`);
    expect(withoutResumeToken("/sheet/templates", `?tab=rule&view=v1&resume=${NONCE}`)).toBe("/sheet/templates?tab=rule&view=v1");
    expect(withResumeToken("/sheet/exports", NONCE)).toBe("/sheet/exports");
    expect(withResumeToken(href, "nope")).toBe(href);
    expect(readStepUpHref(stepUpHref("/sheet"))).toBeNull();
  });

  it("leaves a step-up href whose next is not a same-site path untouched", () => {
    const unsafe = stepUpHref("/a/..//evil.example", "rule_approve");
    expect(withResumeToken(unsafe, NONCE)).toBe(unsafe);
    expect(readStepUpHref(unsafe)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Every step-up caller goes through the shared resume.
// ---------------------------------------------------------------------------

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) return sourceFiles(full);
    return /\.(ts|tsx)$/.test(name) ? [full] : [];
  });
}

describe("Every step-up caller", () => {
  it("navigates to /mfa through goStepUp, never window.location.assign", () => {
    const callers: string[] = [];
    for (const file of sourceFiles(path.join(process.cwd(), "src"))) {
      const text = readFileSync(file, "utf8");
      expect(text, file).not.toMatch(/location\.(assign|replace)\(\s*(stepUpHref|stepUpLocation|\w+StepUpLocation)\(/);
      expect(text, file).not.toMatch(/location\.href\s*=\s*(stepUpHref|stepUpLocation|\w+StepUpLocation)\(/);
      if (/goStepUp\(/.test(text) && !file.endsWith(path.join("auth", "step-up-resume.ts"))) callers.push(path.relative(process.cwd(), file));
    }
    expect(callers.length).toBeGreaterThanOrEqual(45);
  });
});
