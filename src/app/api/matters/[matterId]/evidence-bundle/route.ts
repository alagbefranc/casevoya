import { NextResponse } from "next/server";
import { stepUpHref } from "@/lib/auth/mfa-step";
import { createClient } from "@/lib/supabase/server";
import { isUuid } from "@/lib/tenant/context";
import { bundleFileName } from "@/modules/prep/channel-name";
import { renderEvidenceBundle, type BundleSource } from "@/modules/prep/bundle-pdf";
import { SUBMISSION_CHANNEL_OPTIONS } from "@/modules/government/present";

const NO_STORE = {
  "Cache-Control": "no-store, private, max-age=0",
  Pragma: "no-cache",
  "X-Content-Type-Options": "nosniff",
};

/**
 * PREP-03: the matter's saved document selection as one PDF (cover, index, documents, page numbers).
 * Each file is opened with the same download check as a preview, so each one is audited.
 */
export async function GET(request: Request, { params }: { params: Promise<{ matterId: string }> }) {
  const { matterId } = await params;
  const organizationId = new URL(request.url).searchParams.get("organizationId") ?? "";
  if (!isUuid(matterId) || !isUuid(organizationId)) {
    return NextResponse.json({ error: "Choose the matter." }, { status: 400 });
  }
  const supabase = await createClient({ organizationId });
  const { data: claims } = await supabase.auth.getClaims();
  if (!claims?.claims?.sub) return NextResponse.json({ error: "Sign in first." }, { status: 401 });

  const index = await supabase.rpc("bundle_index", { p_matter_id: matterId });
  if (index.error) {
    if (/step-up/i.test(index.error.message)) {
      const back = `/sheet/matters/${matterId}?tab=documents`;
      return Response.redirect(new URL(stepUpHref(back, "document_open"), request.url), 303);
    }
    return NextResponse.json({ error: "You can’t build this bundle." }, { status: 403 });
  }
  const body = index.data && typeof index.data === "object" && !Array.isArray(index.data) ? (index.data as Record<string, unknown>) : {};
  const items = Array.isArray(body.items) ? body.items : [];
  if (items.length === 0) return NextResponse.json({ error: "Select documents and save the order first." }, { status: 400 });

  const documents: BundleSource[] = [];
  for (const item of items) {
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    const versionId = typeof row.document_version_id === "string" ? row.document_version_id : "";
    const fileName = typeof row.file_name === "string" ? row.file_name : "document";
    const purpose = typeof row.purpose === "string" ? row.purpose : "Document";
    const mediaType = typeof row.media_type === "string" ? row.media_type : "application/octet-stream";
    if (!isUuid(versionId)) continue;
    const grant = await supabase.rpc("authorize_document_download", { p_version_id: versionId });
    if (grant.error) {
      if (/step-up/i.test(grant.error.message)) {
        const back = `/sheet/matters/${matterId}?tab=documents`;
        return Response.redirect(new URL(stepUpHref(back, "document_open"), request.url), 303);
      }
      return NextResponse.json({ error: "A selected file can’t be included." }, { status: 403 });
    }
    const record = grant.data && typeof grant.data === "object" && !Array.isArray(grant.data) ? (grant.data as Record<string, unknown>) : {};
    if (typeof record.bucket !== "string" || typeof record.storage_key !== "string") {
      return NextResponse.json({ error: "A selected file can’t be read right now." }, { status: 502 });
    }
    const downloaded = await supabase.storage.from(record.bucket).download(record.storage_key);
    if (!downloaded.data) return NextResponse.json({ error: "A selected file can’t be read right now." }, { status: 502 });
    documents.push({ fileName, purpose, mediaType, bytes: new Uint8Array(await downloaded.data.arrayBuffer()) });
  }

  const rule = body.rule && typeof body.rule === "object" && !Array.isArray(body.rule) ? (body.rule as Record<string, unknown>) : {};
  const channel = typeof body.channel === "string" ? body.channel : "other";
  const channelLabel = SUBMISSION_CHANNEL_OPTIONS.find((option) => option.value === channel)?.label ?? "Channel";
  const reference = typeof body.reference === "string" ? body.reference : matterId.slice(0, 8);
  const pattern = typeof rule.name_pattern === "string" ? rule.name_pattern : "{reference}-evidence-bundle.pdf";
  const maxBytes = typeof rule.max_bytes === "number" ? rule.max_bytes : 25 * 1024 * 1024;
  const fileName = bundleFileName(pattern, { reference, channel: channelLabel, date: new Date().toISOString().slice(0, 10) });
  const firm = await supabase.from("organizations").select("display_name, legal_name").eq("id", organizationId).maybeSingle();
  const rendered = await renderEvidenceBundle({
    firmName: firm.data?.display_name || firm.data?.legal_name || "Firm",
    matterReference: reference,
    channelLabel,
    generatedAt: new Date().toISOString(),
    documents,
    maxBytes,
  });
  if ("error" in rendered && rendered.error === "empty") return NextResponse.json({ error: "Select documents and save the order first." }, { status: 400 });
  if ("error" in rendered && rendered.error === "over_limit") {
    return NextResponse.json(
      { error: `The bundle is over this channel’s Casevoya size limit (${Math.round(rendered.maxBytes / (1024 * 1024))} MB). Remove a document or raise the limit.` },
      { status: 413 },
    );
  }
  if (!("pdf" in rendered)) return NextResponse.json({ error: "The bundle couldn’t be built." }, { status: 500 });
  await supabase.rpc("record_bundle_export", {
    p_matter_id: matterId,
    p_file_name: fileName,
    p_byte_size: rendered.byteSize,
    p_page_count: rendered.plan.totalPages,
  });
  return new Response(Buffer.from(rendered.pdf), {
    headers: {
      ...NO_STORE,
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${fileName.replace(/"/g, "")}"`,
    },
  });
}
