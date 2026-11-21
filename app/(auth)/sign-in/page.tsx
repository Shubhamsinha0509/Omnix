import { AuthCard } from "@/components/custom/auth/AuthCard";

type Props = { searchParams: Promise<{ callbackUrl?: string; error?: string }> };

/**
 * Sign in (design/reference/02-auth.html). Rendered on the server with the query read
 * here, so the card is in the first HTML — not a blank page until JavaScript loads.
 */
export default async function SignInPage({ searchParams }: Props) {
  const { callbackUrl, error } = await searchParams;
  return <AuthCard mode="sign-in" callbackUrl={callbackUrl} error={error} />;
}
