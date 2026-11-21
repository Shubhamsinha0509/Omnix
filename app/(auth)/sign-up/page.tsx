import { AuthCard } from "@/components/custom/auth/AuthCard";

type Props = { searchParams: Promise<{ callbackUrl?: string; error?: string }> };

/** Sign up: the sign-in card (02-auth) with its own heading and link, server-rendered. */
export default async function SignUpPage({ searchParams }: Props) {
  const { callbackUrl, error } = await searchParams;
  return <AuthCard mode="sign-up" callbackUrl={callbackUrl} error={error} />;
}
