import { describe, expect, it } from "vitest";
import { documentError } from "@/modules/documents/errors";
import { documentCardFlags, progressLine } from "@/modules/documents/present";

describe("document card labels", () => {
  it("keeps Accepted only for a clean accepted file", () => {
    const accepted = documentCardFlags({
      uploadState: "clean",
      reviewState: "accepted",
      superseded: false,
      expired: false,
    });
    expect(accepted.labels).toEqual(["Uploaded", "Accepted"]);
    expect(accepted.countsAsAccepted).toBe(true);
    expect(accepted.labels.join(" ")).not.toMatch(/Not accepted/);

    const rejected = documentCardFlags({
      uploadState: "clean",
      reviewState: "rejected",
      superseded: false,
      expired: false,
    });
    expect(rejected.labels).toEqual(["Uploaded", "Changes needed"]);
    expect(rejected.needsYou).toBe(true);
    expect(rejected.labels.join(" ")).not.toMatch(/Accepted/);

    const quarantined = documentCardFlags({
      uploadState: "quarantined",
      reviewState: "pending",
      superseded: false,
      expired: false,
    });
    expect(quarantined.canDownload).toBe(false);
    expect(quarantined.countsAsAccepted).toBe(false);
  });

  it("counts accepted requests, not raw uploads", () => {
    expect(progressLine({ requestCount: 4, acceptedCount: 1, uploadedUnacceptedCount: 2 })).toBe(
      "1 of 4 accepted. 2 uploaded and still waiting.",
    );
  });

  it("does not return a database message", () => {
    const raw = "quarantined or unfinished uploads cannot be accepted evidence";
    expect(documentError(raw)).not.toBe(raw);
    expect(documentError("document version conflict")).toMatch(/Refresh/);
  });
});
