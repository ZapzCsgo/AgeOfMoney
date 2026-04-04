import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "@/lib/utils"

const badgeVariants = cva(
  "inline-flex items-center rounded-sm border px-2 py-0.5 text-xs font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 tracking-wide uppercase font-cinzel",
  {
    variants: {
      variant: {
        default:
          "border-transparent bg-primary text-primary-foreground hover:bg-primary/80",
        secondary:
          "border-transparent bg-secondary text-secondary-foreground hover:bg-secondary/80",
        destructive:
          "border-transparent bg-destructive text-destructive-foreground hover:bg-destructive/80",
        outline: "text-foreground",
        gold: "border-aoe-gold bg-aoe-gold/10 text-aoe-gold-bright",
        live: "border-aoe-crimson bg-aoe-crimson/20 text-red-400 animate-pulse-live",
        upcoming: "border-aoe-border-gold bg-aoe-gold/10 text-aoe-gold",
        completed: "border-aoe-emerald bg-aoe-emerald/15 text-aoe-emerald-bright",
        "tier-s": "border-aoe-gold bg-aoe-gold/15 text-aoe-gold-bright",
        "tier-a": "border-[#aaa] bg-[#aaa]/10 text-[#d4d4d4]",
        "tier-b": "border-[#b46414] bg-[#b46414]/15 text-[#d4842a]",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return (
    <div className={cn(badgeVariants({ variant }), className)} {...props} />
  )
}

export { Badge, badgeVariants }
