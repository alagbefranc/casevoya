import { NextResponse } from "next/server";
import { EMAIL_TEMPLATES, renderTemplate, type TemplateId } from "@/modules/email/designs/catalog";
import { renderHtml } from "@/modules/email/designs/layout";
import { loadSheetAccess } from "@/modules/sheet/load";

/**
 * Templates › Message templates: a preview of one approved email design, rendered with the
 * catalog's own synthetic sample values (never a client's data). Signed-in staff only.
 */
export async function GET(request: Request) {
  const id = new URL(request.url).searchParams.get("id") ?? "";
  const access = await loadSheetAccess();
  if (access.kind !== "live" && access.kind !== "sample") return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  if (!Object.prototype.hasOwnProperty.call(EMAIL_TEMPLATES, id)) return NextResponse.json({ error: "Choose an email design." }, { status: 404 });
  const design = id as TemplateId;
  const origin = new URL(request.url).origin;
  const copy = renderTemplate(design, EMAIL_TEMPLATES[design].sample as never, origin);
  const html = renderHtml(copy, origin);
  const banner = `<p style="font:14px system-ui,sans-serif;margin:12px auto;max-width:640px;color:#4a4642">Preview of “${EMAIL_TEMPLATES[design].name}” with sample values, not a real client’s. <a href="/sheet/templates?tab=messages">Back to Message templates</a></p>`;
  return new Response(html.replace(/<body([^>]*)>/i, `<body$1>${banner}`), {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; img-src 'self' data: https:; style-src 'unsafe-inline'; frame-ancestors 'none'",
    },
  });
}
