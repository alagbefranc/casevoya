import type { SidebarPerson } from "@/components/sheet/designer/sidebar";

/** The Designer's consultant photo, shown for firm staff until profile pictures can be uploaded. */
export const STAFF_AVATAR = "/assets/av-amara-consultant.png";

/** A staff member as an `.av` person. Clients keep their initials: a stock face would misidentify them. */
export function staffPerson(
  name: string,
  avatarUrl?: string | null,
): SidebarPerson {
  return { name, avatarUrl: avatarUrl || STAFF_AVATAR };
}
