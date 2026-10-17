import type { Metadata } from "next";
import { Suspense } from "react";
import { SheetBody, queryFrom } from "@/components/sheet/body";
import { DemoSheet } from "@/components/sheet/demo";
import { SheetScreen } from "@/components/sheet/screen";

export const metadata: Metadata = {
  title: "Enquiry · Casevoya",
  robots: { index: false, follow: false },
};

export default function EnquiryPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  return (
    <Suspense fallback={<SheetScreen page="enquiry" tone="public"><DemoSheet page="enquiry" query={{}} /></SheetScreen>}>
      <Body searchParams={searchParams} />
    </Suspense>
  );
}

async function Body({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  return <SheetBody page="enquiry" query={queryFrom(await searchParams)} />;
}
