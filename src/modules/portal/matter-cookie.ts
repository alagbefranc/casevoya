/**
 * The cookie that keeps the client's current portal matter (set by RememberMatter, read by the
 * portal page). A plain module, not a "use client" one: a server component that imports a value
 * from a client module gets a client reference, not the string.
 */
export const PORTAL_MATTER_COOKIE = "cv_portal_matter";
