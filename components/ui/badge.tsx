import { mergeProps } from "@base-ui/react/merge-props"
import { useRender } from "@base-ui/react/use-render"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "@/lib/utils"

/**
 * Badges from the design (`.badge`): 12px medium text in a pill. The status variants
 * (`ok`, `run`, `pause`, …) match `.b-ok`, `.b-run`, `.b-pause`, `.b-warn`, `.b-neutral`
 * and `.b-err`; ok and pause are text-only with a leading dot (see StatusBadge).
 */
const badgeVariants = cva(
  "group/badge inline-flex w-fit shrink-0 items-center gap-1.5 overflow-hidden rounded-full border border-transparent px-2 py-0.5 text-caption font-medium whitespace-nowrap [&>svg]:pointer-events-none [&>svg]:size-3.5",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground",
        neutral: "bg-muted text-muted-foreground",
        secondary: "bg-muted text-muted-foreground",
        run: "bg-accent text-accent-foreground",
        ok: "pl-0 text-success-text",
        pause: "pl-0 text-warning-text",
        warn: "bg-warning-subtle text-warning-text",
        err: "bg-destructive/10 text-destructive",
        destructive: "bg-destructive/10 text-destructive",
        outline: "border-input text-muted-foreground",
        ghost: "text-muted-foreground",
        link: "px-0 text-brand-text hover:underline",
      },
    },
    defaultVariants: {
      variant: "neutral",
    },
  }
)

function Badge({
  className,
  variant = "neutral",
  render,
  ...props
}: useRender.ComponentProps<"span"> & VariantProps<typeof badgeVariants>) {
  return useRender({
    defaultTagName: "span",
    props: mergeProps<"span">(
      {
        className: cn(badgeVariants({ variant }), className),
      },
      props
    ),
    render,
    state: {
      slot: "badge",
      variant,
    },
  })
}

export { Badge, badgeVariants }
