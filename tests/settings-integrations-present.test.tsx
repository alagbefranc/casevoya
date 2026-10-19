import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ComposioDialog, SheetIntegrations, SheetNotificationPrefs, type IntegrationRow } from "@/components/sheet/designer/settings-integrations";
import { composioDialog, integrationsData, notificationPrefsData, type IntegrationsInput } from "@/modules/sheet/settings-integrations-present";
import { isSwitchableEmailKind, STAFF_EMAIL_ROWS } from "@/modules/notifications/preferences";

/**
 * Settings > Integrations and Notifications, presentation only (no Composio, no Stripe, no
 * network): real states, no invented "Connected", locked notices never switchable.
 */
const ORG = "00000000-0000-4000-8000-0000000000aa";

function input(over: Partial<IntegrationsInput> = {}): IntegrationsInput {
  return {
    organizationId: ORG,
    firmSlug: "synthetic-firm",
    fromAddress: "notices@casevoya.ca",
    inboundDomain: "docs.casevoya.ca",
    isOwner: true,
    composio: { configured: false, enabled: false, acceptedAt: null },
    connections: [],
    busySyncedAt: null,
    stripe: { canSee: true, isOwner: true, account: null },
    timeZone: "America/Toronto",
    ...over,
  };
}

const row = (rows: IntegrationRow[], name: string) => {
  const found = rows.find((item) => item.name === name);
  if (!found) throw new Error(`no row ${name}`);
  return found;
};

const PLANNED = ["QuickBooks", "DocuSign", "Zoom", "Dropbox", "Calendly", "Microsoft Teams", "Google Meet", "Twilio"];
const COMPOSIO = ["Gmail", "Google Calendar", "Microsoft Outlook", "Microsoft 365 calendar"];

describe("Settings > Integrations", () => {
  it("shows Casevoya email and calendar as built in, with the firm's real addresses", () => {
    const data = integrationsData(input());
    const [mail, calendar] = data.lead ?? [];
    expect(mail.name).toBe("Casevoya email");
    expect(mail.tag).toBe("built in");
    expect(mail.state).toEqual({ tone: "ok", label: "Connected" });
    expect(mail.sub).toEqual({ left: "Sends from notices@casevoya.ca", right: "receives at synthetic-firm@docs.casevoya.ca" });
    expect(calendar.name).toBe("Casevoya calendar");
    expect(calendar.state?.tone).toBe("ok");
  });

  it("never shows a planned integration as connected or degraded, and its Connect does nothing", () => {
    const data = integrationsData(input({ composio: { configured: true, enabled: true, acceptedAt: null } }));
    for (const name of PLANNED) {
      const item = row(data.rows, name);
      expect(item.tag, name).toBe("planned");
      expect(item.state, name).toEqual({ tone: "gr", label: "Not connected" });
      expect(item.unlink ?? null, name).toBeNull();
      expect(item.action?.attrs?.disabled, name).toBe(true);
    }
    expect(row(data.rows, "Xero").state?.label).toBe("Later");
    expect(row(data.rows, "Xero").bell ?? null).toBeNull();
    // WhatsApp is live through Zernio (tests/whatsapp-zernio.test.ts); without it on the server it's not available.
    expect(row(data.rows, "WhatsApp").state).toEqual({ tone: "gr", label: "Not available" });
    expect(row(data.rows, "WhatsApp").bell ?? null).toBeNull();
  });

  it("says plainly when Composio isn't configured, and offers no working Connect", () => {
    const data = integrationsData(input());
    const sw = (data.lead ?? [])[2];
    expect(sw.state).toEqual({ tone: "gr", label: "Not available" });
    expect(sw.toggle ?? null).toBeNull();
    for (const name of COMPOSIO) {
      expect(row(data.rows, name).state?.label).toBe("Not available");
      expect(row(data.rows, name).action?.attrs?.disabled).toBe(true);
    }
    expect(composioDialog(input())).toBeNull();
  });

  it("waits for the owner's switch, then wires Connect, Reconnect, Disconnect and Sync busy times to this person's connections", () => {
    const off = integrationsData(input({ composio: { configured: true, enabled: false, acceptedAt: null } }));
    expect((off.lead ?? [])[2].toggle).toEqual({
      id: "swComposio",
      on: false,
      sr: "Connected accounts through Composio",
      attrs: { "data-composio": "on", "data-org": ORG },
    });
    expect(row(off.rows, "Gmail").action?.attrs?.disabled).toBe(true);
    expect(composioDialog(input({ composio: { configured: true, enabled: false, acceptedAt: null } }))?.points.length).toBe(4);

    const on = integrationsData(
      input({
        composio: { configured: true, enabled: true, acceptedAt: "2026-10-18T14:00:00Z" },
        connections: [
          { id: "c-gmail", toolkit: "gmail", status: "active", updatedAt: "2026-10-18T14:00:00Z" },
          { id: "c-cal", toolkit: "googlecalendar", status: "active", updatedAt: "2026-10-18T14:00:00Z" },
          { id: "c-out", toolkit: "outlook", status: "pending", updatedAt: "2026-10-18T14:00:00Z" },
          { id: "c-old", toolkit: "outlook_calendar", status: "disconnected", updatedAt: "2026-10-18T14:00:00Z" },
        ],
        busySyncedAt: "2026-10-18T13:40:00Z",
      }),
    );
    expect((on.lead ?? [])[2].sub).toEqual({ left: "On since 18 Oct 2026", right: "mail and busy times pass through Composio (United States)" });
    expect((on.lead ?? [])[2].toggle?.attrs).toEqual({ "data-composio": "off", "data-org": ORG });
    const gmail = row(on.rows, "Gmail");
    expect(gmail.state).toEqual({ tone: "ok", label: "Connected" });
    expect(gmail.unlink).toEqual({ "aria-label": "Disconnect Gmail", "data-int-disconnect": "c-gmail", "data-org": ORG, "data-fpb": "1" });
    expect(gmail.action).toEqual({ label: "Reconnect", attrs: { "data-int-connect": "gmail", "data-org": ORG } });
    const calendar = row(on.rows, "Google Calendar");
    expect(calendar.action).toEqual({ label: "Sync busy times", attrs: { "data-int-sync": "1", "data-org": ORG } });
    expect(calendar.sub).toEqual({ left: "Calendar busy times", right: "busy times read 18 Oct, 09:40" });
    expect(row(on.rows, "Microsoft Outlook").state).toEqual({ tone: "chg", label: "Pending", detail: "finish signing in" });
    const m365 = row(on.rows, "Microsoft 365 calendar");
    expect(m365.state).toEqual({ tone: "gr", label: "Not connected" });
    expect(m365.action).toEqual({ label: "Connect", attrs: { "data-int-connect": "outlook_calendar", "data-org": ORG } });
    expect(composioDialog(input({ composio: { configured: true, enabled: true, acceptedAt: null } }))).toBeNull();
  });

  it("shows staff who aren't the owner the switch's state, not a switch", () => {
    const data = integrationsData(input({ isOwner: false, composio: { configured: true, enabled: true, acceptedAt: null } }));
    expect((data.lead ?? [])[2].toggle ?? null).toBeNull();
    expect((data.lead ?? [])[2].state).toEqual({ tone: "ok", label: "On" });
    expect(composioDialog(input({ isOwner: false, composio: { configured: true, enabled: false, acceptedAt: null } }))).toBeNull();
  });

  it("shows the firm's stored Stripe status truthfully", () => {
    const stripe = (s: IntegrationsInput["stripe"]) => row(integrationsData(input({ stripe: s })).rows, "Stripe");
    expect(stripe({ canSee: false, isOwner: false, account: null }).state).toEqual({ tone: "gr", label: "Billing staff only" });
    expect(stripe({ canSee: true, isOwner: true, account: null })).toMatchObject({ state: { tone: "gr", label: "Not connected" }, action: { label: "Set up" } });
    expect(stripe({ canSee: true, isOwner: false, account: null }).action ?? null).toBeNull();
    expect(stripe({ canSee: true, isOwner: true, account: { cardPayments: "active", requirementsDue: 0 } }).state).toEqual({ tone: "ok", label: "Connected" });
    expect(stripe({ canSee: true, isOwner: true, account: { cardPayments: "active", requirementsDue: 2 } }).state?.label).toBe("Action needed");
    expect(stripe({ canSee: true, isOwner: true, account: { cardPayments: "restricted", requirementsDue: 0 } }).state?.label).toBe("Action needed");
    expect(stripe({ canSee: true, isOwner: true, account: { cardPayments: "unsupported", requirementsDue: 0 } }).state?.tone).toBe("bad");
    expect(stripe({ canSee: true, isOwner: true, account: null }).unlink ?? null).toBeNull();
  });

  it("renders live rows with data attributes only and no Designer sample data", () => {
    const data = integrationsData(input({ composio: { configured: true, enabled: false, acceptedAt: null } }));
    const html = renderToStaticMarkup(createElement(SheetIntegrations, { data }));
    expect(html).toContain('id="swComposio" data-composio="on" data-org="' + ORG + '"');
    expect(html).not.toMatch(/Northline|\(demo\)|Degraded|Expired|fictional/);
    const dialog = composioDialog(input({ composio: { configured: true, enabled: false, acceptedAt: null } }));
    const dlg = renderToStaticMarkup(createElement(ComposioDialog, { data: dialog! }));
    expect(dlg).toContain('data-composio-enable="1"');
    expect(dlg).toContain("United States");
    expect(dlg).toContain("https://www.priv.gc.ca/en/privacy-topics/airports-and-borders/gl_dab_090127/");
  });
});

describe("Settings > Notifications", () => {
  it("offers a switch only for emails a person may turn off, and keeps security and client-waiting notices locked", () => {
    const data = notificationPrefsData({ organizationId: ORG, isOwner: true, email: { agreement_executed: false }, quietHours: null });
    const email = data.sections[0].rows;
    expect(email.map((r) => r.label)).toEqual(STAFF_EMAIL_ROWS.map((r) => r.label));
    const switches = email.filter((r) => r.control.kind === "switch");
    expect(switches).toHaveLength(1);
    expect(switches[0].control).toEqual({
      kind: "switch",
      item: { id: "np-agreement_executed", on: false, sr: "An agreement I signed is fully signed", attrs: { "data-notif-pref": "agreement_executed", "data-org": ORG } },
    });
    for (const r of email.filter((item) => item.control.kind !== "switch")) expect(r.control).toEqual({ kind: "badge", badge: { tone: "ok", label: "Always on" } });
    for (const kind of ["agreement_signer_turn", "security", "sign_in", "mfa"]) expect(isSwitchableEmailKind(kind)).toBe(false);
    // In-app kinds are listed as never emailed.
    expect(data.sections[1].rows.every((r) => r.control.kind === "badge" && r.control.badge.label === "In app only")).toBe(true);
    // Defaults: no stored row means on.
    const fresh = notificationPrefsData({ organizationId: ORG, isOwner: true, email: {}, quietHours: null });
    const freshSwitch = fresh.sections[0].rows[0].control;
    expect(freshSwitch.kind === "switch" && freshSwitch.item.on).toBe(true);
  });

  it("shows the firm's quiet hours, switchable by the owner only", () => {
    const quiet = (isOwner: boolean, hours: { start: string; end: string } | null) => {
      const rows = notificationPrefsData({ organizationId: ORG, isOwner, email: {}, quietHours: hours }).sections[3].rows;
      return rows[rows.length - 1];
    };
    const on = quiet(true, { start: "21:00:00", end: "08:00:00" });
    expect(on.small).toEqual({ left: "21:00–08:00 in the deadline’s timezone", right: "critical notices still go out" });
    expect(on.control).toEqual({ kind: "switch", item: { id: "swQuiet", on: true, sr: "Quiet hours", attrs: { "data-quiet": "off", "data-org": ORG } } });
    const staff = quiet(false, null);
    expect(staff.control.kind === "switch" && staff.control.item.attrs).toEqual({ disabled: true, title: "Only the firm owner can change this" });
    expect(staff.control.kind === "switch" && staff.control.item.on).toBe(false);
  });

  it("renders without Designer sample data or a fake digest", () => {
    const html = renderToStaticMarkup(createElement(SheetNotificationPrefs, { data: notificationPrefsData({ organizationId: ORG, isOwner: false, email: {}, quietHours: null }) }));
    expect(html).not.toMatch(/k2-bell|Someone mentions me|Grouped into one email per hour/);
    expect(html).toContain('id="swQuiet" disabled="" title="Only the firm owner can change this"');
  });
});
