import { Suspense } from "react";

import { AuthCard } from "@/components/custom/auth/AuthCard";

/** Sign in (design/reference/02-auth.html). */
export default function SignInPage() {
  // useSearchParams (callbackUrl, error) needs a Suspense boundary.
  return (
    <Suspense>
      <AuthCard mode="sign-in" />
    </Suspense>
  );
}
