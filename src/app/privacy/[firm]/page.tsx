import type { Metadata } from "next";
import { Suspense } from "react";
import { BOOK_PAGE_CSS } from "@/components/sheet/designer/book";
import { QuietSheet } from "@/components/sheet/live";
import { SheetScreen } from "@/components/sheet/screen";
import { hasPublicSupabaseEnv } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";
import { parsePrivacyNotice, type PublicPrivacyNotice } from "@/modules/leads/privacy";
import { longDate } from "@/modules/sheet/matter-present";

export const metadata: Metadata = {
  title: "Privacy notice · Casevoya",
  robots: { index: false, follow: false },
};

const SLUG = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/;

async function Body({ params }: { params: Promise<{ firm: string }> }) {
  const firm = (await params).firm.toLowerCase();
  let notice: PublicPrivacyNotice | null = null;
  if (SLUG.test(firm) && hasPublicSupabaseEnv()) {
    try {
      const supabase = await createClient();
      const { data, error } = await supabase.rpc("public_privacy_notice", { p_firm_slug: firm });
      notice = error ? null : parsePrivacyNotice(data);
    } catch {
      notice = null;
    }
  }
  if (!notice) {
    return (
      <SheetScreen page="book" tone="public">
        <QuietSheet title="No privacy notice here" copy="This firm hasn’t published a privacy notice, or the link is out of date." />
      </SheetScreen>
    );
  }
  const paragraphs = notice.body.split(/\n{2,}/).map((part) => part.trim()).filter(Boolean);
  // The booking page's frame (.pb): the firm's published privacy notice, read only, as published.
  return (
    <SheetScreen page="book" tone="public">
      <style dangerouslySetInnerHTML={{ __html: BOOK_PAGE_CSS }} />
      <div className="pb">
        <header>
          <span>{notice.firmName}</span>
        </header>
        <main id="m" style={{ display: "block", maxWidth: "720px" }}>
          <h1>{notice.title}</h1>
          <p className="lead">{`${notice.firmName}’s privacy notice${notice.version ? `, version ${notice.version}` : ""}${notice.publishedOn ? `, published ${longDate(notice.publishedOn)}` : ""}.`}</p>
          <div style={{ marginTop: "24px", display: "grid", gap: "14px", lineHeight: 1.6 }}>
            {paragraphs.map((part, index) => (
              <p key={index} style={{ margin: 0, whiteSpace: "pre-wrap" }}>
                {part}
              </p>
            ))}
          </div>
          <p style={{ marginTop: "28px", color: "#615d59", fontSize: "14px" }}>{`Questions about this notice go to ${notice.firmName}.`}</p>
        </main>
        <footer>
          <span>{notice.firmName}</span>
          <span>Powered by Casevoya</span>
        </footer>
      </div>
    </SheetScreen>
  );
}

/** The firm's published privacy notice, public and read only (CRM-01), linked from its enquiry and booking pages. */
export default function FirmPrivacyPage({ params }: { params: Promise<{ firm: string }> }) {
  return (
    <Suspense fallback={<SheetScreen page="book" tone="public"><QuietSheet title="Privacy notice" copy="Loading…" /></SheetScreen>}>
      <Body params={params} />
    </Suspense>
  );
}
