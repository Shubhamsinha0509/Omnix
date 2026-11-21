import * as React from "react"
import { cn } from "@/lib/utils"

/** The design's text area (`.textarea`): 12px padding and radius, 128px tall to start. */
function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        "flex min-h-32 w-full rounded-md border border-input bg-card p-3 text-body text-foreground transition-colors outline-none placeholder:text-muted-foreground focus-visible:border-ring disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive",
        className
      )}
      {...props}
    />
  )
}

/**
 * A text area with the design's "0 / 1000" counter under it, right-aligned and announced
 * politely. The limit is `maxLength`, so the browser enforces it too.
 */
function TextareaWithCounter({
  value,
  maxLength,
  className,
  counterClassName,
  ...props
}: React.ComponentProps<"textarea"> & {
  value: string
  maxLength: number
  counterClassName?: string
}) {
  const counterId = React.useId()
  return (
    <div className="flex flex-col gap-1.5">
      <Textarea
        value={value}
        maxLength={maxLength}
        aria-describedby={counterId}
        className={className}
        {...props}
      />
      <span
        id={counterId}
        aria-live="polite"
        className={cn("text-right text-caption font-medium text-muted-foreground", counterClassName)}
      >
        {value.length} / {maxLength}
      </span>
    </div>
  )
}

export { Textarea, TextareaWithCounter }
