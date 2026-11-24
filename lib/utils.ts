import { type ClassValue, clsx } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

/**
 * tailwind-merge has to know the design's own type scale (globals.css `--text-*`), or it
 * reads `text-body-s` as a colour and drops it whenever a `text-muted-foreground` follows.
 */
const twMerge = extendTailwindMerge({
  extend: {
    theme: {
      text: ["display-xl", "display-l", "h1", "h2", "h3", "body-l", "body", "body-s", "caption"],
    },
  },
});

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
