import Image from "next/image";

/**
 * Shown the moment a page starts loading — e.g. right after "Launch App" — instead of
 * leaving the previous page on screen with no sign anything happened. Next.js streams
 * this in while the workspace and its data load behind it.
 */
export default function Loading() {
  return (
    <div className="flex min-h-svh items-center justify-center bg-background" role="status" aria-live="polite">
      <div className="flex flex-col items-center gap-4">
        <Image src="/logo.png" alt="" width={48} height={48} className="size-12 animate-pulse" loading="eager" />
        <p className="text-sm text-muted-foreground">Opening Omnix…</p>
      </div>
    </div>
  );
}
