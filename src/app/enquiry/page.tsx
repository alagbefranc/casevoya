import type { Metadata } from "next";
import { QuietSheet } from "@/components/sheet/live";
import { SheetScreen } from "@/components/sheet/screen";

export const metadata: Metadata = {
  title: "Enquiry · Casevoya",
  robots: { index: false, follow: false },
};

/**
 * Not a firm's form: each firm's enquiry page is /enquiry/<firm> (CRM-01). This address used to
 * show the Designer's demo page (a fictional firm); it now says where the real forms are, so no
 * visitor can send an enquiry to a firm that doesn't exist (docs/DECISIONS.md, 2026-10-19).
 */
export default function EnquiryPage() {
  return (
    <SheetScreen page="enquiry" tone="public">
      <QuietSheet
        title="Find your firm’s enquiry form"
        copy="Each firm has its own enquiry link, like app.casevoya.ca/enquiry/firm-name. Ask the firm for theirs, or use the form on its website."
      />
    </SheetScreen>
  );
}
