import { cache } from "react";
import type { AuthOptions } from "next-auth";
import { getServerSession } from "next-auth";
import GithubProvider from "next-auth/providers/github";
import GoogleProvider from "next-auth/providers/google";
import { eq, sql } from "drizzle-orm";

import { db, users } from "@/db";

export const authOptions: AuthOptions = {
  providers: [
    GithubProvider({
      clientId: process.env.GITHUB_CLIENT_ID || "placeholder-id",
      clientSecret: process.env.GITHUB_CLIENT_SECRET || "placeholder-secret",
    }),
    GoogleProvider({
      clientId: process.env.GOOGLE_CLIENT_ID || "placeholder-id",
      clientSecret: process.env.GOOGLE_CLIENT_SECRET || "placeholder-secret",
    }),
  ],
  pages: {
    signIn: "/sign-in",
    newUser: "/sign-up",
  },
  session: {
    strategy: "jwt",
  },
  callbacks: {
    // Save (or refresh) the user in Neon every time they sign in.
    async signIn({ user }) {
      if (!user.email) return false;
      try {
        await db
          .insert(users)
          .values({ email: user.email, name: user.name, image: user.image })
          .onConflictDoUpdate({
            target: users.email,
            // Keep a name the user set in Settings; only fill it in when there is none.
            set: { name: sql`coalesce(${users.name}, excluded.name)`, image: user.image },
          });
        return true;
      } catch (error) {
        // Without a row the user can't own anything, so a session would only lead to
        // "not found" everywhere. Refuse the sign-in instead; NextAuth shows its error page.
        console.error("Failed to save user to database:", error);
        return false;
      }
    },
  },
  // No fallback: a default secret in the source would let anyone forge sessions.
  // NextAuth refuses to run in production without it, which is what we want.
  secret: process.env.NEXTAUTH_SECRET,
};

/**
 * The signed-in user's row from the database, or null if nobody is signed in.
 * Use this in server components and server actions.
 *
 * Wrapped in React's `cache()`, so within one page render the workspace layout and the
 * page share a single lookup instead of each paying a database round-trip — which, with
 * the database on another continent, is a noticeable part of every page load.
 * (Outside a render, e.g. in route handlers, `cache` simply calls through.)
 */
export const getCurrentUser = cache(async function getCurrentUser() {
  const session = await getServerSession(authOptions);
  const email = session?.user?.email;
  if (!email) return null;

  const [user] = await db.select().from(users).where(eq(users.email, email)).limit(1);
  if (user) return user;

  // A valid session without a row: issued before the row existed, or the row was
  // removed. Recreate it from the session rather than treating the user as signed out.
  const [created] = await db
    .insert(users)
    .values({ email, name: session.user?.name ?? null, image: session.user?.image ?? null })
    .onConflictDoUpdate({ target: users.email, set: { email } })
    .returning();
  return created ?? null;
});
