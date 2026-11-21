import { Button as ButtonPrimitive } from "@base-ui/react/button"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "@/lib/utils"

/**
 * Buttons from the design (design/reference, `.btn`):
 * default = ink (`.bp`), outline (`.bs`), brand indigo (`.bb`), destructive outline
 * (`.bd`), ghost (`.bg` / `.ibtn`). Heights 40 / 36 (sm); icon buttons 40 / 32 / 44 (lg,
 * the mobile touch size). The focus ring comes from globals.css.
 */
const buttonVariants = cva(
  "group/button inline-flex shrink-0 cursor-pointer items-center justify-center gap-2 rounded-md border border-transparent bg-clip-padding text-body font-semibold whitespace-nowrap transition-[background-color,color,border-color,opacity] duration-150 outline-none select-none disabled:pointer-events-none disabled:opacity-50 aria-invalid:border-destructive [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground hover:bg-primary/85",
        outline:
          "border-input bg-card text-foreground shadow-xs hover:bg-muted aria-expanded:bg-muted",
        brand: "bg-brand-fill text-white hover:bg-brand-fill/90",
        secondary: "bg-muted text-foreground hover:bg-muted/70 aria-expanded:bg-muted/70",
        ghost:
          "text-muted-foreground hover:bg-muted hover:text-foreground aria-expanded:bg-muted aria-expanded:text-foreground",
        destructive:
          "border-destructive bg-transparent text-destructive hover:bg-destructive/10",
        link: "h-auto px-0 text-brand-text hover:underline",
      },
      size: {
        default: "h-10 px-4",
        sm: "h-9 px-3 font-medium",
        xs: "h-7 gap-1 rounded-sm px-2 text-caption [&_svg:not([class*='size-'])]:size-3.5",
        lg: "h-11 px-5",
        icon: "size-10 [&_svg:not([class*='size-'])]:size-[18px]",
        "icon-xs": "size-6 rounded-sm [&_svg:not([class*='size-'])]:size-3.5",
        "icon-sm": "size-8 [&_svg:not([class*='size-'])]:size-[18px]",
        "icon-lg": "size-11 [&_svg:not([class*='size-'])]:size-5",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

function Button({
  className,
  variant = "default",
  size = "default",
  ...props
}: ButtonPrimitive.Props & VariantProps<typeof buttonVariants>) {
  return (
    <ButtonPrimitive
      data-slot="button"
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  )
}

export { Button, buttonVariants }
