"use client"

import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "@/lib/utils"
import { Tabs as TabsPrimitive } from "radix-ui"

function Tabs({
  className,
  orientation = "horizontal",
  ...props
}: React.ComponentProps<typeof TabsPrimitive.Root>) {
  return (
    <TabsPrimitive.Root
      data-slot="tabs"
      data-orientation={orientation}
      orientation={orientation}
      className={cn(
        "group/tabs flex gap-2 data-[orientation=horizontal]:flex-col",
        className
      )}
      {...props}
    />
  )
}

/**
 * `line` (default): an underline tab strip. `segmented`: a filled track with a raised active tab.
 * Both use the LedQuill tokens; the arrow keys, Home and End move between tabs (Radix).
 */
const tabsListVariants = cva(
  "group/tabs-list inline-flex w-fit items-center text-ink-2 group-data-[orientation=vertical]/tabs:h-fit group-data-[orientation=vertical]/tabs:flex-col",
  {
    variants: {
      variant: {
        line: "w-full gap-1 border-b border-line bg-transparent",
        segmented: "gap-0.5 rounded-md border border-line bg-surface-2 p-0.5",
      },
    },
    defaultVariants: {
      variant: "line",
    },
  }
)

function TabsList({
  className,
  variant = "line",
  ...props
}: React.ComponentProps<typeof TabsPrimitive.List> &
  VariantProps<typeof tabsListVariants>) {
  return (
    <TabsPrimitive.List
      data-slot="tabs-list"
      data-variant={variant}
      className={cn(tabsListVariants({ variant }), className)}
      {...props}
    />
  )
}

/**
 * Selected = darker text plus an underline (line) or a raised surface (segmented). The weight is
 * the same in every state so neighbours never shift. The change is a 150 ms colour and transform
 * transition, switched off under prefers-reduced-motion.
 */
function TabsTrigger({
  className,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.Trigger>) {
  return (
    <TabsPrimitive.Trigger
      data-slot="tabs-trigger"
      className={cn(
        "relative inline-flex h-10 items-center justify-center gap-1.5 px-3 text-table font-medium whitespace-nowrap text-ink-2 outline-none",
        "transition-colors duration-150 motion-reduce:transition-none hover:text-ink",
        "focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-primary",
        "disabled:pointer-events-none disabled:opacity-50 data-[state=active]:text-ink",
        "[&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
        // line: a 2px primary bar that grows from the centre
        "group-data-[variant=line]/tabs-list:after:absolute group-data-[variant=line]/tabs-list:after:inset-x-0 group-data-[variant=line]/tabs-list:after:-bottom-px group-data-[variant=line]/tabs-list:after:h-0.5 group-data-[variant=line]/tabs-list:after:origin-center group-data-[variant=line]/tabs-list:after:scale-x-0 group-data-[variant=line]/tabs-list:after:bg-primary group-data-[variant=line]/tabs-list:after:transition-transform group-data-[variant=line]/tabs-list:after:duration-150 motion-reduce:group-data-[variant=line]/tabs-list:after:transition-none group-data-[variant=line]/tabs-list:data-[state=active]:after:scale-x-100",
        // segmented: raised active tab
        "group-data-[variant=segmented]/tabs-list:h-8 group-data-[variant=segmented]/tabs-list:rounded-[5px] group-data-[variant=segmented]/tabs-list:data-[state=active]:bg-surface group-data-[variant=segmented]/tabs-list:data-[state=active]:text-link group-data-[variant=segmented]/tabs-list:data-[state=active]:shadow-[0_0_0_1px_var(--line)]",
        className
      )}
      {...props}
    />
  )
}

function TabsContent({
  className,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.Content>) {
  return (
    <TabsPrimitive.Content
      data-slot="tabs-content"
      className={cn("flex-1 outline-none", className)}
      {...props}
    />
  )
}

export { Tabs, TabsList, TabsTrigger, TabsContent, tabsListVariants }
