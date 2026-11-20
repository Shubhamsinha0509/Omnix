import { AuthProvider } from "@/components/session-provider";
import "./globals.css";
import type { Metadata } from "next";
import { Figtree } from "next/font/google";

export const metadata: Metadata = {
  title: "Omnix — AI agents that work for you",
  description:
    "Create AI agents, connect them to Gmail, Slack, Notion and Jira, and let them work on demand, on a schedule, or on their own virtual machine.",
};

const figtree = Figtree({ subsets: ["latin"] });

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className={figtree.className} style={{ margin: 0, padding: 0 }}>
        <AuthProvider>{children}</AuthProvider>
      </body>
    </html>
  );
}
