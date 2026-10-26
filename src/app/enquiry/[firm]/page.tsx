import type { Metadata } from "next";
import { Suspense } from "react";
import { EnquiryLive } from "@/components/sheet/enquiry-live";
import { QuietSheet } from "@/components/sheet/live";
import { SheetScreen } from "@/components/sheet/screen";
import { ENQUIRY_UNAVAILABLE, loadEnquiryPage } from "@/modules/leads/enquiry-page";
import { ENQUIRY_CLOSED_COPY, enquiryClosedTitle } from "@/modules/leads/enquiry-present";

export const metadata: Metadata = {
  title: "Enquiry · Casevoya",
  robots: { index: false, follow: false },
};

function EnquiryUnavailable() {
  return (
    <SheetScreen page="enquiry" tone="public">
      <QuietSheet title="This form isn’t available" copy="The firm hasn’t turned on its enquiry form, or the link is out of date." />
    </SheetScreen>
  );
}

async function Body({ params }: { params: Promise<{ firm: string }> }) {
  const loaded = await loadEnquiryPage((await params).firm, false);
  if (loaded === "unavailable") {
    return (
      <SheetScreen page="enquiry" tone="public">
        <QuietSheet title={ENQUIRY_UNAVAILABLE.title} copy={ENQUIRY_UNAVAILABLE.copy} />
      </SheetScreen>
    );
  }
  if (!loaded) return <EnquiryUnavailable />;
  // CRM-01: the firm turned its enquiry page off in Settings.
  if (!loaded.open) {
    return (
      <SheetScreen page="enquiry" tone="public">
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
 * The firm's hosted enquiry page (CRM-01). An unknown firm, one without a published privacy
 * notice, or a sample-mode firm for anyone but its own staff answers 404 (src/proxy.ts) before
 * this streams.
 */
export default function FirmEnquiryPage({ params }: { params: Promise<{ firm: string }> }) {
  return (
    <Suspense fallback={<SheetScreen page="enquiry" tone="public"><QuietSheet title="Enquiry" copy="Loading…" /></SheetScreen>}>
      <Body params={params} />
    </Suspense>
  );
}
