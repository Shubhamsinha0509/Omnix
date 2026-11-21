import { cn } from "@/lib/utils";

/**
 * The soft indigo glow behind page headers (`.wash`): two radial washes, 560px tall,
 * starting 160px above the page. Decorative only.
 */
export function HeroWash({ className }: { className?: string }) {
  return (
    <div
      aria-hidden="true"
      className={cn("pointer-events-none absolute inset-x-0 -top-40 h-[560px]", className)}
      style={{
        background:
          "radial-gradient(45% 60% at 22% 40%, var(--wash-1), transparent 70%), radial-gradient(40% 55% at 82% 25%, var(--wash-2), transparent 70%)",
      }}
    />
  );
}

/** The page column (`.wrap`): 1008px (or narrower), 48px top, 24px gaps; tighter on phones. */
export function PageWrap({
  className,
  children,
  width = "default",
}: {
  className?: string;
  children: React.ReactNode;
  width?: "default" | "wide" | "narrow";
}) {
  return (
    <div
      className={cn(
        "relative mx-auto flex w-full flex-col gap-5 px-4 pt-6 pb-12 md:gap-6 md:px-6 md:pt-12 md:pb-16",
        width === "default" && "max-w-[1008px]",
        width === "wide" && "max-w-[1120px]",
        width === "narrow" && "max-w-3xl",
        className,
      )}
    >
      {children}
    </div>
  );
}
