import type { Metadata } from "next";
import { Suspense } from "react";
import { AcceptClientMarkup } from "@/components/port/markup/accept-client";
import { PortScreen } from "@/components/port/screen";
import { faceFromPortalPreview, type InviteFace } from "@/lib/auth/invite-face";
import { hasPublicSupabaseEnv } from "@/lib/env";
import { previewPortalInvitation } from "@/modules/portal-invitations/actions";

export const metadata: Metadata = {
  title: "Your portal · Casevoya",
  robots: { index: false, follow: false },
};

function ClientInvite({ token, face }: { token?: string; face?: InviteFace }) {
  return (
    <PortScreen page="accept-client" variant="wzb" token={token}>
      <AcceptClientMarkup face={face} />
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
  return <ClientInvite token={token} face={face} />;
}

export default function AcceptClientPage({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  return (
    <Suspense fallback={<ClientInvite />}>
      <Token searchParams={searchParams} />
    </Suspense>
  );
}
