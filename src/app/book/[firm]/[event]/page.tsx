import type { Metadata } from "next";
import { Suspense } from "react";
import { BookLive } from "@/components/sheet/book-live";
import { QuietSheet } from "@/components/sheet/live";
import { SheetScreen } from "@/components/sheet/screen";
import { hasPublicSupabaseEnv } from "@/lib/env";
import { parsePublicEvent } from "@/modules/scheduling/public-api";
import { publicDeps } from "@/modules/scheduling/public-deps";

/** Never indexed (a practice page least of all: it exists only for the firm's own staff). */
export const metadata: Metadata = {
  title: "Book · Casevoya",
  robots: { index: false, follow: false },
};

const SLUG = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/;

function Unavailable() {
  return (
    <SheetScreen page="book" tone="public">
      <QuietSheet title="This booking page isn’t available" copy="The firm hasn’t published this booking page, or the link is out of date." />
    </SheetScreen>
  );
}

async function Body({ params }: { params: Promise<{ firm: string; event: string }> }) {
  const { firm, event } = await params;
  const firmSlug = firm.toLowerCase();
  const eventSlug = event.toLowerCase();
  if (!SLUG.test(firmSlug) || !SLUG.test(eventSlug) || !hasPublicSupabaseEnv()) return <Unavailable />;
  let found = null;
  try {
    found = parsePublicEvent(await (await publicDeps()).event(firmSlug, eventSlug));
  } catch {
    found = null;
  }
  if (!found || found.priceCents > 0) return <Unavailable />;
  return (
    <SheetScreen page="book" tone="public">
      <BookLive event={found} />
    </SheetScreen>
  );
}

/** The firm's live booking page (BUILD-SPEC §4). The Designer demo stays at /book. */
export default function FirmBookingPage({ params }: { params: Promise<{ firm: string; event: string }> }) {
  return (
    <Suspense fallback={<SheetScreen page="book" tone="public"><QuietSheet title="Book" copy="Loading times…" /></SheetScreen>}>
      <Body params={params} />
    </Suspense>
  );
}
