import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

const badgeVariants = cva(
  "whitespace-nowrap inline-flex items-center rounded-md border px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.06em] transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2" +
  " hover-elevate " ,
  {
    variants: {
      variant: {
        default:
          "border-primary/40 bg-primary/16 text-primary-foreground shadow-xs",
        secondary: "border-border/70 bg-secondary text-secondary-foreground shadow-xs",
        success: "border-emerald-500/22 bg-emerald-500/12 text-emerald-700 dark:text-emerald-300 shadow-xs",
        warning: "border-amber-500/24 bg-amber-500/14 text-amber-700 dark:text-amber-300 shadow-xs",
        info: "border-sky-500/20 bg-sky-500/12 text-sky-700 dark:text-sky-300 shadow-xs",
        destructive:
          "border-red-500/22 bg-red-500/12 text-red-700 dark:text-red-300 shadow-xs",

        outline: " border [border-color:var(--badge-outline)] bg-card shadow-xs",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  },
)

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return (
    <div className={cn(badgeVariants({ variant }), className)} {...props} />
  );
}

export { Badge, badgeVariants }
