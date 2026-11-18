import NextAuth, { AuthOptions } from "next-auth";
import GithubProvider from "next-auth/providers/github";
import GoogleProvider from "next-auth/providers/google";
import { db, users } from "@/db";

export const authOptions: AuthOptions = {
  providers: [
    GithubProvider({
      clientId: process.env.GITHUB_CLIENT_ID || 'placeholder-id',
      clientSecret: process.env.GITHUB_CLIENT_SECRET || 'placeholder-secret',
    }),
    GoogleProvider({
      clientId: process.env.GOOGLE_CLIENT_ID || 'placeholder-id',
      clientSecret: process.env.GOOGLE_CLIENT_SECRET || 'placeholder-secret',
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

const handler = NextAuth(authOptions);

export { handler as GET, handler as POST };
