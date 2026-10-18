import type { Metadata } from "next";
import { Suspense } from "react";
import { QuietSheet } from "@/components/sheet/live";
import { BOOK_PAGE_CSS } from "@/components/sheet/designer/book";
import { SheetScreen } from "@/components/sheet/screen";
import { hasPublicSupabaseEnv } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";
import { locationLabel } from "@/modules/scheduling/format";

export const metadata: Metadata = {
  title: "Book · Casevoya",
  robots: { index: false, follow: false },
};

const SLUG = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/;

type Listing = { firm_name: string; firm_slug: string; types: { slug: string; title: string; description: string | null; duration_min: number; location_kind: string }[] };

async function Body({ params }: { params: Promise<{ firm: string }> }) {
  const firm = (await params).firm.toLowerCase();
  let listing: Listing | null = null;
  if (SLUG.test(firm) && hasPublicSupabaseEnv()) {
    const supabase = await createClient();
    const { data } = await supabase.rpc("booking_public_event_types", { p_firm_slug: firm });
    listing = data && typeof data === "object" ? (data as unknown as Listing) : null;
  }
  if (!listing || listing.types.length === 0) {
    return (
      <SheetScreen page="book" tone="public">
        <QuietSheet title="No booking pages yet" copy="This firm hasn’t published a booking page." />
      </SheetScreen>
    );
  }
  // The Designer's booking page frame (.pb) with one card per published type.
  return (
    <SheetScreen page="book" tone="public">
      <style dangerouslySetInnerHTML={{ __html: BOOK_PAGE_CSS }} />
      <div className="pb">
        <header>
          <span>{listing.firm_name}</span>
        </header>
        <main id="m" style={{ display: "block" }}>
          <h1>Book a consultation</h1>
          <p className="lead">Choose what you’d like to talk about. Times are shown in your timezone on the next page.</p>
          <div style={{ display: "grid", gap: "12px", marginTop: "24px", maxWidth: "640px" }}>
            {listing.types.map((type) => (
              <a key={type.slug} className="card" href={`/book/${listing.firm_slug}/${type.slug}`} style={{ textDecoration: "none", color: "inherit" }}>
                <b style={{ fontWeight: 500 }}>{type.title}</b>
                <small style={{ color: "#615d59" }}>{`${type.duration_min} minutes · ${locationLabel(type.location_kind)}`}</small>
                {type.description ? <small style={{ color: "#615d59" }}>{type.description}</small> : null}
              </a>
            ))}
          </div>
        </main>
        <footer>
          <span>{listing.firm_name}</span>
          <span>Powered by Casevoya</span>
        </footer>
      </div>
    </SheetScreen>
  );
}

export default function FirmBookingIndex({ params }: { params: Promise<{ firm: string }> }) {
  return (
    <Suspense fallback={<SheetScreen page="book" tone="public"><QuietSheet title="Book" copy="Loading…" /></SheetScreen>}>
      <Body params={params} />
    </Suspense>
  );
}
