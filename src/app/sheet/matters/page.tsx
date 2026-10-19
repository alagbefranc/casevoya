import type { Metadata } from "next";
import { SheetBody, queryFrom } from "@/components/sheet/body";

export const metadata: Metadata = {
  title: "Matters · Casevoya",
  robots: { index: false, follow: false },
};

export default function MattersPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  return <Body searchParams={searchParams} />;
}

async function Body({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  return <SheetBody page="matters" query={queryFrom(await searchParams)} />;
}
