import type { Metadata } from "next";
import { Suspense } from "react";
import { EnquiryLive } from "@/components/sheet/enquiry-live";
import { QuietSheet } from "@/components/sheet/live";
import { SheetScreen } from "@/components/sheet/screen";
import { loadEnquiryPage } from "@/modules/leads/enquiry-page";
import { ENQUIRY_CLOSED_COPY, enquiryClosedTitle } from "@/modules/leads/enquiry-present";

export const metadata: Metadata = {
  title: "Enquiry · Casevoya",
  robots: { index: false, follow: false },
};

const TRANSPARENT = "html,body{background:transparent!important;min-height:0!important}";

async function Body({ params }: { params: Promise<{ firm: string }> }) {
  const loaded = await loadEnquiryPage((await params).firm, true);
  if (!loaded) {
    return (
      <SheetScreen page="enquiry" tone="public">
        <style dangerouslySetInnerHTML={{ __html: TRANSPARENT }} />
        <QuietSheet title="This form isn’t available" copy="The firm hasn’t turned on its enquiry form, or the link is out of date." />
      </SheetScreen>
    );
  }
  // CRM-01: the firm turned its enquiry page off in Settings.
  if (!loaded.open) {
    return (
      <SheetScreen page="enquiry" tone="public">
        <style dangerouslySetInnerHTML={{ __html: TRANSPARENT }} />
        <QuietSheet title={enquiryClosedTitle(loaded.firmName)} copy={ENQUIRY_CLOSED_COPY} />
      </SheetScreen>
    );
  }
  return (
    <SheetScreen page="enquiry" tone="public">
      <EnquiryLive {...loaded} />
    </SheetScreen>
  );
}

/**
 * The firm's enquiry form for an iframe on its own website (CRM-01): the form only, on a
 * transparent page, posting its height to the page around it (see /embed/enquiry.js). This route,
 * and only this route, may be framed by any site (src/lib/security/framing.ts). Leads sent from
 * here are recorded with the source "Website form".
 */
export default function EmbeddedEnquiryPage({ params }: { params: Promise<{ firm: string }> }) {
  return (
    <Suspense fallback={<SheetScreen page="enquiry" tone="public"><style dangerouslySetInnerHTML={{ __html: TRANSPARENT }} /></SheetScreen>}>
      <Body params={params} />
    </Suspense>
  );
}
