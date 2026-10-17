"use client";

import { useRef, type ReactNode } from "react";
import { useSheet } from "./use-sheet";

export function SheetScreen({
  page,
  tone = "sheet",
  children,
}: {
  page: string;
  tone?: "sheet" | "public";
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useSheet(ref, page);
  return (
    <div ref={ref} className={tone === "public" ? "shell-public" : "shell-sheet"} data-page={page}>
      {children}
    </div>
  );
}
