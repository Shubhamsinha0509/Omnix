import "./globals.css";
import type { Metadata } from "next";
import { Bricolage_Grotesque, Figtree, JetBrains_Mono } from "next/font/google";

import { AuthProvider } from "@/components/session-provider";
import { ThemeProvider } from "@/components/theme-provider";

export const metadata: Metadata = {
  title: "Omnix — AI agents that work for you",
  description:
    "Create AI agents, connect them to Gmail, Slack, Notion and Jira, and let them work on demand, on a schedule, or on their own virtual machine.",
};

// The names match the tokens in globals.css: --font-sans, --font-display, --font-mono.
const figtree = Figtree({ subsets: ["latin"], variable: "--font-figtree", display: "swap" });
const bricolage = Bricolage_Grotesque({
  subsets: ["latin"],
  variable: "--font-bricolage",
  display: "swap",
});
const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-jetbrains-mono",
  display: "swap",
});

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    // next-themes sets the class on <html> before React hydrates, hence the warning opt-out.
    <html
      lang="en"
      suppressHydrationWarning
      className={`${figtree.variable} ${bricolage.variable} ${jetbrainsMono.variable}`}
    >
      <body>
        <ThemeProvider>
          <AuthProvider>{children}</AuthProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
