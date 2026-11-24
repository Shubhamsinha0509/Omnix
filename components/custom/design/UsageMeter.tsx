import { cn } from "@/lib/utils";

/** A usage bar (`.meter`): 8px track, indigo fill. Reported to assistive tech as a meter. */
export function UsageMeter({
  value,
  label,
  className,
}: {
  /** 0–100 */
  value: number;
  label: string;
  className?: string;
}) {
  const clamped = Math.max(0, Math.min(100, value));
  return (
    <div
      role="meter"
      aria-label={label}
      aria-valuenow={Math.round(clamped)}
      aria-valuemin={0}
      aria-valuemax={100}
      className={cn("h-2 overflow-hidden rounded-full bg-muted", className)}
    >
      <span className="block h-full rounded-full bg-brand-fill" style={{ width: `${clamped}%` }} />
    </div>
  );
}
