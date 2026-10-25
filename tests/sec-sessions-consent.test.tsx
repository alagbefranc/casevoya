import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { TwoStepMarkup } from "@/components/port/markup/two-step";
import { ConsentsPanel, TwoStepRow } from "@/components/portal/account-privacy";
import { PersonConsentPanels } from "@/components/sheet/designer/person-consent";
import { SheetSettingsSecurity } from "@/components/sheet/designer/settings";
import { EXPORT_STEP_UP_LEAD, isStepUpActionKey, stepUpAction, stepUpHref, stepUpLead, type StepUpActionKey } from "@/lib/auth/mfa-step";
import { countdown, idlePhase, idleSignInLocation, isStaffPageLoad, readActivityState, readIdleMinutes } from "@/modules/security/idle";
import { PROCESSING_WITHDRAWAL_NOTE, consentCopy, readConsents, readTwoStep, twoStepCopy, withdrawalToast } from "@/modules/portal/account-present";
import { personConsentError, presentPersonConsent, readIdentityMethod, readReviewNote } from "@/modules/sheet/person-consent-present";
import { securityData } from "@/modules/sheet/settings-present";
import { voError } from "@/modules/vo/errors";

const root = path.resolve(import.meta.dirname, "..");

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) return sourceFiles(full);
    return /\.(ts|tsx)$/.test(name) ? [full] : [];
  });
}

/** The top-level arguments of each call to `name(` in `text`. */
function callArgs(text: string, name: string): string[][] {
  const calls: string[][] = [];
  let from = 0;
  for (;;) {
    const at = text.indexOf(`${name}(`, from);
    if (at < 0) return calls;
    from = at + name.length + 1;
    // Skip the definition itself.
    if (/function\s+$/.test(text.slice(Math.max(0, at - 20), at))) continue;
    let depth = 1;
    let current = "";
    const args: string[] = [];
    for (let i = from; i < text.length && depth > 0; i += 1) {
      const ch = text[i];
      if ("([{".includes(ch)) depth += 1;
      if (")]}".includes(ch)) depth -= 1;
      if (depth === 0) break;
      if (ch === "," && depth === 1) {
        args.push(current.trim());
        current = "";
      } else current += ch;
    }
    if (current.trim()) args.push(current.trim());
    calls.push(args);
  }
}

describe("SEC-01 step-up names the action", () => {
  it("builds the step-up link with the action and reads it back on the page", () => {
    expect(stepUpHref("/sheet/settings?tab=team", "role")).toBe(`/mfa?step=6&next=${encodeURIComponent("/sheet/settings?tab=team")}&for=role`);
    expect(stepUpHref("/sheet")).toBe(`/mfa?step=6&next=${encodeURIComponent("/sheet")}`);
    expect(stepUpLead("/sheet/settings?tab=team", "role")).toContain("to change a role");
    expect(stepUpAction("/sheet/settings?tab=team", "role")).toMatchObject({ title: "Change a role or access", icon: "users" });
    expect(stepUpLead("/sheet/x", "plan")).toContain("to change the firm’s plan");
    expect(stepUpLead("/sheet/settings?tab=retention", "retention_delete")).toContain("to approve deleting a matter’s files");
    expect(stepUpLead("/sheet/settings?tab=billing", "subscription_cancel")).toContain("to cancel the subscription");
    // The route-based text stays the fallback; an unknown key is ignored.
    expect(stepUpLead("/sheet/exports", null)).toBe(EXPORT_STEP_UP_LEAD);
    expect(stepUpLead("/sheet/exports", "role")).toContain("to change a role");
    expect(stepUpLead("/sheet/x", "<script>")).toBe("This needs a fresh check, even when you’re already signed in.");
    expect(isStepUpActionKey("constructor")).toBe(false);
    expect(stepUpLead("/sheet/x", "export")).toBe(EXPORT_STEP_UP_LEAD);
  });

  it("renders the action on the Designer's Confirm it's you step", () => {
    const html = renderToStaticMarkup(
      <TwoStepMarkup activeStep={6} stepUpLead={stepUpLead("/sheet/settings", "role")} stepUpAction={stepUpAction("/sheet/settings", "role")} />,
    );
    expect(html).toContain("A fresh check is needed to change a role, even when you’re already signed in.");
    expect(html).toContain("Change a role or access");
    expect(html).toContain("#i-users");
  });

  it("uses only icons the sprite has", () => {
    const sprite = readFileSync(path.join(root, "public/assets/icons-coreui/sprite.svg"), "utf8");
    const keys = readFileSync(path.join(root, "src/lib/auth/mfa-step.ts"), "utf8").match(/icon: "([a-z-]+)"/g) ?? [];
    expect(keys.length).toBeGreaterThan(40);
    for (const match of keys) {
      const icon = match.slice(7, -1);
      expect(sprite, icon).toContain(`id="i-${icon}"`);
    }
  });

  it("every step-up caller goes through stepUpHref and names its action", () => {
    const files = sourceFiles(path.join(root, "src"));
    for (const file of files) {
      const text = readFileSync(file, "utf8");
      if (!file.endsWith(path.join("lib", "auth", "mfa-step.ts"))) expect(text.includes("step=6&next"), file).toBe(false);
      for (const args of callArgs(text, "stepUpHref")) {
        if (file.endsWith("mfa-step.ts")) continue;
        expect(args.length, `${file}: stepUpHref(${args.join(", ")})`).toBeGreaterThanOrEqual(2);
      }
      for (const args of callArgs(text, "financeStepUpLocation")) {
        if (file.endsWith("finance-present.ts") || file.includes(`${path.sep}tests${path.sep}`)) continue;
        expect(args.length, `${file}: financeStepUpLocation(${args.join(", ")})`).toBe(4);
      }
      for (const args of callArgs(text, "agreementStepUpLocation")) {
        if (file.endsWith("agreements-present.ts")) continue;
        expect(args.length, `${file}: agreementStepUpLocation(${args.join(", ")})`).toBe(5);
      }
      for (const args of callArgs(text, "stepUpLocation")) {
        if (file.endsWith("matter-wire.ts")) continue;
        // A dialog the matter page knows names its own action; anything else passes one.
        if (args[2] === "null") expect(args.length, `${file}: stepUpLocation(${args.join(", ")})`).toBe(4);
      }
    }
  });

  it("keeps every named key valid", () => {
    const text = readFileSync(path.join(root, "src/components/sheet/gov-acts.ts"), "utf8");
    for (const match of text.matchAll(/: "([a-z_]+)",?\n/g)) {
      if (["handoff", "submission", "receipt"].includes(match[1])) continue;
      expect(isStepUpActionKey(match[1] as StepUpActionKey), match[1]).toBe(true);
    }
  });
});

describe("SEC-01 idle sign-out", () => {
  it("warns in the last two minutes and expires at the firm's time", () => {
    const start = Date.UTC(2026, 9, 24, 12, 0, 0);
    expect(idlePhase(start, start + 27 * 60_000, 30)).toEqual({ phase: "active", secondsLeft: 180 });
    expect(idlePhase(start, start + 28 * 60_000, 30)).toEqual({ phase: "warn", secondsLeft: 120 });
    expect(idlePhase(start, start + 29 * 60_000 + 15_000, 30)).toEqual({ phase: "warn", secondsLeft: 45 });
    expect(idlePhase(start, start + 30 * 60_000, 30)).toEqual({ phase: "expired", secondsLeft: 0 });
    expect(countdown(105)).toBe("1:45");
    expect(countdown(-3)).toBe("0:00");
  });

  it("reads the database's answer and the setting's bounds", () => {
    expect(readActivityState({ state: "active", timeout_minutes: 30, idle_seconds: 12 })).toEqual({ state: "active", timeoutMinutes: 30, idleSeconds: 12 });
    expect(readActivityState({ state: "expired", timeout_minutes: 5 })).toEqual({ state: "expired", timeoutMinutes: 5 });
    expect(readActivityState({ state: "none" })).toEqual({ state: "none" });
    expect(readActivityState(null)).toEqual({ state: "none" });
    expect(readActivityState({ state: "active" })).toEqual({ state: "none" });
    expect(readIdleMinutes("30")).toEqual({ minutes: 30 });
    expect(readIdleMinutes("4")).toHaveProperty("error");
    expect(readIdleMinutes("481")).toHaveProperty("error");
    expect(readIdleMinutes("12.5")).toHaveProperty("error");
  });

  it("checks full page loads of the staff area only, and signs in again to the same page", () => {
    const load = { method: "GET", pathname: "/sheet/matters", fetchDest: "document", prefetch: false };
    expect(isStaffPageLoad(load)).toBe(true);
    expect(isStaffPageLoad({ ...load, pathname: "/portal" })).toBe(false);
    expect(isStaffPageLoad({ ...load, fetchDest: "empty" })).toBe(false);
    expect(isStaffPageLoad({ ...load, prefetch: true })).toBe(false);
    expect(isStaffPageLoad({ ...load, method: "POST" })).toBe(false);
    expect(isStaffPageLoad({ ...load, pathname: "/sheets" })).toBe(false);
    expect(idleSignInLocation("/sheet/matters?view=due")).toBe(`/sign-in?idle=1&next=${encodeURIComponent("/sheet/matters?view=due")}`);
    expect(idleSignInLocation("//evil.example")).toBe(`/sign-in?idle=1&next=${encodeURIComponent("/sheet")}`);
  });

  it("shows the value and On on the Security tab, with the owner's Change dialog built from the Designer's parts", () => {
    const owner = securityData({ owner: true, members: 1, security: null, events: null, timeZone: "America/Toronto", organizationId: "org-1", idleMinutes: 30 });
    const row = owner.rows.find((item) => item.title === "Session timeout");
    expect(row).toMatchObject({ detail: "30 minutes idle · staff get a warning 2 minutes before Casevoya signs them out", badge: { tone: "ok", label: "On" } });
    expect(row?.action).toEqual({ label: "Change", attrs: { "data-open": "dIdleSet" } });
    const html = renderToStaticMarkup(createElement(SheetSettingsSecurity, { data: owner }));
    expect(html).toContain('<dialog class="dlg" id="dIdleSet"');
    expect(html).toContain('data-idle-timeout="1" data-org="org-1"');
    const dialog = html.slice(html.indexOf('id="dIdleSet"'));
    const classes = new Set([...dialog.matchAll(/class="([^"]*)"/g)].map((match) => match[1]));
    expect([...classes].sort()).toEqual(["btn", "btn p", "db", "df", "dh", "fld", "hint", "ic s", "inp", "x"]);

    // Staff who aren't the owner see the value, without Change.
    const staff = securityData({ owner: false, members: 3, security: null, events: null, timeZone: "America/Toronto", organizationId: "org-1", idleMinutes: 10 });
    expect(staff.rows.find((item) => item.title === "Session timeout")).toMatchObject({ detail: expect.stringContaining("10 minutes idle"), badge: { label: "On" } });
    expect(staff.rows.find((item) => item.title === "Session timeout")?.action).toBeUndefined();
    expect(staff.idleTimeout).toBeNull();
  });
});

describe("SEC-01 client two-step and SEC-05 consents on /portal/account", () => {
  it("says how a lost phone is handled (never email alone) and what high-risk means", () => {
    const off = twoStepCopy("off", "Maple Law");
    expect(off.badge).toEqual({ tone: "gr", label: "Off" });
    expect(off.detail).toContain("changing your email or downloading a full copy of your file");
    expect(off.detail).toContain("an email alone can’t");
    expect(twoStepCopy("needs_check", "Maple Law").badge).toEqual({ tone: "ok", label: "On" });
    expect(readTwoStep("ok")).toBe("ok");
    expect(readTwoStep("yes")).toBeNull();
  });

  it("reads the stored choices and explains that withdrawing deletes nothing", () => {
    expect(readConsents({ ai_drafting: false, marketing: null, processing: true })).toEqual({ ai_drafting: false, marketing: null, processing: true });
    expect(readConsents([])).toBeNull();
    expect(PROCESSING_WITHDRAWAL_NOTE).toContain("doesn’t delete anything");
    expect(PROCESSING_WITHDRAWAL_NOTE).toContain("legal hold");
    expect(consentCopy("ai_drafting", "Maple Law").detail).toContain("Vo skips your documents");
    expect(withdrawalToast("ai_drafting", "Maple Law").sub).toContain("Vo no longer reads your documents");
  });

  it("renders the two-step row and the consents panel with the portal's own parts", () => {
    const row = renderToStaticMarkup(createElement(TwoStepRow, { organizationId: "org-1", firm: "Maple Law", state: "off" }));
    expect(row).toContain("Two-step sign-in");
    expect(row).toContain("Turn on");
    expect(row).toContain('<dialog class="dlg" id="dTwoStep"');
    const panel = renderToStaticMarkup(
      createElement(ConsentsPanel, { organizationId: "org-1", firm: "Maple Law", consents: { ai_drafting: true, marketing: null, processing: true } }),
    );
    expect(panel).toContain('id="consent-ai" aria-checked="true"');
    expect(panel).toContain('id="consent-marketing" aria-checked="false"');
    expect(panel).toContain("Withdraw");
    expect(panel).toContain("doesn’t delete anything");
    const classes = new Set([...`${row}${panel}`.matchAll(/class="([^"]*)"/g)].map((match) => match[1]));
    expect([...classes].sort()).toEqual(
      ["bd gr", "bd ok", "btn", "btn p", "btn sm", "db", "df", "dh", "dlg", "fld", "ic s", "inp", "k2-sr", "k2-sw", "k2-th", "lbl", "li", "pad", "panel rv", "r", "x"].sort(),
    );
  });
});

describe("SEC-05 the staff review on the person tab", () => {
  const overview = {
    history: [
      { id: "c2", purpose: "ai_drafting", granted: false, withdrawn_at: null, created_at: "2026-10-24T15:00:00Z", scope: null },
      { id: "c1", purpose: "ai_drafting", granted: true, withdrawn_at: null, created_at: "2026-10-01T15:00:00Z", scope: null },
    ],
    reviews: [
      { id: "11111111-1111-4111-8111-111111111111", purpose: "ai_drafting", source: "portal", impacts: ["Vo no longer reads this client’s documents (Casevoya skips them)"], status: "open", created_at: "2026-10-24T15:00:00Z", version: 1 },
      { id: "22222222-2222-4222-8222-222222222222", purpose: "marketing", source: "staff", impacts: [], status: "done", created_at: "2026-10-02T15:00:00Z", done_at: "2026-10-03T15:00:00Z", done_note: "Removed from the newsletter list", done_by: "u1", version: 2 },
    ],
    portal: true,
    two_step: true,
    resets: [{ created_at: "2026-10-05T15:00:00Z", identity_method: "Video call with photo ID", reset_by: "u1" }],
  };

  it("lists open reviews with what is affected, the history, and the two-step state", () => {
    const data = presentPersonConsent({ organizationId: "org-1", personId: "p-1", overview, timeZone: "America/Toronto", userName: (id) => (id === "u1" ? "Grace Lin" : "Staff member") });
    expect(data?.reviews[0]).toMatchObject({ title: "AI drafting withdrawn", line: "Opened 24 Oct 2026 · from the client’s portal", open: true });
    expect(data?.reviews[1].done).toBe("Done 3 Oct 2026 by Grace Lin: Removed from the newsletter list");
    expect(data?.history.map((row) => [row.consent, row.choice.label, row.when])).toEqual([
      ["AI drafting", "Refused or turned off", "24 Oct 2026"],
      ["AI drafting", "Given", "1 Oct 2026"],
    ]);
    expect(data?.twoStep?.badge).toEqual({ tone: "ok", label: "On" });
    expect(data?.twoStep?.resets).toEqual(["Reset 5 Oct 2026 by Grace Lin · identity: Video call with photo ID"]);
    expect(presentPersonConsent({ organizationId: "o", personId: "p", overview: null, timeZone: "UTC", userName: () => "" })).toBeNull();

    const html = renderToStaticMarkup(createElement(PersonConsentPanels, { data: data! }));
    expect(html).toContain('data-cr-open="11111111-1111-4111-8111-111111111111" data-cr-version="1"');
    expect(html).toContain("Vo no longer reads this client’s documents");
    expect(html).toContain("Nothing is deleted");
    expect(html).toContain('data-open="dTwoStepReset"');
    const classes = new Set([...html.matchAll(/class="([^"]*)"/g)].map((match) => match[1]));
    for (const name of classes) {
      expect(["panel", "li", "r", "bd chg", "bd ok", "bd gr", "btn s sm", "fp-pad", "fp-note", "ic", "ic s", "tw", "t", "sr", "num", "dlg", "dh", "x", "db", "fld", "hint", "ta", "inp", "df", "btn", "btn p"], name).toContain(name);
    }
  });

  it("checks the note and the identity method, and words the database's refusals", () => {
    expect(readReviewNote("  ok ")).toHaveProperty("error");
    expect(readReviewNote("Called the client")).toEqual({ note: "Called the client" });
    expect(readIdentityMethod("ab")).toHaveProperty("error");
    expect(personConsentError("a staff sign-in is reset from Team and seats")).toContain("Team and seats");
    expect(personConsentError("consent review version conflict")).toContain("Reload");
    expect(personConsentError("something else")).toBeNull();
  });

  it("tells staff why Vo skipped the document", () => {
    expect(voError("client_ai_off")).toContain("hasn’t agreed to AI drafting");
  });
});
