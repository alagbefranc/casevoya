/**
 * DES-04: why a portal upload didn't go through, in plain words, and what to do next. Pure: the
 * upload flow (documents-live.tsx, own-upload.ts) passes what went wrong, this names it. The
 * server's checks (create_upload_intent, finish_verified_document_upload) stay authoritative; the
 * check before sending only saves the person a wasted upload.
 */

/** The product default per file (documents/files.ts DEFAULT_UPLOAD_BYTES), when the firm's limit wasn't read. */
const DEFAULT_UPLOAD_BYTES = 25 * 1024 * 1024;

export type UploadFailureKind = "wrong_type" | "too_large" | "verification" | "expired" | "network" | "refused";

/** The next step: pick a different file, send the same file again, or start the upload over. */
export type UploadRetry = "choose" | "resend";

export type UploadFailure = {
  kind: UploadFailureKind;
  title: string;
  copy: string;
  retry: UploadRetry;
};

/** The request's format keys (document_requests.acceptable_formats) in the words people know. */
const FORMAT_WORDS: Record<string, string> = { pdf: "PDF", jpeg: "JPG", png: "PNG", heic: "HEIC", docx: "DOCX" };

/** File name endings the server accepts (documents/files.ts mediaTypeForFilename), as format keys. */
const FORMAT_OF_EXTENSION: Record<string, string> = { pdf: "pdf", jpg: "jpeg", jpeg: "jpeg", png: "png", heic: "heic", heif: "heic", docx: "docx" };

/** "PDF, JPG or PNG". */
export function formatList(formats: readonly string[]): string {
  const words = formats.map((format) => FORMAT_WORDS[format]).filter((word): word is string => Boolean(word));
  if (words.length === 0) return "PDF, JPG, PNG, HEIC or DOCX";
  return words.length === 1 ? words[0] : `${words.slice(0, -1).join(", ")} or ${words[words.length - 1]}`;
}

function mb(bytes: number): string {
  return `${Math.round((bytes / 1024 / 1024) * 10) / 10} MB`;
}

/**
 * The check before sending: the file's name must be a type the request accepts, and its size within
 * the firm's limit. Null when it may be sent. The server checks the bytes themselves after upload.
 */
export function checkUploadFile(
  file: { name: string; size: number },
  options: { maxBytes?: number | null; formats?: readonly string[] | null } = {},
): UploadFailure | null {
  const allowed = options.formats?.length ? options.formats : null;
  const extension = file.name.includes(".") ? (file.name.trim().split(".").pop()?.toLowerCase() ?? "") : "";
  const format = FORMAT_OF_EXTENSION[extension] ?? null;
  if (!format || (allowed && !allowed.includes(format))) {
    const what = !extension ? "That file has no type we can check." : format ? `.${extension} files aren’t accepted for this request.` : `.${extension} files can’t be sent here.`;
    return {
      kind: "wrong_type",
      title: "That file type isn’t accepted",
      copy: `${what} Send a ${formatList(allowed ?? [])} file instead. Nothing was uploaded.`,
      retry: "choose",
    };
  }
  const limit = options.maxBytes && options.maxBytes > 0 ? options.maxBytes : DEFAULT_UPLOAD_BYTES;
  if (file.size > limit) {
    return {
      kind: "too_large",
      title: "That file is too large",
      copy: `It’s ${mb(file.size)}; your firm’s limit is ${mb(limit)} per file. Choose a smaller copy, or scan fewer pages at a time. Nothing was uploaded.`,
      retry: "choose",
    };
  }
  if (file.size < 1) {
    return { kind: "wrong_type", title: "That file is empty", copy: "It has no content to send. Choose the file again. Nothing was uploaded.", retry: "choose" };
  }
  return null;
}

/**
 * A failure the upload calls reported. `stage` is where it stopped: authorising the upload, sending
 * the bytes, or the server's check of the file. `message` is the action's own (already plain) error;
 * `state` the version's upload_state when the check ran.
 */
export function uploadFailure(input: {
  stage: "intent" | "transfer" | "check";
  message?: string | null;
  state?: string | null;
  /** The browser threw: no answer at all (offline, connection dropped). */
  thrown?: boolean;
}): UploadFailure {
  const message = (input.message ?? "").trim();
  if (input.thrown) {
    return {
      kind: "network",
      title: "The connection dropped",
      copy: "Your file didn’t reach us. Check your connection, then try again. Nothing was accepted.",
      retry: "resend",
    };
  }
  if (input.state === "quarantined") {
    return {
      kind: "verification",
      title: "We couldn’t accept this file",
      copy: "Its contents don’t match its file name, so it was set aside and nobody has opened it. A fresh photo, scan or export of the same pages usually works.",
      retry: "choose",
    };
  }
  if (input.state === "failed") {
    return {
      kind: "verification",
      title: "This file couldn’t be checked",
      copy: "The safety check didn’t finish, so the file isn’t accepted. Try sending it again; if it fails twice, try another copy.",
      retry: "resend",
    };
  }
  // Storage answers the transfer itself, in its own technical words: name the kind, never repeat them.
  if (input.stage === "transfer") {
    if (/expired|jwt|signature/i.test(message)) return expiredLink();
    if (/maximum allowed size|too large|payload/i.test(message)) {
      return { kind: "too_large", title: "That file is too large", copy: "Storage refused it for its size. Choose a smaller copy, or scan fewer pages at a time.", retry: "choose" };
    }
    return unfinished();
  }
  if (/type is not accepted|not a PDF|file name|file type/i.test(message)) {
    return { kind: "wrong_type", title: "That file type isn’t accepted", copy: `${message} Choose a different file.`, retry: "choose" };
  }
  if (/limit|larger than|above/i.test(message)) {
    return { kind: "too_large", title: "That file is too large", copy: `${message} Choose a smaller copy.`, retry: "choose" };
  }
  if (/expired|start again/i.test(message)) return expiredLink();
  if (/did not finish uploading/i.test(message)) return unfinished();
  if (input.stage === "check" || /could not be checked|size does not match|checksum/i.test(message)) {
    return {
      kind: "verification",
      title: "This file couldn’t be checked",
      copy: `${message || "The file check didn’t finish."} Try sending it again.`,
      retry: "resend",
    };
  }
  return {
    kind: "refused",
    title: "The upload couldn’t start",
    copy: message ? `${message}${/[.!?]$/.test(message) ? "" : "."} Nothing was uploaded.` : "Nothing was uploaded. Try again in a moment.",
    retry: "resend",
  };
}

function expiredLink(): UploadFailure {
  return {
    kind: "expired",
    title: "The upload link expired",
    copy: "Uploads have to finish within a short time. Try again: a new upload link is made for you.",
    retry: "resend",
  };
}

function unfinished(): UploadFailure {
  return {
    kind: "network",
    title: "The upload didn’t finish",
    copy: "Your file didn’t fully reach us, so nothing was accepted. Check your connection, then try again.",
    retry: "resend",
  };
}
