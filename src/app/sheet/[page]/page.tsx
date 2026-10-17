import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { SheetBody, isSheetPage, queryFrom } from "@/components/sheet/body";
import { DemoSheet } from "@/components/sheet/demo";
import { SheetScreen } from "@/components/sheet/screen";

export const metadata: Metadata = {
  title: "Casevoya",
  robots: { index: false, follow: false },
};

const RESERVED = new Set(["matters", "enquiry", "book"]);

export default function SheetPage({
  params,
  searchParams,
}: {
  params: Promise<{ page: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  return (
    <Suspense fallback={<SheetScreen page="index"><DemoSheet page="index" query={{}} /></SheetScreen>}>
      <Body params={params} searchParams={searchParams} />
    </Suspense>
  );
}

async function Body({
  params,
  searchParams,
}: {
  params: Promise<{ page: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ page }, query] = await Promise.all([params, searchParams]);
  if (RESERVED.has(page) || !isSheetPage(page)) notFound();
  return <SheetBody page={page} query={queryFrom(query)} />;
}
