/**
 * DES-04: failed uploads on the Sheet's staff upload surfaces, with a next step. Pure, so the
 * browser checks a chosen file before anything is sent and says plainly why it can't go, and a
 * refusal from the server reads the same way. The server (and for documents the database)
 * checks again and is authoritative; these limits only mirror theirs.
 */

export type UploadRule = {
  /** What the file is for, in the message ("government letter or receipt"). */
  what: string;
  extensions: readonly string[];
  /** The formats in words ("a PDF, JPEG, PNG, HEIC or DOCX file"). */
  formats: string;
  maxBytes: number;
};

const MB = 1024 * 1024;

/** The limits each surface's server applies (see the route or action named beside each). */
export const UPLOAD_RULES = {
  // documents/actions.ts createUploadIntent + DOC-02 media types; the firm's own limit may be lower.
  evidence: { what: "evidence file", extensions: ["pdf", "jpg", "jpeg", "png", "heic", "heif", "docx"], formats: "a PDF, JPEG, PNG, HEIC or DOCX file", maxBytes: 100 * MB },
  // api/firm/logo (FIRM_LOGO_MAX_BYTES).
  logo: { what: "logo", extensions: ["png", "jpg", "jpeg"], formats: "a PNG or JPG image", maxBytes: 2 * MB },
  // api/stripe/dispute-evidence (EVIDENCE_MAX_BYTES, Stripe's limit).
  dispute: { what: "dispute evidence", extensions: ["pdf", "jpg", "jpeg", "png"], formats: "a PDF, JPEG or PNG file", maxBytes: 4_718_592 },
  // api/migration/upload.
  migrationCsv: { what: "import file", extensions: ["csv", "txt"], formats: "a CSV file", maxBytes: 5 * MB },
  migrationZip: { what: "ZIP of documents", extensions: ["zip"], formats: "a ZIP file", maxBytes: 25 * MB },
  // Leads › Import (pipeline-acts).
  leadsCsv: { what: "lead list", extensions: ["csv", "txt"], formats: "a CSV file", maxBytes: 2_000_000 },
} as const satisfies Record<string, UploadRule>;

export type UploadRuleKey = keyof typeof UPLOAD_RULES;

export type UploadFailure = {
  title: string;
  /** What went wrong with this file. */
  detail: string;
  /** What to do next. */
  next: string;
  /** The retry button's label. */
  retry: string;
};

export function sizeLabel(bytes: number): string {
  if (bytes < 1024) return `${bytes} bytes`;
  if (bytes < MB) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${Math.round((bytes / MB) * 10) / 10} MB`;
}

function extension(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(dot + 1).trim().toLowerCase() : "";
}

/** A chosen file the surface can't take: wrong type, empty or too large. Null when it may be sent. */
export function checkUpload(file: { name: string; size: number }, rule: UploadRule): UploadFailure | null {
  const name = file.name || "This file";
  const ext = extension(file.name);
  // A name without an extension is left to the server, which reads the file's bytes.
  if (ext && !rule.extensions.includes(ext)) {
    return {
      title: "That file type can’t be uploaded here",
      detail: `“${name}” isn’t ${rule.formats}.`,
      next: `Nothing was uploaded. Choose ${rule.formats}${rule.extensions.includes("pdf") ? " (save or scan other documents as PDF first)" : ""}.`,
      retry: "Choose another file",
    };
  }
  if (file.size <= 0) {
    return { title: "That file is empty", detail: `“${name}” has nothing in it.`, next: "Nothing was uploaded. Choose the file again, or export it again from where it came from.", retry: "Choose another file" };
  }
  if (file.size > rule.maxBytes) {
    return {
      title: "That file is too large",
      detail: `“${name}” is ${sizeLabel(file.size)}; the limit for a ${rule.what} is ${sizeLabel(rule.maxBytes)}.`,
      next: "Nothing was uploaded. Choose a smaller file, or compress or split it first.",
      retry: "Choose another file",
    };
  }
  return null;
}

/** A refusal or a dropped connection after the file was sent: the server's words, then the next step. */
export function uploadFailed(error: string, rule: UploadRule): UploadFailure {
  const text = error.trim() || "The upload didn’t finish.";
  const typeOrSize = /file name|PDF|JPEG|PNG|JPG|CSV|ZIP|type|larger|too large|limit|under \d/i.test(text);
  return {
    title: typeOrSize ? "That file can’t be uploaded here" : "The upload didn’t finish",
    detail: /[.!?]$/.test(text) ? text : `${text}.`,
    next: typeOrSize
      ? `Nothing was saved. Choose ${rule.formats} within the limit.`
      : "Nothing was saved. Check your connection and try again; if it keeps failing, reload the page and sign in again.",
    retry: typeOrSize ? "Choose another file" : "Try again",
  };
}
