/** Labels that appear in the portal document cards. The filter matches these words. */

export type UploadState = "uploading" | "scanning" | "quarantined" | "clean" | "failed";
export type ReviewState = "pending" | "accepted" | "rejected";

export type DocumentCardFlags = {
  labels: string[];
  needsYou: boolean;
  countsAsAccepted: boolean;
  canDownload: boolean;
};

const BADGE: Record<string, string> = {
  Uploaded: "bd unv",
  "Changes needed": "bd chg",
  "Being reviewed": "bd rev",
  Accepted: "bd ok",
  Quarantined: "bd bad",
  "Check failed": "bd bad",
  Requested: "bd chg",
  "Checking file": "bd rev",
  Expired: "bd bad",
  Superseded: "bd unv",
};

export function badgeClass(label: string): string {
  return BADGE[label] ?? "bd";
}

/**
 * Separate upload state from firm acceptance.
 * "Accepted" is only used for a clean file the firm accepted, and never inside another label.
 */
export function documentCardFlags(input: {
  uploadState: UploadState | null;
  reviewState: ReviewState | null;
  superseded: boolean;
  expired: boolean;
}): DocumentCardFlags {
  if (!input.uploadState) {
    return { labels: ["Requested"], needsYou: true, countsAsAccepted: false, canDownload: false };
  }
  if (input.superseded) {
    return {
      labels: ["Superseded"],
      needsYou: false,
      countsAsAccepted: false,
      canDownload: input.uploadState === "clean",
    };
  }
  if (input.uploadState === "quarantined") {
    return { labels: ["Quarantined"], needsYou: true, countsAsAccepted: false, canDownload: false };
  }
  if (input.uploadState === "failed") {
    return { labels: ["Check failed"], needsYou: true, countsAsAccepted: false, canDownload: false };
  }
  if (input.uploadState === "uploading" || input.uploadState === "scanning") {
    return { labels: ["Checking file"], needsYou: false, countsAsAccepted: false, canDownload: false };
  }
  const labels = ["Uploaded"];
  if (input.expired) labels.push("Expired");
  else if (input.reviewState === "accepted") labels.push("Accepted");
  else if (input.reviewState === "rejected") labels.push("Changes needed");
  else labels.push("Being reviewed");
  return {
    labels,
    needsYou: input.expired || input.reviewState === "rejected",
    countsAsAccepted: !input.expired && input.reviewState === "accepted",
    canDownload: true,
  };
}

export function progressLine(progress: {
  requestCount: number;
  acceptedCount: number;
  uploadedUnacceptedCount: number;
}): string {
  const base = `${progress.acceptedCount} of ${progress.requestCount} accepted`;
  if (progress.uploadedUnacceptedCount > 0) {
    return `${base}. ${progress.uploadedUnacceptedCount} uploaded and still waiting.`;
  }
  return `${base}.`;
}
