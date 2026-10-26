import { stepUpHref } from "@/lib/auth/mfa-step";
import { createClient } from "@/lib/supabase/server";
import { isUuid } from "@/lib/tenant/context";
import { PREVIEWABLE, previewStamp, watermarkedPreview } from "@/modules/documents/preview";

const NO_STORE = {
  "Cache-Control": "no-store, private, max-age=0",
  Pragma: "no-cache",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
};

/** A short plain page in place of the preview: why it can't be shown. */
function page(text: string, status: number) {
  const html = `<!doctype html><meta charset="utf-8"><title>Preview</title><body style="font:16px/1.5 system-ui,sans-serif;margin:48px;color:#111"><p>${text}</p><p><a href="javascript:window.close()">Close this tab</a></p></body>`;
  return new Response(html, { status, headers: { ...NO_STORE, "Content-Type": "text/html; charset=utf-8", "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'" } });
}

/** Where to come back to after a step-up: the page that opened the preview, on this site. */
function backTo(request: Request): string {
  const referer = request.headers.get("referer");
  try {
    const from = referer ? new URL(referer) : null;
    if (from && from.origin === new URL(request.url).origin && from.pathname.startsWith("/")) return `${from.pathname}${from.search}`;
  } catch {
    // An unreadable referrer just goes back to Documents.
  }
  return "/sheet/documents?tab=all";
}

/**
 * Secure preview (DOC-07): the file shown in the browser, never cached, with the viewer's name and
 * the time burned into every page. Access is the download check itself
 * (public.authorize_document_download: who may read it, a clean file, a staff step-up), so each
 * preview is in the audit log like a download. The original stays untouched in storage.
 */
export async function GET(request: Request, { params }: { params: Promise<{ version: string }> }) {
  const { version } = await params;
  const org = new URL(request.url).searchParams.get("org") ?? "";
  if (!isUuid(version) || !isUuid(org)) return page("That file can’t be previewed.", 400);
  const supabase = await createClient({ organizationId: org });
  const { data: claims } = await supabase.auth.getClaims();
  const userId = claims?.claims?.sub;
  if (!userId) return page("Sign in to Casevoya first, then open the file again.", 401);

  const { data: meta } = await supabase.from("document_versions").select("detected_media_type, declared_media_type").eq("id", version).maybeSingle();
  const type = meta?.detected_media_type ?? meta?.declared_media_type ?? "";
  if (!meta) return page("You can’t open this file.", 403);
  if (!PREVIEWABLE.has(type)) return page("This file type has no preview yet. Download it from the document instead.", 415);

  const grant = await supabase.rpc("authorize_document_download", { p_version_id: version });
  if (grant.error) {
    if (/step-up/i.test(grant.error.message)) {
      // SEC-01: the step-up names its action ("open a client document"), like every other caller.
      return Response.redirect(new URL(stepUpHref(backTo(request), "document_open"), request.url), 303);
    }
    return page("You can’t open this file.", 403);
  }
  const record = grant.data && typeof grant.data === "object" && !Array.isArray(grant.data) ? (grant.data as Record<string, unknown>) : {};
  if (typeof record.bucket !== "string" || typeof record.storage_key !== "string") return page("That file can’t be previewed.", 500);
  const { data: blob } = await supabase.storage.from(record.bucket).download(record.storage_key);
  if (!blob) return page("That file can’t be previewed right now. Try again.", 502);

  const { data: profile } = await supabase.from("profiles").select("display_name").eq("id", userId).maybeSingle();
  const email = typeof claims?.claims?.email === "string" ? claims.claims.email : "";
  const stamp = previewStamp(profile?.display_name || email || "Signed-in user", new Date());
  const pdf = await watermarkedPreview(new Uint8Array(await blob.arrayBuffer()), type, stamp);
  if (!pdf) return page("This file can’t be previewed. Download it from the document instead.", 422);
  return new Response(Buffer.from(pdf), {
    headers: { ...NO_STORE, "Content-Type": "application/pdf", "Content-Disposition": 'inline; filename="casevoya-preview.pdf"' },
  });
}
