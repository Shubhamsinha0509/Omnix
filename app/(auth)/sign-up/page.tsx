import { Suspense } from "react";

import { AuthCard } from "@/components/custom/auth/AuthCard";

/** Sign up: the sign-in card (02-auth) with its own heading and link. */
export default function SignUpPage() {
  // useSearchParams (callbackUrl, error) needs a Suspense boundary.
  return (
    <Suspense>
      <AuthCard mode="sign-up" />
    </Suspense>
  );
}
