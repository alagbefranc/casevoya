import { redirect } from "next/navigation";

/**
 * The root sends everyone into the app. /app sends a signed-out visitor to sign-in (the proxy
 * gates it) and a signed-in person to their own workspace, so there is no placeholder page here.
 */
export default function Home(): never {
  redirect("/app");
}
