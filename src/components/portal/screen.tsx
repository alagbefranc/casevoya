"use client";

import { useRef, type ReactNode } from "react";
import { usePortal } from "./use-portal";

export function PortalScreen({ page, children }: { page: string; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  usePortal(ref, page);
  return (
    <div ref={ref} className="shell-portal" data-page={page}>
      {children}
    </div>
  );
}
