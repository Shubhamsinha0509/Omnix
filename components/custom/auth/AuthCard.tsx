"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { signIn } from "next-auth/react";
import { Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { HeroWash } from "@/components/custom/design/HeroWash";
import { AgentAvatar } from "@/components/custom/workspace/AgentAvatar";
import { ThemeToggle } from "@/components/custom/shell/ThemeToggle";

const OAUTH_ERRORS: Record<string, string> = {
  OAuthSignin: "Couldn't start signing in with that provider. Please try again.",
  OAuthCallback: "That provider didn't complete the sign-in. Please try again.",
  OAuthAccountNotLinked: "That email is already used with a different sign-in method.",
  AccessDenied: "Sign-in was refused. If this keeps happening, the account couldn't be saved.",
};

function GoogleMark() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M21.6 12.2c0-.7-.1-1.4-.2-2H12v3.8h5.4a4.6 4.6 0 0 1-2 3v2.5h3.2c1.9-1.7 3-4.3 3-7.3z" fill="#4285F4" />
      <path d="M12 22c2.7 0 5-.9 6.6-2.4l-3.2-2.5c-.9.6-2 1-3.4 1-2.6 0-4.8-1.8-5.6-4.1H3.1v2.6A10 10 0 0 0 12 22z" fill="#34A853" />
      <path d="M6.4 14c-.2-.6-.3-1.3-.3-2s.1-1.4.3-2V7.4H3.1a10 10 0 0 0 0 9.2z" fill="#FBBC05" />
      <path d="M12 5.9c1.5 0 2.8.5 3.8 1.5l2.9-2.9A10 10 0 0 0 3.1 7.4L6.4 10c.8-2.3 3-4.1 5.6-4.1z" fill="#EA4335" />
    </svg>
  );
}

function GitHubMark() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.53 1.032 1.53 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z"
      />
    </svg>
  );
}

/**
 * Sign in and sign up (design/reference/02-auth.html). Google and GitHub are the real
 * NextAuth providers; email sign-in has no provider yet, so the form says so.
 */
export function AuthCard({
  mode,
  callbackUrl: requested,
  error: urlError,
}: {
  mode: "sign-in" | "sign-up";
  callbackUrl?: string;
  error?: string;
}) {
  // Only paths on this site: an absolute URL here would send people elsewhere after sign-in.
  const callbackUrl = requested && requested.startsWith("/") && !requested.startsWith("//") ? requested : "/workspace";
  const [loading, setLoading] = useState<"google" | "github" | null>(null);
  const [email, setEmail] = useState("");
  const [notice, setNotice] = useState<string | null>(
    urlError ? (OAUTH_ERRORS[urlError] ?? "Sign-in didn't complete. Please try again.") : null,
  );

  const oauth = (provider: "google" | "github") => {
    setLoading(provider);
    setNotice(null);
    void signIn(provider, { callbackUrl });
  };

  // TODO(backend): an email (magic link) provider.
  const withEmail = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setNotice("Email sign-in isn’t available yet. Continue with Google or GitHub.");
  };

  return (
    <div className="relative flex min-h-svh items-center justify-center overflow-hidden p-6">
      <HeroWash className="top-0 h-full" />
      <ThemeToggle className="absolute top-4 right-4" />
      <main className="relative flex w-full max-w-[440px] flex-col gap-6 rounded-2xl border bg-card px-8 py-10 shadow-lg">
        <div className="flex flex-col items-center gap-4 text-center">
          <div className="flex">
            {["green", "peach", "purple"].map((seed, index) => (
              <span key={seed} className={index ? "-ml-2.5 size-12" : "size-12"}>
                <AgentAvatar seed={seed} name="" />
              </span>
            ))}
          </div>
          <h1 className="font-display text-[32px] leading-9 font-semibold tracking-[-0.02em]">
            {mode === "sign-in" ? "Welcome to Omnix" : "Create your account"}
          </h1>
          <p className="text-muted-foreground">
            {mode === "sign-in"
              ? "Sign in to create, connect and run your agents."
              : "Sign up to create, connect and run your agents."}
          </p>
        </div>

        {notice && (
          <p role="alert" className="rounded-md bg-warning-subtle px-3 py-2 text-body-s text-warning-text">
            {notice}
          </p>
        )}

        <div className="flex flex-col gap-3">
          <Button variant="outline" className="h-12 w-full" disabled={loading !== null} onClick={() => oauth("google")}>
            {loading === "google" ? <Loader2 className="animate-spin" /> : <GoogleMark />}
            Continue with Google
          </Button>
          <Button variant="outline" className="h-12 w-full" disabled={loading !== null} onClick={() => oauth("github")}>
            {loading === "github" ? <Loader2 className="animate-spin" /> : <GitHubMark />}
            Continue with GitHub
          </Button>
        </div>

        <div className="flex items-center gap-3">
          <span className="h-px flex-1 bg-border" />
          <span className="text-caption font-medium text-muted-foreground">or</span>
          <span className="h-px flex-1 bg-border" />
        </div>

        <form onSubmit={withEmail} className="flex flex-col gap-3">
          <label className="flex flex-col gap-1.5">
            <span className="font-medium">Email</span>
            <Input
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="you@example.com"
              autoComplete="email"
            />
          </label>
          <Button type="submit" className="h-12 w-full">
            Continue with email
          </Button>
        </form>

        <p className="text-center text-body-s text-muted-foreground">
          {mode === "sign-in" ? (
            <>
              Don&apos;t have an account?{" "}
              <Link href="/sign-up" className="text-brand-text hover:underline">
                Sign up
              </Link>
            </>
          ) : (
            <>
              Already have an account?{" "}
              <Link href="/sign-in" className="text-brand-text hover:underline">
                Sign in
              </Link>
            </>
          )}
        </p>
      </main>
    </div>
  );
}
