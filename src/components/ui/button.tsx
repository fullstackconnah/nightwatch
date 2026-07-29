import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-md text-sm font-medium transition disabled:pointer-events-none disabled:opacity-40 outline-none focus-visible:ring-1 focus-visible:ring-accent cursor-pointer active:scale-[0.98]",
  {
    variants: {
      variant: {
        default: "bg-accent/10 text-accent border border-accent/30 hover:bg-accent/20",
        outline: "border border-line text-ink-dim hover:text-ink hover:border-line-bright bg-transparent",
        ghost: "text-ink-dim hover:text-ink hover:bg-panel-2",
        danger: "bg-bad/10 text-bad border border-bad/30 hover:bg-bad/20",
        warn: "bg-warn/10 text-warn border border-warn/30 hover:bg-warn/20",
      },
      size: {
        default: "h-10 px-4 text-sm md:h-8 md:px-3 md:text-xs",
        sm: "h-9 px-3 text-xs md:h-7 md:px-2",
        lg: "h-11 px-5 text-sm md:h-9 md:px-4 md:text-sm",
        icon: "h-10 w-10 md:h-8 md:w-8",
      },
    },
    defaultVariants: { variant: "default", size: "default" },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {}

export function Button({ className, variant, size, ...props }: ButtonProps) {
  return <button className={cn(buttonVariants({ variant, size }), className)} {...props} />;
}
