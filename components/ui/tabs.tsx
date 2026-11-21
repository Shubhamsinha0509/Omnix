"use client"

import { Tabs as TabsPrimitive } from "@base-ui/react/tabs"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "@/lib/utils"

/**
 * Tabs in the design's two shapes:
 * - `default` is the segmented control (`.seg`): muted track, the active tab a raised card.
 * - `icon` is the configuration drawer's tabs (`.tabs` / `.tab`): icon over a 12px label,
 *   the active icon indigo.
 */
function Tabs({
  className,
  orientation = "horizontal",
  ...props
}: TabsPrimitive.Root.Props) {
  return (
    <TabsPrimitive.Root
      data-slot="tabs"
      data-orientation={orientation}
      className={cn("group/tabs flex gap-2 data-horizontal:flex-col", className)}
      {...props}
    />
  )
}

const tabsListVariants = cva(
  "group/tabs-list flex gap-1 rounded-md bg-muted p-1 text-muted-foreground",
  {
    variants: {
      variant: {
        default: "w-fit max-w-full overflow-x-auto",
        icon: "w-full",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

function TabsList({
  className,
  variant = "default",
  ...props
}: TabsPrimitive.List.Props & VariantProps<typeof tabsListVariants>) {
  return (
    <TabsPrimitive.List
      data-slot="tabs-list"
      data-variant={variant}
      className={cn(tabsListVariants({ variant }), className)}
      {...props}
    />
  )
}

function TabsTrigger({ className, ...props }: TabsPrimitive.Tab.Props) {
  return (
    <TabsPrimitive.Tab
      data-slot="tabs-trigger"
      className={cn(
        "flex flex-1 cursor-pointer items-center justify-center rounded-sm font-medium whitespace-nowrap text-muted-foreground transition-colors duration-200 outline-none hover:text-foreground disabled:pointer-events-none disabled:opacity-50 data-active:bg-card data-active:text-foreground data-active:shadow-xs [&_svg]:pointer-events-none [&_svg]:shrink-0",
        "group-data-[variant=default]/tabs-list:px-3 group-data-[variant=default]/tabs-list:py-1.5 group-data-[variant=default]/tabs-list:[&_svg:not([class*='size-'])]:size-4",
        "group-data-[variant=icon]/tabs-list:flex-col group-data-[variant=icon]/tabs-list:gap-0.5 group-data-[variant=icon]/tabs-list:px-1 group-data-[variant=icon]/tabs-list:py-2 group-data-[variant=icon]/tabs-list:text-caption group-data-[variant=icon]/tabs-list:[&_svg:not([class*='size-'])]:size-4 group-data-[variant=icon]/tabs-list:data-active:[&_svg]:text-brand",
        className
      )}
      {...props}
    />
  )
}

function TabsContent({ className, ...props }: TabsPrimitive.Panel.Props) {
  return (
    <TabsPrimitive.Panel
      data-slot="tabs-content"
      className={cn("flex-1 outline-none", className)}
      {...props}
    />
  )
}

export { Tabs, TabsList, TabsTrigger, TabsContent, tabsListVariants }
