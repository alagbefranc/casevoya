import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { SheetBody, isSheetPage, queryFrom } from "@/components/sheet/body";

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
  return <Body params={params} searchParams={searchParams} />;
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
