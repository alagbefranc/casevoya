/** Labels that appear in the portal document cards. The filter matches these words. */

export type UploadState = "uploading" | "scanning" | "quarantined" | "clean" | "failed" | "scan_failed";
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
  // #263-B: the virus scanner's states.
  "Checking for viruses…": "bd rev",
  "Blocked: a virus was found": "bd bad",
  "Couldn’t be checked yet": "bd chg",
  Expired: "bd bad",
  Superseded: "bd unv",
};

export function badgeClass(label: string): string {
  return BADGE[label] ?? "bd";
}

/** #263-B: the labels for the virus scanner's states. */
export const VIRUS_LABELS = {
  scanning: "Checking for viruses…",
  infected: "Blocked: a virus was found",
  failed: "Couldn’t be checked yet",
} as const;

/** What a client is told under a blocked file: plain, and what to do next. */
export const INFECTED_CLIENT_NOTE = "A virus was found in this file, so it was blocked and nobody opened it. Please upload another copy.";

/**
 * Separate upload state from firm acceptance.
 * "Accepted" is only used for a clean file the firm accepted, and never inside another label.
 * `scanResult` (document_versions.scan_result) tells a virus apart from a file whose contents
 * don't match its name; both are quarantined.
 */
export function documentCardFlags(input: {
  uploadState: UploadState | null;
  reviewState: ReviewState | null;
  superseded: boolean;
  expired: boolean;
  scanResult?: string | null;
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
    const label = input.scanResult === "infected" ? VIRUS_LABELS.infected : "Quarantined";
    return { labels: [label], needsYou: true, countsAsAccepted: false, canDownload: false };
  }
  if (input.uploadState === "scan_failed") {
    // The scanner couldn't check it yet (Casevoya keeps trying; staff are told). Not the client's doing.
    return { labels: [VIRUS_LABELS.failed], needsYou: false, countsAsAccepted: false, canDownload: false };
  }
  if (input.uploadState === "failed") {
    return { labels: ["Check failed"], needsYou: true, countsAsAccepted: false, canDownload: false };
  }
  if (input.uploadState === "uploading") {
    return { labels: ["Checking file"], needsYou: false, countsAsAccepted: false, canDownload: false };
  }
  if (input.uploadState === "scanning") {
    // Only virus scanning holds a finished upload in "scanning" (#263-B).
    return { labels: [VIRUS_LABELS.scanning], needsYou: false, countsAsAccepted: false, canDownload: false };
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
