import type { Metadata } from "next";
import { Suspense } from "react";
import { AgreementSign, AgreementSignError, AgreementSignLoading } from "@/components/sheet/agreement-sign";
import { QuietSheet } from "@/components/sheet/live";
import { SheetScreen } from "@/components/sheet/screen";
import { hasPublicSupabaseEnv } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";
import { firmLogo } from "@/modules/firm-onboarding/public-logo";
import { isBookingRef, readSigningView } from "@/modules/scheduling/agreement-sign-present";

/** A private link: never indexed. */
export const metadata: Metadata = {
  title: "Consultation agreement · Casevoya",
  robots: { index: false, follow: false },
};

function Unavailable() {
  return (
    <SheetScreen page="book" tone="public">
      <QuietSheet title="This agreement isn’t available" copy="The link may be out of date. Ask the firm for a new link." />
    </SheetScreen>
  );
}

async function Body({ params }: { params: Promise<{ ref: string }> }) {
  const { ref } = await params;
  const reference = ref.toLowerCase();
  if (!isBookingRef(reference) || !hasPublicSupabaseEnv()) return <Unavailable />;
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("booking_agreement_for_signing", { p_ref: reference });
  // The server didn't answer: nothing was signed and the link still works.
  if (error) {
    return (
      <SheetScreen page="book" tone="public">
        <AgreementSignError firm={null} />
      </SheetScreen>
    );
  }
  const view = readSigningView(data);
  if (view.state === "unavailable") return <Unavailable />;
  // The firm sees when the link was first opened (only while it is unsigned).
  if (view.state === "open") await supabase.rpc("note_booking_agreement_opened", { p_ref: reference });
  const logo = view.firmSlug ? await firmLogo(view.firmSlug) : null;
  return (
    <SheetScreen page="book" tone="public">
      <AgreementSign view={view} reference={reference} logo={logo} />
    </SheetScreen>
  );
}

/** A consultation agreement, signed through the booking's private link (no login). */
export default function ConsultationAgreementPage({ params }: { params: Promise<{ ref: string }> }) {
  return (
    <Suspense
      fallback={
        <SheetScreen page="book" tone="public">
          <AgreementSignLoading />
        </SheetScreen>
      }
    >
      <Body params={params} />
    </Suspense>
  );
}
