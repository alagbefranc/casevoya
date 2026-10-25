"use client";

import { useEffect } from "react";

/**
 * Opens a page dialog once when it is drawn for a specific record (?view=), e.g. a message
 * template opened from its row. Renders nothing. Keyed by the record so a different one reopens.
 */
export function OpenOnLoad({ id }: { id: string }) {
  useEffect(() => {
    const timer = window.setTimeout(() => {
      const dialog = document.getElementById(id);
      if (dialog instanceof HTMLDialogElement && !dialog.open && dialog.dataset.autoopen === "1") dialog.showModal();
    }, 50);
    return () => window.clearTimeout(timer);
  }, [id]);
  return null;
}
