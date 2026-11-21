"use client";

import { useSyncExternalStore } from "react";

import { agentAvatarUrl } from "@/lib/avatars";
import { cn } from "@/lib/utils";

export { AVATAR_SEED_PATTERN, agentAvatarUrl, randomAvatarSeed } from "@/lib/avatars";

/**
 * Agent avatars: DiceBear's animated "clay" characters (jiggle, peek, squash), seeded by
 * `agents.avatar_seed`, so the same agent always looks the same. They sit on the
 * redesign's four pastel circles (the colours of design/assets/avatars/blob-*.svg); the
 * blob SVGs were stand-ins "to swap for your production art", and these are it.
 *
 * Motion: the SVG only animates when the OS allows motion, and this also asks for the
 * still version when Settings → Appearance → Reduce motion is on (a class on <html>).
 */

function subscribe(onChange: () => void) {
  const query = window.matchMedia("(prefers-reduced-motion: reduce)");
  query.addEventListener("change", onChange);
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
  return () => {
    query.removeEventListener("change", onChange);
    observer.disconnect();
  };
}

/** True when either the OS or Omnix's own setting asks for less motion. */
function useReducedMotion() {
  return useSyncExternalStore(
    subscribe,
    () =>
      window.matchMedia("(prefers-reduced-motion: reduce)").matches ||
      document.documentElement.classList.contains("reduce-motion"),
    () => false,
  );
}

export function AgentAvatar({
  seed,
  name,
  className,
}: {
  seed: string;
  name: string;
  className?: string;
}) {
  const still = useReducedMotion();
  return (
    // A plain <img>: DiceBear returns SVG, which next/image wouldn't optimise.
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={agentAvatarUrl(seed, { animated: !still })}
      alt={name ? `${name} avatar` : ""}
      draggable={false}
      className={cn("block size-full shrink-0 rounded-full bg-muted object-cover", className)}
    />
  );
}
