import * as React from "react";
import { cn } from "@/lib/utils";

// forwardRef on both controls isn't decorative — Field below (and any modal
// that wants to move initial focus onto its first field, e.g.
// create-container.tsx) needs a real DOM ref to land on.

export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  function Input({ className, ...props }, ref) {
    return (
      <input
        ref={ref}
        className={cn(
          "h-11 w-full rounded-md border border-line bg-bg px-2.5 text-base text-ink placeholder:text-ink-faint outline-none focus:border-accent/50 focus:ring-1 focus:ring-accent/30 font-mono md:h-8 md:text-sm",
          className,
        )}
        {...props}
      />
    );
  },
);

export const Select = React.forwardRef<HTMLSelectElement, React.SelectHTMLAttributes<HTMLSelectElement>>(
  function Select({ className, ...props }, ref) {
    return (
      <select
        ref={ref}
        className={cn(
          "h-11 w-full rounded-md border border-line bg-bg px-2 text-base text-ink outline-none focus:border-accent/50 cursor-pointer md:h-8 md:text-sm",
          className,
        )}
        {...props}
      />
    );
  },
);

export function Label({ className, ...props }: React.LabelHTMLAttributes<HTMLLabelElement>) {
  return <label className={cn("microlabel block mb-1", className)} {...props} />;
}

/**
 * Wires a Label to exactly one form control through a single `useId()` call,
 * so a call site can never hand-type two id strings that fail to match — the
 * id doesn't exist anywhere outside this component. Wrap a single
 * Input/Select (or anything else that spreads its props onto one native
 * control) instead of writing `htmlFor`/`id` by hand.
 *
 * `hint`/`error` are threaded onto the control via `aria-describedby` (both
 * ids, space-joined, when both are present) so a screen reader announces the
 * supporting copy as part of the field rather than as disconnected page
 * text, and `error` also flips `aria-invalid`. `required` renders the same
 * "*" convention already used by hand in a few call sites, now paired with
 * `aria-required` so it isn't a visual-only cue.
 */
export function Field({
  label,
  hint,
  error,
  required,
  action,
  describedBy: externalDescribedBy,
  className,
  labelClassName,
  children,
}: {
  label: React.ReactNode;
  hint?: React.ReactNode;
  error?: React.ReactNode;
  required?: boolean;
  /** Rendered inline with the label — e.g. a "Generate" button. */
  action?: React.ReactNode;
  /** id of an external hint/error element (owned by the caller, rendered
   *  outside this Field — e.g. a note shared by several fields) to fold
   *  into this field's own aria-describedby alongside `hint`/`error`. */
  describedBy?: string;
  className?: string;
  labelClassName?: string;
  children: React.ReactElement<{
    id?: string;
    "aria-describedby"?: string;
    "aria-invalid"?: boolean;
    "aria-required"?: boolean;
  }>;
}) {
  const id = React.useId();
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const describedBy = [hintId, errorId, externalDescribedBy].filter(Boolean).join(" ") || undefined;

  const labelNode = (
    <Label htmlFor={id} className={cn(action && "mb-0", labelClassName)}>
      {label}
      {required && <span className="text-warn"> *</span>}
    </Label>
  );

  return (
    <div className={className}>
      {action ? (
        <div className="flex items-center justify-between gap-2 mb-1">
          {labelNode}
          {action}
        </div>
      ) : (
        labelNode
      )}
      {React.cloneElement(children, {
        id,
        "aria-describedby": describedBy,
        "aria-invalid": error ? true : undefined,
        "aria-required": required || undefined,
      })}
      {error ? (
        <p id={errorId} className="mt-1 text-[0.7rem] text-warn/80">
          {error}
        </p>
      ) : (
        hint && (
          <p id={hintId} className="mt-1 text-[0.7rem] text-ink-dim">
            {hint}
          </p>
        )
      )}
    </div>
  );
}
