import type { Metadata } from "next";
import { Suspense } from "react";
import { AcceptSponsorMarkup } from "@/components/port/markup/accept-sponsor";
import { PortScreen } from "@/components/port/screen";
import { faceFromPortalPreview, type InviteFace } from "@/lib/auth/invite-face";
import { hasPublicSupabaseEnv } from "@/lib/env";
import { previewPortalInvitation } from "@/modules/portal-invitations/actions";

export const metadata: Metadata = {
  title: "Your invitation · Casevoya",
  robots: { index: false, follow: false },
};

function SponsorInvite({ token, face }: { token?: string; face?: InviteFace }) {
  return (
    <PortScreen page="accept-sponsor" variant="wzb" token={token}>
      <AcceptSponsorMarkup face={face} />
    </PortScreen>
  );
}

async function Token({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const { token } = await searchParams;
  let face: InviteFace | undefined;
  if (token && hasPublicSupabaseEnv()) {
    const opened = await previewPortalInvitation(token);
    if (!("error" in opened)) face = faceFromPortalPreview(opened.preview);
  }
  return <SponsorInvite token={token} face={face} />;
}

export default function AcceptSponsorPage({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  return (
    <Suspense fallback={<SponsorInvite />}>
      <Token searchParams={searchParams} />
    </Suspense>
  );
}
