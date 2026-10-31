import { describe, expect, it } from "vitest";
import { IN_APP_ROWS } from "@/modules/notifications/preferences";
import { notificationParts, readItems, SYSTEM_KINDS, type NotificationItem } from "@/modules/sheet/notifications-present";

// Lost two-step device (20261102100100): the owners' in-app notice.
describe("notifications: mfa_reset", () => {
  const item: NotificationItem = {
    id: "r1",
    kind: "mfa_reset",
    occurred_at: "2026-10-30T14:00:00Z",
    matter_id: null,
    actor_name: "Sam Staff",
    subject: null,
    detail: "pending",
    href: "/app/two-step-resets",
    read: false,
  };

  it("is a system kind listed in Settings and kept by readItems", () => {
    expect(SYSTEM_KINDS.has("mfa_reset")).toBe(true);
    expect(IN_APP_ROWS.map((row) => row.kind)).toContain("mfa_reset");
    expect(readItems([item])).toEqual([item]);
  });

  it("names the person and says what the owner does, then the outcome", () => {
    expect(notificationParts(item, () => "x")).toEqual(["Sam Staff lost their two-step device and asked for a ", { b: "reset" }, ". Confirm it’s them, then approve or deny"]);
    expect(notificationParts({ ...item, detail: "approved", read: true }, () => "x")).toEqual(["Sam Staff’s two-step reset was ", { b: "approved" }]);
    expect(notificationParts({ ...item, detail: "expired", actor_name: null }, () => "x")).toEqual(["A staff member’s two-step reset request ", { b: "expired" }]);
  });
});
