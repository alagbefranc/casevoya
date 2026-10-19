import type { SidebarPerson } from "@/components/sheet/designer/sidebar";

/**
 * A staff member as an `.av` person: their own photo when one is stored, otherwise their initials
 * in the same circle. Never a stock photo (the Designer's consultant photo would show a stranger's
 * face for every staff member).
 */
export function staffPerson(
  name: string,
  avatarUrl?: string | null,
): SidebarPerson {
  return { name, avatarUrl: avatarUrl || null };
}
