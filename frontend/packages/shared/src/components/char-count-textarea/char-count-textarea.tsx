import { Textarea } from "@sico/ui";
import { cn } from "@sico/ui/lib/utils.ts";
import type {
  ChangeEventHandler,
  FocusEventHandler,
  ReactElement,
  Ref,
} from "react";

type CharCountTextareaProps = {
  // Hard character cap — enforced via native maxLength and shown as `n/max`.
  max: number;
  value: string;
  id?: string;
  name?: string;
  placeholder?: string;
  autoComplete?: string;
  className?: string;
  ariaInvalid?: boolean;
  ref?: Ref<HTMLTextAreaElement>;
  onChange?: ChangeEventHandler<HTMLTextAreaElement>;
  onBlur?: FocusEventHandler<HTMLTextAreaElement>;
};

/**
 * Textarea with an `n/max` counter pinned inside its bottom-right corner
 * (per design). A character cap (not word count) so the limit is meaningful
 * for CJK text. Wraps the shared `<Textarea>`; the wrapper is `relative` and
 * the textarea gets bottom padding so typed text never slides under the
 * counter. Props are wired explicitly (no spreading) per lint rules.
 */
export function CharCountTextarea({
  max,
  value,
  id,
  name,
  placeholder,
  autoComplete,
  className,
  ariaInvalid,
  ref,
  onChange,
  onBlur,
}: CharCountTextareaProps): ReactElement {
  const length = value.length;
  return (
    <div className="relative">
      <Textarea
        id={id}
        name={name}
        placeholder={placeholder}
        autoComplete={autoComplete}
        maxLength={max}
        aria-invalid={ariaInvalid ? true : undefined}
        value={value}
        ref={ref}
        onChange={onChange}
        onBlur={onBlur}
        className={cn("pb-7", className)}
      />
      <span
        aria-hidden="true"
        className={cn(
          "pointer-events-none absolute right-3 bottom-2 text-xs tabular-nums",
          length >= max
            ? "text-foreground-secondary font-medium"
            : "text-foreground-faint",
        )}
      >
        {length}/{max}
      </span>
    </div>
  );
}
