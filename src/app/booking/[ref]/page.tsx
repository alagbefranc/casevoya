import type { Metadata } from "next";
import { Suspense } from "react";
import { BOOK_PAGE_CSS } from "@/components/sheet/designer/book";
import { QuietSheet } from "@/components/sheet/live";
import { ManageBooking } from "@/components/sheet/manage-booking";
import { SheetScreen } from "@/components/sheet/screen";
import { hasPublicSupabaseEnv } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";
import { isBookingRef, isManageToken, manageTokenHash, parseManagedBooking, type ManagedBooking } from "@/modules/scheduling/manage-present";

export const metadata: Metadata = {
  title: "Manage your booking · Casevoya",
  robots: { index: false, follow: false },
};

async function Body({ params, searchParams }: { params: Promise<{ ref: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const ref = (await params).ref.toLowerCase();
  const raw = (await searchParams).t;
  const token = Array.isArray(raw) ? raw[0] ?? "" : raw ?? "";
  let booking: ManagedBooking | null = null;
  if (isBookingRef(ref) && isManageToken(token) && hasPublicSupabaseEnv()) {
    try {
      const supabase = await createClient();
      const { data, error } = await supabase.rpc("booking_manage_view", { p_ref: ref, p_sha256: await manageTokenHash(token) });
      booking = error ? null : parseManagedBooking(data);
    } catch {
      booking = null;
    }
  }
  if (!booking) {
    return (
      <SheetScreen page="book" tone="public">
        <QuietSheet title="This link doesn’t work any more" copy="Use the Manage your booking link in your latest email from the firm, or contact the firm. Links stop working after the appointment, or when a newer email replaces them." />
      </SheetScreen>
    );
  }
  return (
    <SheetScreen page="book" tone="public">
      <style dangerouslySetInnerHTML={{ __html: BOOK_PAGE_CSS }} />
      <ManageBooking booking={booking} token={token} />
    </SheetScreen>
  );
}

/**
 * "Manage your booking" (CRM-03): a booker without a portal opens this from their confirmation or
 * reschedule email to see, move or cancel their consultation. The token in the link is the only
 * proof; it is checked as a hash by the database.
 */
export default function ManageBookingPage(props: { params: Promise<{ ref: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  return (
    <Suspense fallback={<SheetScreen page="book" tone="public"><QuietSheet title="Manage your booking" copy="Loading…" /></SheetScreen>}>
      <Body {...props} />
    </Suspense>
  );
}
