import { z } from "zod";
import { officialUrlHost, officialUrlIsAllowlisted } from "./official-domains";

const INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/;
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
const SHA256 = /^[0-9a-f]{64}$/;

const optionalInstant = z.string().regex(INSTANT).nullable().optional();
const optionalDate = z.string().regex(DATE_ONLY).nullable().optional();

export const snapshotRetrievalResult = z.enum(["success", "unchanged", "changed", "partial"]);
export const snapshotReviewStatus = z.enum([
  "draft",
  "evidence_captured",
  "verified",
  "rejected",
  "superseded",
]);

export const sourceSnapshotInputSchema = z
  .strictObject({
    sourceId: z.uuid(),
    finalUrl: z.string().min(12).max(2000),
    publisher: z.string().trim().min(1).max(200),
    retrievedAt: z.string().regex(INSTANT),
    publishedAt: optionalInstant,
    publishedOn: optionalDate,
    modifiedAt: optionalInstant,
    modifiedOn: optionalDate,
    currentTo: optionalDate,
    contentHash: z.string().regex(SHA256),
    evidenceStorageRef: z.string().min(1).max(500).nullable().optional(),
    retrievalResult: snapshotRetrievalResult,
    httpStatus: z.number().int().min(100).max(599).nullable().optional(),
    reviewStatus: snapshotReviewStatus.optional(),
  })
  .superRefine((value, ctx) => {
    if (!officialUrlIsAllowlisted(value.finalUrl)) {
      ctx.addIssue({
        code: "custom",
        path: ["finalUrl"],
        message: "official source URL is not on the allowlist",
      });
    }
  });

export type SourceSnapshotInput = z.input<typeof sourceSnapshotInputSchema>;

export type SourceSnapshotRecord = {
  sourceId: string;
  finalUrl: string;
  allowedHost: string;
  publisher: string;
  retrievedAt: string;
  publishedAt: string | null;
  publishedOn: string | null;
  modifiedAt: string | null;
  modifiedOn: string | null;
  currentTo: string | null;
  contentHash: string;
  evidenceStorageRef: string | null;
  retrievalResult: z.infer<typeof snapshotRetrievalResult>;
  httpStatus: number | null;
  reviewStatus: z.infer<typeof snapshotReviewStatus>;
};

export class SourceSnapshotValidationError extends Error {
  readonly issues: { path: string; message: string }[];

  constructor(issues: { path: string; message: string }[]) {
    super(issues.map((issue) => `${issue.path || "input"}: ${issue.message}`).join("; "));
    this.name = "SourceSnapshotValidationError";
    this.issues = issues;
  }
}

function absent<T>(value: T | null | undefined): T | null {
  return value ?? null;
}

/**
 * Validates a source-snapshot capture. Missing authority dates stay null.
 * retrievedAt and contentHash are required and are never invented here.
 * This does not fetch the URL.
 */
export function parseSourceSnapshot(input: unknown): SourceSnapshotRecord {
  const parsed = sourceSnapshotInputSchema.safeParse(input);
  if (!parsed.success) {
    throw new SourceSnapshotValidationError(
      parsed.error.issues.map((issue) => ({
        path: issue.path.map(String).join("."),
        message: issue.message,
      })),
    );
  }
  const value = parsed.data;
  const allowedHost = officialUrlHost(value.finalUrl);
  if (!allowedHost) {
    throw new SourceSnapshotValidationError([
      { path: "finalUrl", message: "official source URL is not on the allowlist" },
    ]);
  }
  return {
    sourceId: value.sourceId,
    finalUrl: value.finalUrl,
    allowedHost,
    publisher: value.publisher,
    retrievedAt: value.retrievedAt,
    publishedAt: absent(value.publishedAt),
    publishedOn: absent(value.publishedOn),
    modifiedAt: absent(value.modifiedAt),
    modifiedOn: absent(value.modifiedOn),
    currentTo: absent(value.currentTo),
    contentHash: value.contentHash,
    evidenceStorageRef: absent(value.evidenceStorageRef),
    retrievalResult: value.retrievalResult,
    httpStatus: absent(value.httpStatus),
    reviewStatus: value.reviewStatus ?? "draft",
  };
}
