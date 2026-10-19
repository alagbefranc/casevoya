import { connection } from "next/server";
import { appOrigin } from "@/lib/email/env";
import { enquiryEmbedScript } from "@/modules/leads/share";

/**
 * The enquiry form's embed script (CRM-01). A firm pastes
 * `<div data-casevoya-enquiry="<firm>"></div><script async src="https://app.casevoya.ca/embed/enquiry.js"></script>`
 * on its own site; the script inserts the firm's embedded form and keeps the iframe sized to it.
 * The same file for every firm, so shared caches may keep it for a few minutes.
 */
export async function GET() {
  // Built per request: the origin comes from this deployment's APP_URL, not from the build.
  await connection();
  return new Response(enquiryEmbedScript(appOrigin()), {
    headers: {
      "Content-Type": "text/javascript; charset=utf-8",
      "Cache-Control": "public, max-age=300",
      "X-Content-Type-Options": "nosniff",
      "Cross-Origin-Resource-Policy": "cross-origin",
    },
  });
}
