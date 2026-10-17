"use client";

import { useRef, type ReactNode } from "react";
import { usePort } from "./use-port";
import { usePortActions } from "./wire";

export function PortScreen({
  page,
  variant,
  token,
  children,
}: {
  page: string;
  variant: "au" | "wzb";
  token?: string;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const onAction = usePortActions(page, token);
  usePort(ref, page, onAction);
  return (
    <div ref={ref} className={variant === "au" ? "shell-au" : "shell-wzb"} data-page={page}>
      {children}
    </div>
  );
}
