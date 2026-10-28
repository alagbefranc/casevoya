import { describe, expect, it, vi } from "vitest";

// #262 item 6 (found shipping #163): saving a changed agreement on a booking type and reopening
// the Edit dialog before the page's refresh landed showed the old agreement, because the dialog
// is filled from the Edit button's data-type, which only the refresh replaced. Synthetic ids only.

const saved = vi.hoisted(() => ({ calls: [] as Record<string, unknown>[], version: 4 }));
vi.mock("@/modules/scheduling/staff-actions", () => ({
  saveBookingType: async (input: Record<string, unknown>) => {
    saved.calls.push(input);
    return { ok: true, id: input.eventTypeId, version: saved.version };
  },
}));
vi.mock("@/components/port/kit", () => ({ toast2: () => {} }));
vi.mock("@/lib/auth/step-up-resume", () => ({ goStepUp: () => {} }));

const { openBookingType, runBookingType } = await import("@/components/sheet/booking-acts");

type Field = { id: string; value: string; checked: boolean; name?: string; dataset: Record<string, string> };

const TYPE_ID = "00000000-0000-4000-8000-0000000000a1";
const IDS = ["etT", "etS", "etD", "etL", "etP", "etBB", "etBA", "etN", "etW", "etC", "etK", "etX", "etA", "etPub"];

function page() {
  const fields = new Map<string, Field>(IDS.map((id) => [id, { id, value: "", checked: false, dataset: {} }]));
  const hosts: Field[] = [{ id: "h1", name: "etH", value: "m1", checked: false, dataset: {} }];
  const submit = { dataset: {} as Record<string, string>, closest: () => dialog };
  const dialog = {
    open: false,
    dataset: {} as Record<string, string>,
    querySelector: (selector: string) => (selector === "[data-type-submit]" ? submit : (fields.get(selector.replace(/^#/, "")) ?? null)),
    querySelectorAll: (selector: string) => (selector.includes(":checked") ? hosts.filter((box) => box.checked) : hosts),
    addEventListener: () => {},
    close() {
      this.open = false;
    },
  };
  const opener = {
    dataset: {
      typeOpen: TYPE_ID,
      type: JSON.stringify({
        id: TYPE_ID,
        version: 3,
        title: "Initial consultation",
        slug: "initial-consultation",
        description: "",
        duration: 30,
        step: null,
        before: 0,
        after: 15,
        noticeHours: 24,
        advance: 60,
        capacity: null,
        kind: "video",
        detail: "",
        hosts: ["m1"],
        published: true,
        agreement: "tpl-old",
      }),
    } as Record<string, string>,
  };
  const archive = { dataset: { typeArchive: TYPE_ID, version: "3" } as Record<string, string> };
  const root = {
    querySelector: (selector: string) => (selector === "#dlgType" ? dialog : null),
    querySelectorAll: (selector: string) => (selector === "[data-type-open]" ? [opener] : selector === "[data-type-archive]" ? [archive] : []),
  };
  return { fields, submit, dialog, opener, archive, root: root as unknown as HTMLElement };
}

describe("booking type Edit dialog after a save (#262)", () => {
  it("reopening right away shows the agreement just saved, with the new version", async () => {
    const p = page();
    const open = () => {};
    openBookingType(p.opener as unknown as HTMLElement, p.root, open);
    expect(p.fields.get("etA")?.value).toBe("tpl-old");
    expect(p.submit.dataset.version).toBe("3");

    // Change the agreement and the length, then save.
    p.fields.get("etA")!.value = "tpl-new";
    p.fields.get("etL")!.value = "45";
    await runBookingType(p.submit as unknown as HTMLElement, { refresh: () => {} }, p.root);
    expect(saved.calls.at(-1)).toMatchObject({ eventTypeId: TYPE_ID, version: 3, agreementTemplateId: "tpl-new", durationMin: 45 });

    // Reopened before the refresh lands: the saved values, and the version a second save needs.
    p.fields.get("etA")!.value = "";
    p.fields.get("etL")!.value = "";
    openBookingType(p.opener as unknown as HTMLElement, p.root, open);
    expect(p.fields.get("etA")?.value).toBe("tpl-new");
    expect(p.fields.get("etL")?.value).toBe("45");
    expect(p.fields.get("etT")?.value).toBe("Initial consultation");
    expect(p.submit.dataset.version).toBe("4");
    expect(p.archive.dataset.version).toBe("4");
  });
});
