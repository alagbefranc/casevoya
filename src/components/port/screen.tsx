"use client";

import { useRef, type ReactNode } from "react";
import { usePort } from "./use-port";
import { usePortActions } from "./wire";

export function PortScreen({
  page,
  variant,
  token,
  initialStep,
  children,
}: {
  page: string;
  variant: "au" | "wzb";
  token?: string;
  /** Server-chosen step. Wins over `?step=` so a loaded screen is not left blank. */
  initialStep?: number;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const onAction = usePortActions(page, token);
  usePort(ref, page, onAction, initialStep);
  return (
    <div
      ref={ref}
      className={variant === "au" ? "shell-au" : "shell-wzb"}
      data-page={page}
      data-initial-step={initialStep != null ? String(initialStep) : undefined}
    >
      {children}
    </div>
  );
}
