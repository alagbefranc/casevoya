import { afterEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

// #272 items 2, 3, 4, 5, 7a and 7b: the client-side halves. Synthetic ids and names only.

const toasts = vi.hoisted(() => [] as string[]);
const calls = vi.hoisted(() => ({ read: 0, refusal: null as { error: string; code: "client_ai_off" } | null, idle: 0 }));

vi.mock("@/components/port/kit", () => ({
  toast2: (title: string) => {
    toasts.push(title);
  },
}));
vi.mock("@/lib/auth/step-up-resume", () => ({ goStepUp: () => {} }));
vi.mock("@/components/sheet/documents-acts", () => ({ keepReviewDraft: () => {} }));
vi.mock("@/modules/vo/vo-doc-actions", () => ({
  voReadConsentRefusal: async () => calls.refusal,
  readDocumentWithVo: async () => {
    calls.read += 1;
    return { ok: true, abstained: true };
  },
  acceptVoDocProposal: async () => ({ ok: true }),
  discardVoDocDraft: async () => ({ ok: true }),
  rejectVoDocProposal: async () => ({ ok: true }),
}));
vi.mock("@/modules/settings/security-actions", () => ({
  setStaffIdleTimeout: async (input: { minutes: number }) => {
    calls.idle += 1;
    return { minutes: input.minutes };
  },
}));
vi.mock("@/modules/scheduling/staff-actions", () => ({
  saveBookingType: async () => ({ ok: true, id: "00000000-0000-4000-8000-0000000000b1", version: 1 }),
}));

const { portNoticeState } = await import("@/components/port/use-port");
const { SignInMarkup } = await import("@/components/port/markup/sign-in");
const { showIdleMinutes } = await import("@/components/sheet/idle-timeout-act");
const { idleDetail } = await import("@/modules/security/idle");
const { runVoRead } = await import("@/components/sheet/vo-doc-acts");
const { autoReadMessage } = await import("@/components/sheet/designer/vo-auto-read");
const { runBookingType } = await import("@/components/sheet/booking-acts");
const { shortWhen, zoneAbbr } = await import("@/modules/scheduling/format");

afterEach(() => {
  toasts.length = 0;
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("item 2: the idle sign-out notice on sign-in", () => {
  it("?idle=1 opens the sign-in page on its idle notice, in the page's own notice style", () => {
    expect(portNoticeState("?idle=1&next=%2Fsheet%2Fclients")).toBe("idle");
    // An explicit state or a sign-in error still wins.
    expect(portNoticeState("?idle=1&error=1")).toBe("error");
    expect(portNoticeState("?state=locked&idle=1")).toBe("locked");
    expect(portNoticeState("?next=%2Fsheet")).toBeNull();
    const html = renderToStaticMarkup(createElement(SignInMarkup));
    expect(html).toContain('<div class="alert info" role="status" data-show="idle">');
    expect(html).toContain("You were signed out after a period of inactivity.");
  });
});

describe("item 3: Settings › Security after saving the idle time", () => {
  it("the Session timeout row and the dialog show the saved minutes at once", () => {
    const detail = { textContent: idleDetail(30) };
    const row = { querySelector: (selector: string) => (selector === "small" ? detail : null) };
    const opener = { closest: (selector: string) => (selector === ".li" ? row : null) };
    const input = { value: "45", defaultValue: "30" };
    const scope = {
      querySelector: (selector: string) => (selector === '[data-open="dIdleSet"]' ? opener : selector === "#idMin" ? input : null),
    };
    showIdleMinutes(scope as unknown as ParentNode, 45);
    expect(detail.textContent).toBe(idleDetail(45));
    expect(detail.textContent).toMatch(/^45 minutes idle/);
    expect(input).toEqual({ value: "45", defaultValue: "45" });
  });
});

describe("item 4: a slot's zone abbreviation is the one in force at that slot", () => {
  // Sydney's rules are stable (NSW: daylight time from October to April), so this doesn't depend on
  // the runner's tzdata the way Canadian zones now do (#268; Alberta and Manitoba changed in 2026).
  const summer = Date.parse("2026-03-02T00:00:00Z");
  const winter = Date.parse("2026-07-06T00:00:00Z");

  it("does not take the abbreviation from today", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-01T00:00:00Z"));
    const fromWinter = [zoneAbbr(summer, "Australia/Sydney"), zoneAbbr(winter, "Australia/Sydney")];
    vi.setSystemTime(new Date("2026-02-01T00:00:00Z"));
    const fromSummer = [zoneAbbr(summer, "Australia/Sydney"), zoneAbbr(winter, "Australia/Sydney")];
    expect(fromWinter).toEqual(fromSummer);
    expect(fromWinter[0]).not.toBe(fromWinter[1]);
    expect(shortWhen(summer, "Australia/Sydney")).toBe(`Mon 2 Mar 11:00 ${fromWinter[0]}`);
    expect(shortWhen(winter, "Australia/Sydney")).toBe(`Mon 6 Jul 10:00 ${fromWinter[1]}`);
  });
});

describe("item 5: a new booking type shows without a manual reload", () => {
  it("reads the page again after the first type is saved; an edit keeps its in-place update", async () => {
    vi.useFakeTimers();
    const replace = vi.fn();
    vi.stubGlobal("window", { location: { pathname: "/sheet/consultations", search: "?tab=booking", replace }, setTimeout });
    const fields: Record<string, { value: string; checked?: boolean }> = { etT: { value: "Initial consultation" }, etS: { value: "initial-consultation" } };
    const dialog = {
      querySelector: (selector: string) => fields[selector.replace(/^#/, "")] ?? null,
      querySelectorAll: () => [],
      close: vi.fn(),
    };
    const button = (typeId: string) => ({ dataset: { org: "00000000-0000-4000-8000-0000000000a0", typeId } as Record<string, string>, closest: () => dialog });
    const root = { querySelectorAll: () => [] };
    const refresh = vi.fn();

    await runBookingType(button("") as unknown as HTMLElement, { refresh }, root as unknown as ParentNode);
    expect(refresh).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(700);
    expect(replace).toHaveBeenCalledWith("/sheet/consultations?tab=booking");

    replace.mockClear();
    await runBookingType(button("00000000-0000-4000-8000-0000000000b1") as unknown as HTMLElement, { refresh }, root as unknown as ParentNode);
    vi.advanceTimersByTime(700);
    expect(replace).not.toHaveBeenCalled();
  });
});

describe("item 7a: Read with Vo for a client without AI consent", () => {
  it("refuses without first saying Vo is reading, and starts no reading", async () => {
    const button = { dataset: { org: "00000000-0000-4000-8000-0000000000a0" }, closest: () => ({ dataset: { doc: "00000000-0000-4000-8000-0000000000c1" } }) };
    calls.refusal = { error: "Synthetic Client hasn’t agreed to AI help with their documents yet.", code: "client_ai_off" };
    await runVoRead(button as unknown as HTMLElement, { push: () => {}, refresh: () => {} });
    expect(toasts).toEqual(["Synthetic Client hasn’t agreed to AI help with their documents yet."]);
    expect(calls.read).toBe(0);

    toasts.length = 0;
    calls.refusal = null;
    await runVoRead(button as unknown as HTMLElement, { push: () => {}, refresh: () => {} });
    expect(toasts[0]).toBe("Vo is reading the document");
    expect(calls.read).toBe(1);
  });
});

describe("item 7b: the Documents tab names the uploads skipped for consent", () => {
  const refusal = "Synthetic Client hasn’t agreed to AI help with their documents yet.";

  it("lists them after the consent message", () => {
    expect(autoReadMessage({ reading: 0, read: 0, noConsent: refusal, skipped: ["Passport bio page", "Proof of funds"] })).toBe(
      `${refusal} Skipped: Passport bio page, Proof of funds.`,
    );
    expect(autoReadMessage({ reading: 0, read: 1, noConsent: refusal, skipped: ["Proof of funds"] })).toBe(
      `Vo read 1 new upload. Nothing changes until you accept a proposal. It skipped others: ${refusal} Skipped: Proof of funds.`,
    );
    // No names known: the message as before.
    expect(autoReadMessage({ reading: 0, read: 0, noConsent: refusal })).toBe(refusal);
  });
});
