import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[0.65rem] font-mono font-medium border",
  {
    variants: {
      variant: {
        neutral: "border-line text-ink-dim",
        ok: "border-ok/30 text-ok bg-ok/5",
        warn: "border-warn/30 text-warn bg-warn/5",
        bad: "border-bad/30 text-bad bg-bad/5",
        accent: "border-accent/30 text-accent bg-accent/5",
        blue: "border-blue/30 text-blue bg-blue/5",
      },
    },
    defaultVariants: { variant: "neutral" },
  },
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {}

export function Badge({ className, variant, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />;
}

export function stateBadgeVariant(
  state: string,
  health: string | null,
): NonNullable<BadgeProps["variant"]> {
  if (health === "unhealthy") return "warn";
  if (state === "running") return "ok";
  if (state === "restarting") return "blue";
  if (state === "paused") return "warn";
  if (state === "dead") return "bad";
  return "neutral";
}
