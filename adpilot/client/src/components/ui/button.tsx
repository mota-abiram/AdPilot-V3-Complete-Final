import * as React from "react"
import { Slot } from "@radix-ui/react-slot"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

const buttonVariants = cva(
  // Base: accessible tap targets (min 36px, touch-action safe), smooth transitions,
  // proper focus ring for keyboard nav (WCAG 2.4.7)
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium " +
  "transition-colors duration-150 " +
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background " +
  "disabled:pointer-events-none disabled:opacity-50 " +
  "[&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0 " +
  "hover-elevate active-elevate-2",
  {
    variants: {
      variant: {
        default:
          "bg-primary text-primary-foreground border border-primary-border shadow-xs hover:shadow-sm",
        destructive:
          "bg-destructive text-destructive-foreground border border-destructive-border shadow-xs hover:shadow-sm",
        outline:
          "border [border-color:var(--button-outline)] shadow-xs active:shadow-none hover:bg-muted/50",
        secondary:
          "bg-secondary text-secondary-foreground border border-secondary-border hover:bg-secondary/80",
        ghost:
          "border border-transparent hover:bg-muted/60 hover:text-foreground",
        link:
          "border-none underline-offset-4 hover:underline text-primary p-0 h-auto",
      },
      size: {
        // min-h ensures content-driven height while maintaining tap target guidance
        default: "min-h-9 px-4 py-2",
        sm:      "min-h-8 rounded-md px-3 text-xs",
        lg:      "min-h-11 rounded-md px-6 text-base",   /* 44px — WCAG touch target */
        icon:    "h-9 w-9 shrink-0",
        "icon-sm": "h-7 w-7 shrink-0",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
)

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button"
    return (
      <Comp
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        {...props}
      />
    )
  },
)
Button.displayName = "Button"

export { Button, buttonVariants }
