"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";

const CHIP = { ok: "ok", neutral: "neutral", warn: "warn", bad: "bad" } as const;

/**
 * The strips pattern's head: title and chip, the answer in a reserved two-line slot (R3), the evidence row (one
 * tap-height line, an optional link) and, only for stale or down, a why-line. A tick changes text, never height.
 */
export function PageHead({
  title,
  chip,
  answer,
  evidence,
  link,
  action,
  notice,
}: {
  title: string;
  chip: { tone: keyof typeof CHIP; label: string };
  answer: string;
  evidence: string;
  link?: { href: string; label: string } | null;
  /** Takes the link's slot (a button, not a link); when given, `link` is not drawn. */
  action?: ReactNode;
  notice?: string | null;
}) {
  return (
    <header className="st-head" data-feature="head">
      <div className="st-titlerow">
        <h1>{title}</h1>
        <Badge variant={CHIP[chip.tone]} data-feature="chip">
          {chip.label}
        </Badge>
      </div>
      <p className="st-answer" data-feature="answer" title={answer}>
        {answer}
      </p>
      <div className="st-evidence" data-feature="evidence">
        <span>{evidence}</span>
        {action ?? (link && (
          <Link href={link.href} className={buttonVariants({ variant: "outline", size: "sm" })}>
            {link.label}
          </Link>
        ))}
      </div>
      {notice && (
        <p className="st-notice" role="status" data-feature="notice">
          {notice}
        </p>
      )}
    </header>
  );
}
