/**
 * Vo document readings as the Designer's review panel on a matter's Documents tab (`#ocr`) and as
 * cards on Vo drafts. Pure, so the copy and the rules are tested: only proposals still waiting are
 * shown, values below the confirm threshold say so, and every row is something a person ticks,
 * corrects and accepts, or leaves to reject (PRD AI-01..AI-03).
 */
import type { MatterBadge } from "@/components/sheet/designer/matters";
import type { MatterDocumentReviewData, VoDocPaperPart, VoDocReviewRow } from "@/components/sheet/designer/vo-doc-review";
import { VO_DOC_CATEGORY_LABEL, type VoDocCategory } from "@/modules/vo/vo-doc";

export type VoProposalKind = "classification" | "field" | "missing_field" | "inconsistency" | "deadline" | "needs_rule";

export type VoProposalRow = {
  id: string;
  position: number;
  kind: VoProposalKind;
  label: string;
  value: string | null;
  detail: string | null;
  page: number | null;
  confidence: number | null;
  category: string | null;
  dueOn: string | null;
  status: "proposed" | "accepted" | "rejected";
};

export type VoReadingView = {
  id: string;
  organizationId: string;
  purpose: string;
  versionNumber: number;
  mediaType: string;
  sha256: string | null;
  needsRule: boolean;
  proposals: VoProposalRow[];
};

/** Values Vo is less sure of than this stay unconfirmed until a person checks the page. */
export const CONFIRM_THRESHOLD = 80;

const MONTH = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "2031-03-03" as "3 Mar 2031"; anything else as written. */
export function printedDate(value: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return value;
  const month = Number(match[2]);
  return month >= 1 && month <= 12 ? `${Number(match[3])} ${MONTH[month - 1]} ${match[1]}` : value;
}

function mediaLabel(mediaType: string): string {
  const type = mediaType.toLowerCase();
  if (type === "application/pdf") return "PDF";
  if (type.startsWith("image/")) return type.slice(6).toUpperCase().replace("JPG", "JPEG");
  return "File";
}

function where(page: number | null): string {
  return page ? `p.${page}` : "whole file";
}

function sure(confidence: number | null, page: number | null): MatterBadge {
  if (confidence == null) return { tone: "gr", label: "Read", detail: where(page) };
  return { tone: confidence >= CONFIRM_THRESHOLD ? "ok" : "chg", label: `${confidence}%`, detail: where(page) };
}

/** One proposal as a `.fieldr` row: what it is, its value, how sure Vo is and where on the page. */
export function proposalRow(proposal: VoProposalRow): VoDocReviewRow {
  let label = proposal.label;
  let value = proposal.value ?? "";
  let badge: MatterBadge;
  let editable = false;
  switch (proposal.kind) {
    case "classification": {
      const category = proposal.category && proposal.category in VO_DOC_CATEGORY_LABEL ? VO_DOC_CATEGORY_LABEL[proposal.category as VoDocCategory | "other"] : "Document";
      label = `Suggested purpose · ${category}`;
      badge = sure(proposal.confidence, proposal.page);
      editable = true;
      break;
    }
    case "field":
      value = proposal.detail === "date" ? printedDate(value) : value;
      badge = sure(proposal.confidence, proposal.page);
      editable = true;
      break;
    case "deadline":
      label = `Proposed deadline · ${printedDate(proposal.dueOn ?? "")}`;
      value = proposal.label;
      badge = { tone: "blue", label: "Printed date", detail: where(proposal.page) };
      editable = true;
      break;
    case "missing_field":
      label = "Not found on the document";
      value = proposal.detail ? `${proposal.label}: ${proposal.detail}` : proposal.label;
      badge = { tone: "chg", label: "Check", detail: where(proposal.page) };
      break;
    case "inconsistency":
      label = "Doesn’t match (not a finding)";
      value = proposal.detail ? `${proposal.label}: ${proposal.detail}` : proposal.label;
      badge = { tone: "chg", label: "Check", detail: where(proposal.page) };
      break;
    case "needs_rule":
      label = "Needs a sourced rule";
      value = proposal.detail ? `${proposal.label}: ${proposal.detail}` : proposal.label;
      badge = { tone: "bad", label: "No rule", detail: "a consultant decides" };
      break;
  }
  return {
    f: String(proposal.position),
    label,
    value,
    badge,
    check: `Confirm ${proposal.label}`,
    editable,
    attrs: { "data-proposal": proposal.id, "data-kind": proposal.kind, "data-original": value },
  };
}

/** The review panel for one reading, or null when nothing in it is waiting any more. */
export function readingPanel(reading: VoReadingView): MatterDocumentReviewData | null {
  const waiting = reading.proposals.filter((proposal) => proposal.status === "proposed").sort((a, b) => a.position - b.position);
  if (!waiting.length) return null;
  const fields = waiting.filter((proposal) => proposal.kind === "field" && proposal.value);
  const text: VoDocPaperPart[] = [];
  fields.forEach((field, index) => {
    text.push(`${index === 0 ? "" : " "}${field.label}: `);
    text.push({ hl: field.detail === "date" ? printedDate(field.value ?? "") : (field.value ?? ""), f: String(field.position) });
    text.push(".");
  });
  if (!text.length) text.push("Vo didn’t read any values from this file. Its other proposals are on the right.");
  const pill = [`v${reading.versionNumber}`, mediaLabel(reading.mediaType)];
  if (reading.sha256) pill.push(`sha256 ${reading.sha256.slice(0, 4)}…${reading.sha256.slice(-4)}`);
  const low = waiting.some((proposal) => proposal.confidence != null && proposal.confidence < CONFIRM_THRESHOLD);
  return {
    title: reading.purpose,
    badge: { tone: "rev", label: "Read by Vo", detail: reading.needsRule ? "needs a sourced rule" : "needs your review" },
    pill,
    paper: { title: [reading.purpose, `version ${reading.versionNumber}`], text, note: ["Vo’s reading, not the original", "open the file to check it against the page"] },
    heading: ["Vo’s proposals", "confirm before they become facts"],
    rows: waiting.map(proposalRow),
    note: `Tick what is right, correct a value by typing over it, then accept. ${
      low ? `Values under ${CONFIRM_THRESHOLD}% stay unconfirmed until you check them against the page. ` : ""
    }Rejecting leaves the document and the matter as they are.`,
    accept: { label: "Accept ticked", attrs: { "data-vo-doc-accept": reading.id, "data-org": reading.organizationId } },
    reject: { label: "Reject the rest", attrs: { "data-vo-doc-reject": reading.id, "data-org": reading.organizationId } },
  };
}
