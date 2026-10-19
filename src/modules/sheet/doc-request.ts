/**
 * Pure helpers for the matter page's "Request a document" dialog: its options, who it can ask,
 * and what it sends to createDocumentRequest (public.create_document_request). The database
 * decides every save: the role, the step-up, sample mode and that the person is on the matter.
 */
import { isUuid } from "@/lib/tenant/context";

/** The staff roles app.create_document_request accepts. Anyone else is not offered the dialog. */
export const DOC_REQUEST_ROLES = ["firm_owner", "licensed_consultant", "case_manager"] as const;

export function mayRequestDocuments(role: string): boolean {
  return (DOC_REQUEST_ROLES as readonly string[]).includes(role);
}

/** The formats an upload can be (DOC-02), in the order the dialog lists them. */
export const DOC_REQUEST_FORMATS: readonly { value: string; label: string; on: boolean }[] = [
  { value: "pdf", label: "PDF", on: true },
  { value: "jpeg", label: "JPEG", on: true },
  { value: "png", label: "PNG", on: true },
  { value: "heic", label: "HEIC", on: false },
  { value: "docx", label: "DOCX", on: false },
];

/** public.document_sensitivity, in plain words. */
export const DOC_REQUEST_SENSITIVITIES: readonly { value: string; label: string }[] = [
  { value: "ordinary", label: "Ordinary" },
  { value: "narrative", label: "Personal account" },
  { value: "medical", label: "Medical" },
  { value: "criminal", label: "Criminal record" },
];

/** public.document_audience: who besides the firm sees the request and the file. */
export const DOC_REQUEST_AUDIENCES: readonly { value: string; label: string }[] = [
  { value: "subject", label: "Only the person asked" },
  { value: "matter", label: "Everyone on the matter" },
  { value: "staff", label: "Firm staff only" },
];

/** A person on the matter the request can go to: name, role, and whether they can sign in to the portal. */
export function docRequestPersonLabel(name: string, role: string, portal: boolean): string {
  return `${name} · ${role} · ${portal ? "Portal active" : "No portal access yet"}`;
}

export type DocRequestFields = {
  personId: string;
  purpose: string;
  explanation: string;
  dueOn: string;
  formats: string[];
  sensitivity: string;
  audience: string;
  criteria: string;
};

export type DocRequestInput = {
  personId: string;
  purpose: string;
  explanation: string;
  dueOn: string | null;
  acceptableFormats: string[];
  sensitivity: string;
  audience: string;
  reviewCriteria: string | null;
};

const DATE = /^\d{4}-\d{2}-\d{2}$/;

function realDate(value: string): boolean {
  if (!DATE.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function clean(value: string | null | undefined): string {
  return typeof value === "string" ? value.replace(/[ \t]+/g, " ").trim() : "";
}

/**
 * Checks the dialog's fields the way app.create_document_request does, for a quick answer.
 * `today` is the firm's day (YYYY-MM-DD): a due date before it is refused here.
 */
export function readDocRequest(fields: DocRequestFields, today: string): { input: DocRequestInput } | { error: string } {
  if (!isUuid(fields.personId)) return { error: "Choose who the request is for." };
  const purpose = clean(fields.purpose);
  if (purpose.length < 1) return { error: "Say which document you need." };
  if (purpose.length > 200) return { error: "Keep the document name under 200 characters." };
  const explanation = clean(fields.explanation);
  if (explanation.length < 3) return { error: "Explain to the client what the file should show." };
  if (explanation.length > 2000) return { error: "Keep the explanation under 2,000 characters." };
  const dueOn = clean(fields.dueOn);
  if (dueOn && !realDate(dueOn)) return { error: "Pick a real due date, or leave it empty." };
  if (dueOn && dueOn < today) return { error: "The due date has passed. Pick a later one." };
  const allowed = new Set(DOC_REQUEST_FORMATS.map((format) => format.value));
  const formats = [...new Set(fields.formats)].filter((format) => allowed.has(format));
  if (formats.length === 0) return { error: "Choose at least one accepted format." };
  if (!DOC_REQUEST_SENSITIVITIES.some((option) => option.value === fields.sensitivity)) return { error: "Choose how sensitive the document is." };
  if (!DOC_REQUEST_AUDIENCES.some((option) => option.value === fields.audience)) return { error: "Choose who may see it." };
  const criteria = clean(fields.criteria);
  if (criteria.length > 2000) return { error: "Keep the review criteria under 2,000 characters." };
  return {
    input: {
      personId: fields.personId,
      purpose,
      explanation,
      dueOn: dueOn || null,
      acceptableFormats: formats,
      sensitivity: fields.sensitivity,
      audience: fields.audience,
      reviewCriteria: criteria || null,
    },
  };
}
