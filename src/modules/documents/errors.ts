import { safeAccessError } from "@/lib/auth/step-up";

/** Maps database refusals to short portal copy. Never returns the raw message. */
export function documentError(message: string): string {
  if (/version conflict/i.test(message)) return "Someone else updated this document. Refresh and try again.";
  if (/not on that matter/i.test(message)) return "That person isn’t on the matter you chose.";
  if (/passed its check/i.test(message)) return "Only a file that passed its check can be used on another matter.";
  if (/a translation is of another document/i.test(message)) return "Choose a different document as the original.";
  if (/already a translation of this one/i.test(message)) return "That document is already a translation of this one.";
  if (/same person as the original/i.test(message)) return "A translation belongs to the same person as the original.";
  if (/translation's language/i.test(message)) return "Choose the translation’s language.";
  if (/say what the document is/i.test(message)) return "Say what the document is, in up to 200 characters.";
  if (/cannot be accepted/i.test(message)) return "A quarantined or unfinished file cannot be accepted.";
  if (/25 MB/i.test(message)) return "Files above 25 MB stay off until storage is validated.";
  if (/above the upload limit/i.test(message)) return "That file is above your firm’s upload limit per file.";
  if (/format is not acceptable|do not match the filename/i.test(message)) {
    return "That file type is not accepted for this request.";
  }
  if (/not PDF, JPEG, PNG, HEIC|file header is missing|unrecognized/i.test(message)) {
    return "The file is not a PDF, JPEG, PNG, HEIC, or DOCX.";
  }
  if (/document redaction denied/i.test(message)) return "Only firm staff can make a redacted copy.";
  if (/only a checked file can be redacted/i.test(message)) return "Only a file that passed its check can be redacted.";
  if (/not on this matter/i.test(message)) return "That document is not on this matter.";
  if (/mark between 1 and 40|mark an area/i.test(message)) return "Mark between 1 and 40 areas on the page.";
  if (/use a PDF, JPEG, or PNG file name/i.test(message)) return "The redacted copy must be a PDF, JPEG, or PNG.";
  if (/document assembly denied/i.test(message)) return "Those pages could not be saved.";
  if (/already finished/i.test(message)) return "That upload is already finished.";
  if (/between 1 and 40 pages/i.test(message)) return "Add between 1 and 40 pages.";
  if (/how each page is turned/i.test(message)) return "Turn each page by a quarter turn.";
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
