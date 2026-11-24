"use client";

import { useSyncExternalStore } from "react";

/** The browser's hour, read only on the client (the server doesn't know the user's zone). */
const useHour = () =>
  useSyncExternalStore(
    () => () => {},
    () => new Date().getHours(),
    () => null,
  );

/** "Good evening, Shubham" (`.h0`) in the viewer's own time of day. */
export function Greeting({ firstName }: { firstName: string | null }) {
  const hour = useHour();
  const part =
    hour === null ? "Welcome back" : hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
  return (
    <h1 className="font-display text-[32px] leading-9 font-semibold tracking-[-0.02em] md:text-[40px] md:leading-[44px]">
      {firstName ? `${part}, ${firstName}` : part}
    </h1>
  );
}
