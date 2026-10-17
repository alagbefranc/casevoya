import type { Metadata } from "next";
import { Suspense } from "react";
import { SheetBody, queryFrom } from "@/components/sheet/body";
import { DemoSheet } from "@/components/sheet/demo";
import { SheetScreen } from "@/components/sheet/screen";

export const metadata: Metadata = {
  title: "Book · Casevoya",
  robots: { index: false, follow: false },
};

export default function BookPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  return (
    <Suspense fallback={<SheetScreen page="book" tone="public"><DemoSheet page="book" query={{}} /></SheetScreen>}>
      <Body searchParams={searchParams} />
    </Suspense>
  );
}

async function Body({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  return <SheetBody page="book" query={queryFrom(await searchParams)} />;
}
