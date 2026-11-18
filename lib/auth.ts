import type { AuthOptions } from "next-auth";
import { getServerSession } from "next-auth";
import GithubProvider from "next-auth/providers/github";
import GoogleProvider from "next-auth/providers/google";
import { eq } from "drizzle-orm";

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
            set: { name: user.name, image: user.image },
          });
      } catch (error) {
        // Don't block login if the database is unreachable — just log it.
        console.error("Failed to save user to database:", error);
      }
      return true;
    },
  },
  secret: process.env.NEXTAUTH_SECRET || "default-development-secret-change-in-env",
};

/**
 * The signed-in user's row from the database, or null if nobody is signed in.
 * Use this in server components and server actions.
 */
export async function getCurrentUser() {
  const session = await getServerSession(authOptions);
  const email = session?.user?.email;
  if (!email) return null;

  const [user] = await db.select().from(users).where(eq(users.email, email)).limit(1);
  return user ?? null;
}
