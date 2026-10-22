import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { CallScreen } from "@/components/video/call-screen";
import { signInLocation } from "@/lib/auth/redirect";
import { loadPortalAccess } from "@/modules/portal/load";
import { loadSheetAccess } from "@/modules/sheet/load";
import { CALL_REF } from "@/modules/video/present";
import { readCall } from "@/modules/video/service";

export const metadata: Metadata = {
  title: "Video call · Casevoya",
  robots: { index: false, follow: false },
};

/**
 * The call page for one booking (`/call/<booking reference>`, BUILD-SPEC §7.4). The reference is
 * not a secret: nothing renders until the signed-in person is the booking's host, a firm owner
 * (Sheet, staff MFA) or the booking's own client (portal). Staff are checked first, then the portal.
 */
async function Body({ params }: { params: Promise<{ ref: string }> }) {
  const { ref } = await params;
  const back = { href: "/portal/appointments", label: "Back to appointments" };
  if (!CALL_REF.test(ref)) return <CallScreen kind="refused" back={back} />;

  // Both lookups at once; the staff answer wins when the person is both.
  const [sheet, portal] = await Promise.all([loadSheetAccess(), loadPortalAccess()]);
  if (sheet.kind === "signed-out") redirect(signInLocation(`/call/${ref}`));
  const staffOrg = sheet.kind === "live" || sheet.kind === "sample" ? sheet.staff.organizationId : null;
  const portalOrg = portal.kind === "live" ? portal.viewer.organizationId : null;
  const staffBack = { href: "/sheet/consultations", label: "Back to consultations" };
  const [asStaff, asClient] = await Promise.all([
    staffOrg ? readCall(staffOrg, ref) : null,
    portalOrg && portalOrg !== staffOrg ? readCall(portalOrg, ref) : null,
  ]);
  if (staffOrg && asStaff && !("error" in asStaff)) return <CallScreen kind="call" organizationId={staffOrg} callRef={ref} view={asStaff} back={staffBack} />;
  if (portalOrg && asClient && !("error" in asClient)) return <CallScreen kind="call" organizationId={portalOrg} callRef={ref} view={asClient} back={back} />;
  return <CallScreen kind="refused" back={staffOrg ? staffBack : back} />;
}

export default function CallPage({ params }: { params: Promise<{ ref: string }> }) {
  return (
    <Suspense fallback={null}>
      <Body params={params} />
    </Suspense>
  );
}
