import { withAuth } from "next-auth/middleware";
import { NextResponse } from "next/server";

// NextAuth route protection proxy
// Intercepts requests to protected routes and automatically redirects unauthenticated users to /sign-in
export default withAuth(
  function middleware(req) {
    // Custom authorization logic (e.g. role checks, custom headers) can be added here
    return NextResponse.next();
  },
  {
    callbacks: {
      authorized: ({ token }) => !!token,
    },
    pages: {
      signIn: "/sign-in",
    },
    // Same secret as lib/auth.ts, and the same rule: no public fallback.
    secret: process.env.NEXTAUTH_SECRET,
  }
);

// Define which routes to protect/restrict from unauthorized users
export const config = {
  matcher: [
    "/workspace/:path*",
    "/admin/:path*",
    "/profile/:path*",
    "/settings/:path*",
  ],
};
