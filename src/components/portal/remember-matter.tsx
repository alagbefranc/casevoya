"use client";

import { useEffect } from "react";
import { PORTAL_MATTER_COOKIE } from "@/modules/portal/matter-cookie";

/**
 * Keeps the matter the client opened from My matters as their current one on every portal page,
 * so a matter another person updates later doesn't take its place. A preference only: the page
 * checks the id against the client's own matters each time.
 */
export function RememberMatter({ id }: { id: string }) {
  useEffect(() => {
    document.cookie = `${PORTAL_MATTER_COOKIE}=${encodeURIComponent(id)}; path=/portal; max-age=31536000; samesite=lax; secure`;
  }, [id]);
  return null;
}
