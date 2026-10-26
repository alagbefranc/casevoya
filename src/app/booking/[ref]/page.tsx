import type { Metadata } from "next";
import { Suspense } from "react";
import { BOOK_PAGE_CSS } from "@/components/sheet/designer/book";
import { QuietSheet } from "@/components/sheet/live";
import { ManageBooking } from "@/components/sheet/manage-booking";
import { SheetScreen } from "@/components/sheet/screen";
import { hasPublicSupabaseEnv } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";
import { loadManageView, MANAGE_GONE_COPY, MANAGE_UNAVAILABLE_COPY } from "@/modules/scheduling/manage-present";

export const metadata: Metadata = {
  title: "Manage your booking · Casevoya",
  robots: { index: false, follow: false },
};

async function Body({ params, searchParams }: { params: Promise<{ ref: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const ref = (await params).ref.toLowerCase();
  const raw = (await searchParams).t;
  const token = Array.isArray(raw) ? raw[0] ?? "" : raw ?? "";
  const supabase = hasPublicSupabaseEnv() ? await createClient().catch(() => null) : null;
  const view = await loadManageView(
    ref,
    token,
    supabase ? async (p_ref, p_sha256) => supabase.rpc("booking_manage_view", { p_ref, p_sha256 }) : null,
  );
  if (view.kind !== "booking") {
    const words = view.kind === "gone" ? MANAGE_GONE_COPY : MANAGE_UNAVAILABLE_COPY;
    return (
      <SheetScreen page="book" tone="public">
        <QuietSheet title={words.title} copy={words.copy} />
      </SheetScreen>
    );
  }
  const booking = view.booking;
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
