import type { Metadata } from "next";
import { Suspense } from "react";
import { SheetLoader } from "@/components/sheet/sheet-loader";
import { SheetBody, queryFrom } from "@/components/sheet/body";

export const metadata: Metadata = {
  title: "Matters · Casevoya",
  robots: { index: false, follow: false },
};

export default function MattersPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  return (
    <Suspense fallback={<SheetLoader />}>
      <Body searchParams={searchParams} />
    </Suspense>
  );
}

async function Body({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  return <SheetBody page="matters" query={queryFrom(await searchParams)} />;
}
