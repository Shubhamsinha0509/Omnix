"use client";

import { useEffect } from "react";
import { ThemeProvider as NextThemesProvider } from "next-themes";

/** Where Settings → Appearance → Reduce motion is kept (this browser only). */
export const REDUCE_MOTION_KEY = "omnix-reduce-motion";

/** Turns the reduce-motion class on <html> on or off and remembers the choice. */
export function setReduceMotion(on: boolean) {
  document.documentElement.classList.toggle("reduce-motion", on);
  try {
    localStorage.setItem(REDUCE_MOTION_KEY, on ? "1" : "0");
  } catch {
    // Storage blocked (private window): the choice lasts for this page only.
  }
}

/**
 * Light by default; dark or system when chosen. The choice is stored in localStorage ("theme") and applied as a
 * class on <html>, which is what the `.dark` tokens in globals.css key off. Also applies
 * the saved Reduce motion preference.
 */
export function ThemeProvider({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    try {
      if (localStorage.getItem(REDUCE_MOTION_KEY) === "1") {
        document.documentElement.classList.add("reduce-motion");
      }
    } catch {
      // Storage blocked: keep the default.
    }
  }, []);

  return (
    <NextThemesProvider attribute="class" defaultTheme="light" enableSystem disableTransitionOnChange>
      {children}
    </NextThemesProvider>
  );
}
