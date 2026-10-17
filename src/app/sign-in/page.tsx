import type { Metadata } from "next";
import { SignInMarkup } from "@/components/port/markup/sign-in";
import { PortScreen } from "@/components/port/screen";

export const metadata: Metadata = {
  title: "Sign in · Casevoya",
  robots: { index: false, follow: false },
};

export default function SignInPage() {
  return (
    <PortScreen page="sign-in" variant="au">
      <SignInMarkup />
    </PortScreen>
  );
}
