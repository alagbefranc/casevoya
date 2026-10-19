import { safeAccessError } from "@/lib/auth/step-up";

/** Maps database refusals to short portal copy. Never returns the raw message. */
export function documentError(message: string): string {
  if (/version conflict/i.test(message)) return "Someone else updated this document. Refresh and try again.";
  if (/cannot be accepted/i.test(message)) return "A quarantined or unfinished file cannot be accepted.";
  if (/25 MB/i.test(message)) return "Files above 25 MB stay off until storage is validated.";
  if (/format is not acceptable|do not match the filename/i.test(message)) {
    return "That file type is not accepted for this request.";
  }
  if (/not PDF, JPEG, PNG, HEIC|file header is missing|unrecognized/i.test(message)) {
    return "The file is not a PDF, JPEG, PNG, HEIC, or DOCX.";
  }
  if (/size/i.test(message)) return "The file size does not match what was authorized.";
  if (/checksum/i.test(message)) return "The file could not be checked. Upload it again.";
  if (/stored object was not found/i.test(message)) return "The file did not finish uploading. Try again.";
  if (/expired/i.test(message)) return "That upload authorization expired. Start again.";
  if (/sample mode/i.test(message)) return "This firm is in sample mode. Only sample matters accept new work.";
  if (/needs a person on this matter/i.test(message)) return "Choose someone who is on this matter.";
  if (/published rule/i.test(message)) return "Choose a published rule version, or leave the rule blank.";
  if (/replacement must be a new version/i.test(message)) return "Send a new version of the same document.";
  if (/French reason/i.test(message)) return "Add the French reason (3 to 2000 characters), or leave it empty.";
  if (/machine-drafted/i.test(message)) return "The French draft could not be recorded. Draft it again.";
  if (/review reason|waiver reason|removal reason|custody purpose/i.test(message)) {
    return "Add a short reason before continuing.";
  }
  return safeAccessError(message);
}
