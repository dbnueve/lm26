import * as React from "react"
import { Slot } from "@radix-ui/react-slot"
import { cva } from "class-variance-authority"
import { cn } from "@/lib/utils"

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap text-sm font-medium transition-all duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-1 focus-visible:ring-offset-[var(--bg)] disabled:pointer-events-none disabled:opacity-40 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default:
          "bg-[var(--accent)] text-white shadow-[var(--shadow-accent)] hover:bg-[var(--accent-hover)] hover:-translate-y-px active:translate-y-0",
        destructive:
          "bg-[var(--danger-dim)] text-[var(--danger)] border border-[var(--danger-border)] hover:bg-[var(--danger)] hover:text-white",
        outline:
          "border border-[var(--border-strong)] bg-transparent text-[var(--text-3)] hover:bg-[var(--surface-2)] hover:text-[var(--text-1)]",
        secondary:
          "bg-[var(--surface-2)] text-[var(--text-3)] border border-[var(--border-strong)] hover:bg-[var(--surface-3)] hover:text-[var(--text-1)]",
        ghost:
          "bg-transparent text-[var(--text-2)] hover:bg-[var(--surface-2)] hover:text-[var(--text-1)]",
        amber:
          "bg-[var(--amber-dim)] text-[var(--amber)] border border-[var(--amber-border)] hover:bg-[var(--amber)] hover:text-white shadow-[var(--shadow-amber)]",
        success:
          "bg-[var(--success-dim)] text-[var(--success)] border border-[var(--success-border)] hover:bg-[var(--success)] hover:text-white",
        link:
          "text-[var(--accent)] underline-offset-4 hover:underline bg-transparent p-0 h-auto",
      },
      size: {
        default: "h-8 px-4 py-1.5 rounded-[var(--radius-sm)]",
        sm:      "h-7 px-3 text-xs rounded-[var(--radius-xs)]",
        lg:      "h-10 px-6 rounded-[var(--radius-sm)]",
        icon:    "h-8 w-8 rounded-[var(--radius-sm)]",
        "icon-sm": "h-7 w-7 rounded-[var(--radius-xs)]",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

const Button = React.forwardRef(({ className, variant, size, asChild = false, ...props }, ref) => {
  const Comp = asChild ? Slot : "button"
  return (
    <Comp
      className={cn(buttonVariants({ variant, size, className }))}
      ref={ref}
      {...props}
    />
  )
})
Button.displayName = "Button"

export { Button, buttonVariants }
