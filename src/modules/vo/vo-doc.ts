/**
 * Vo document reading, shared by the app and the Vo agent service (PRD AI-01, AI-06). Pure.
 *
 * - The document kind used by the firm's per-category Vo switches: a protected sensitivity decides
 *   first, then the stated purpose. app.vo_document_category in 20261019218100_vo_doc_review.sql
 *   is the same function in SQL (tested for parity).
 * - The four document capabilities and what each lets Vo propose.
 */

export const VO_DOC_CATEGORIES = ["identity", "relationship", "financial", "medical", "criminal", "narrative"] as const;
export type VoDocCategory = (typeof VO_DOC_CATEGORIES)[number];

/** The vo_settings read switch for each category. */
export const VO_DOC_CATEGORY_SWITCH = {
  identity: "read_identity",
  relationship: "read_relationship",
  financial: "read_financial",
  medical: "read_medical",
  criminal: "read_criminal",
  narrative: "read_narratives",
} as const satisfies Record<VoDocCategory, string>;

export const VO_DOC_CATEGORY_LABEL: Record<VoDocCategory | "other", string> = {
  identity: "Identity document",
  relationship: "Relationship evidence",
  financial: "Financial document",
  medical: "Medical record",
  criminal: "Criminal history",
  narrative: "Narrative or letter",
  other: "Other",
};

/** The document kind for the per-category switches. Mirrors app.vo_document_category. */
export function voDocumentCategory(purpose: string, sensitivity: string): VoDocCategory {
  if (sensitivity === "medical") return "medical";
  if (sensitivity === "criminal") return "criminal";
  if (sensitivity === "narrative") return "narrative";
  const p = purpose.toLowerCase();
  if (/medical|health|immigration medical|imm/.test(p)) return "medical";
  if (/police|criminal|court|conviction/.test(p)) return "criminal";
  if (/passport|birth|identity|id card|national id|travel document/.test(p)) return "identity";
  if (/bank|income|tax|pay ?stub|employment letter|funds|financial|noa|t4/.test(p)) return "financial";
  if (/marriage|relationship|photo|wedding|partner|spouse|common-law/.test(p)) return "relationship";
  if (/letter|statement|narrative|explanation|essay/.test(p)) return "narrative";
  return "identity";
}

/** The firm's switches that matter for a document reading (the vo_settings row, or null). */
export type VoDocSettings = {
  enabled?: boolean;
  doc_classification?: boolean;
  ocr_normalisation?: boolean;
  missing_fields?: boolean;
  inconsistency_flags?: boolean;
  read_identity?: boolean;
  read_relationship?: boolean;
  read_financial?: boolean;
  read_medical?: boolean;
  read_criminal?: boolean;
  read_narratives?: boolean;
  read_on_upload?: boolean;
};

export type VoDocCapabilities = { classification: boolean; fields: boolean; missing: boolean; inconsistencies: boolean };

/** The capabilities on for the firm. A saved row decides; without one they default on (AI-01). */
export function voDocCapabilities(settings: VoDocSettings | null): VoDocCapabilities {
  return {
    classification: settings?.doc_classification ?? true,
    fields: settings?.ocr_normalisation ?? true,
    missing: settings?.missing_fields ?? true,
    inconsistencies: settings?.inconsistency_flags ?? true,
  };
}

export function anyDocCapability(caps: VoDocCapabilities): boolean {
  return caps.classification || caps.fields || caps.missing || caps.inconsistencies;
}

/** Whether the firm lets Vo read a category. Without a saved row every category is off. */
export function voCategoryAllowed(settings: VoDocSettings | null, category: string): boolean {
  if (!(VO_DOC_CATEGORIES as readonly string[]).includes(category)) return false;
  return settings?.[VO_DOC_CATEGORY_SWITCH[category as VoDocCategory]] === true;
}

/** Media types Claude can read directly: PDFs as a document block, these images as image blocks. A DOCX is sent as its extracted text. */
export const VO_DOC_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"] as const;
/** Size limits for one reading (the API takes 32 MB a request and 5 MB an image). */
export const VO_DOC_MAX_PDF_BYTES = 20 * 1024 * 1024;
export const VO_DOC_MAX_IMAGE_BYTES = 5 * 1024 * 1024;
export const VO_DOC_MAX_DOCX_BYTES = 20 * 1024 * 1024;
export const VO_DOC_DOCX_TYPE = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

export type VoDocMedia =
  | { kind: "pdf"; mediaType: "application/pdf" }
  | { kind: "image"; mediaType: (typeof VO_DOC_IMAGE_TYPES)[number] }
  | { kind: "docx"; mediaType: typeof VO_DOC_DOCX_TYPE };

/** The size limit for one reading of this kind of file. */
export function voDocMaxBytes(media: VoDocMedia | null): number {
  return media?.kind === "pdf" ? VO_DOC_MAX_PDF_BYTES : media?.kind === "docx" ? VO_DOC_MAX_DOCX_BYTES : VO_DOC_MAX_IMAGE_BYTES;
}

/** What Vo can read, from the media type the upload check detected. HEIC: not yet (no decoder). */
export function voDocMedia(mediaType: string | null | undefined): VoDocMedia | null {
  const type = (mediaType ?? "").toLowerCase().split(";")[0].trim();
  if (type === "application/pdf") return { kind: "pdf", mediaType: "application/pdf" };
  if (type === VO_DOC_DOCX_TYPE) return { kind: "docx", mediaType: VO_DOC_DOCX_TYPE };
  const image = VO_DOC_IMAGE_TYPES.find((value) => value === (type === "image/jpg" ? "image/jpeg" : type));
  return image ? { kind: "image", mediaType: image } : null;
}

/** The file's first bytes match what it claims to be. */
export function voDocMagicMatches(media: VoDocMedia, bytes: Uint8Array): boolean {
  const starts = (...sig: number[]) => sig.every((byte, index) => bytes[index] === byte);
  switch (media.mediaType) {
    case "application/pdf":
      return starts(0x25, 0x50, 0x44, 0x46);
    case VO_DOC_DOCX_TYPE:
      return starts(0x50, 0x4b, 0x03, 0x04);
    case "image/jpeg":
      return starts(0xff, 0xd8, 0xff);
    case "image/png":
      return starts(0x89, 0x50, 0x4e, 0x47);
    case "image/gif":
      return starts(0x47, 0x49, 0x46, 0x38);
    case "image/webp":
      return starts(0x52, 0x49, 0x46, 0x46) && bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50;
  }
}
