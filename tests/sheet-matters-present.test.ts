import { describe, expect, it } from "vitest";
import { governmentBadge, MATTERS_PAGE, pageLimit, programLabel } from "@/modules/sheet/matters-present";

describe("Matters list words", () => {
  it("labels a program from its rule pack key and shows a dash without one", () => {
    expect(programLabel("express_entry")).toBe("Express entry");
    expect(programLabel("spousal-sponsorship")).toBe("Spousal sponsorship");
    expect(programLabel(null)).toBe("—");
    expect(programLabel("  ")).toBe("—");
  });

  it("colours a government status by what is on file", () => {
    expect(governmentBadge("not_recorded")).toEqual({ tone: "unv", label: "Not recorded" });
    expect(governmentBadge("receipt_on_file")).toEqual({ tone: "ok", label: "Receipt on file" });
    expect(governmentBadge("additional_request_open")).toEqual({ tone: "chg", label: "Additional request open" });
  });

  it("pages by whole pages and refuses odd limits", () => {
    expect(pageLimit(undefined)).toBe(MATTERS_PAGE);
    expect(pageLimit("abc")).toBe(MATTERS_PAGE);
    expect(pageLimit("10")).toBe(MATTERS_PAGE);
    expect(pageLimit("120")).toBe(100);
    expect(pageLimit("999999")).toBe(1000);
  });
});

describe("initials", () => {
  it("uses the first letter of the first and last words that have one", async () => {
    const { initials } = await import("@/components/sheet/designer/sidebar");
    expect(initials("Dana Lee")).toBe("DL");
    expect(initials("Sample study permit (E2E)")).toBe("SE");
    expect(initials("Élodie")).toBe("É");
    expect(initials("(1) 2")).toBe("?");
  });
});
