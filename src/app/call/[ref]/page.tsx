import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { CallScreen } from "@/components/video/call-screen";
import { signInLocation } from "@/lib/auth/redirect";
import { loadPortalAccess } from "@/modules/portal/load";
import { loadSheetAccess } from "@/modules/sheet/load";
import { readCall } from "@/modules/video/service";

export const metadata: Metadata = {
  title: "Video call · Casevoya",
  robots: { index: false, follow: false },
};

const REF = /^[a-z2-7]{26}$/;

/**
 * The call page for one booking (`/call/<booking reference>`, BUILD-SPEC §7.4). The reference is
 * not a secret: nothing renders until the signed-in person is the booking's host, a firm owner
 * (Sheet, staff MFA) or the booking's own client (portal). Staff are checked first, then the portal.
 */
async function Body({ params }: { params: Promise<{ ref: string }> }) {
  const { ref } = await params;
  const back = { href: "/portal/appointments", label: "Back to appointments" };
  if (!REF.test(ref)) return <CallScreen kind="refused" back={back} />;

  const sheet = await loadSheetAccess();
  if (sheet.kind === "signed-out") redirect(signInLocation(`/call/${ref}`));
  let organizationId: string | null = sheet.kind === "live" || sheet.kind === "sample" ? sheet.staff.organizationId : null;
  let staffBack = organizationId ? { href: "/sheet/consultations", label: "Back to consultations" } : null;
  if (organizationId) {
    const asStaff = await readCall(organizationId, ref);
    if (!("error" in asStaff)) return <CallScreen kind="call" organizationId={organizationId} callRef={ref} view={asStaff} back={staffBack ?? back} />;
  }
  const portal = await loadPortalAccess();
  if (portal.kind === "live") {
    organizationId = portal.viewer.organizationId;
    staffBack = null;
    const asClient = await readCall(organizationId, ref);
    if (!("error" in asClient)) return <CallScreen kind="call" organizationId={organizationId} callRef={ref} view={asClient} back={back} />;
  }
  return <CallScreen kind="refused" back={staffBack ?? back} />;
}

export default function CallPage({ params }: { params: Promise<{ ref: string }> }) {
  return (
    <Suspense fallback={null}>
      <Body params={params} />
    </Suspense>
  );
}
