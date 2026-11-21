"use client";

import { ThemeProvider as NextThemesProvider } from "next-themes";

/**
 * Light, dark or system. The choice is stored in localStorage ("theme") and applied as a
 * class on <html>, which is what the `.dark` tokens in globals.css key off.
 */
export function ThemeProvider({ children }: { children: React.ReactNode }) {
  return (
    <NextThemesProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
      {children}
    </NextThemesProvider>
  );
}
