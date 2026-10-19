import type { Metadata } from "next";
import { Suspense } from "react";
import { SheetLoader } from "@/components/sheet/sheet-loader";
import { SheetBody, queryFrom } from "@/components/sheet/body";

export const metadata: Metadata = {
  title: "Home · Casevoya",
  robots: { index: false, follow: false },
};

export default function SheetHome({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  return (
    <Suspense fallback={<SheetLoader />}>
      <Home searchParams={searchParams} />
    </Suspense>
  );
}

async function Home({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const query = queryFrom(await searchParams);
  return <SheetBody page="index" query={query} />;
}
