/**
 * Copyright (c) 2026 Sico Authors
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in
 * all copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 */

import { cva, type VariantProps } from "class-variance-authority";
import {
  type ComponentProps,
  type ReactElement,
  type ReactNode,
  useMemo,
} from "react";

import { Label } from "./label";
import { cn } from "../../lib/utils";

/* ============================================================================
 * Field — shadcn base-nova restyle (no upstream drift), with documented SICO deletions.
 *
 * Composition contract (no Context, shadcn convention):
 *   - <Field> emits role="group" + data-orientation + optional data-invalid /
 *     data-disabled. CSS uses `group-data-[*]/field` selectors to drive
 *     descendant styling.
 *   - Children declare their own `htmlFor`/`id`/`aria-invalid`/`disabled`.
 *     Field never forwards state via props.
 *   - State stays in the DOM so any control (third-party or native) integrates
 *     without adapter code, and CSS-only theming keeps working.
 *
 * Deletions from upstream and the reason for each:
 *   - FieldTitle, FieldSeparator, FieldContent: no consumer in SICO yet
 *     (used by the horizontal "card" pattern that ships with Checkbox/Radio).
 *     Add them back when those PRs land.
 *   - FieldLabel `has-data-checked:*` card-mode classes: same reason. Also,
 *     SICO `--color-primary` resolves to `neutral-800` (dark fill) — a 1:1
 *     copy would render the card in gray, not brand purple. Re-introduce
 *     with explicit brand tokens (`bg-primary-50` / `border-primary-200`)
 *     when Checkbox lands.
 *   - All `dark:` variants: SICO has no dark theme yet.
 *   - FieldDescription `[&>a]:text-primary`: would also fall back to dark
 *     gray. Consumers should style links explicitly until a link token
 *     exists.
 * ============================================================================ */

/* ─── FieldSet ──────────────────────────────────────────────── */

function FieldSet({
  className,
  ...props
}: ComponentProps<"fieldset">): ReactElement {
  return (
    <fieldset
      data-slot="field-set"
      className={cn(
        "flex flex-col gap-4",
        // Checkbox/Radio groups want tighter spacing than free-form fields.
        "has-[>[data-slot=checkbox-group]]:gap-3 has-[>[data-slot=radio-group]]:gap-3",
        className,
      )}
      {...props}
    />
  );
}

/* ─── FieldLegend ───────────────────────────────────────────── */

type FieldLegendVariant = "legend" | "label";

type FieldLegendProps = ComponentProps<"legend"> & {
  variant?: FieldLegendVariant;
};

function FieldLegend({
  className,
  variant = "legend",
  ...props
}: FieldLegendProps): ReactElement {
  return (
    <legend
      data-slot="field-legend"
      data-variant={variant}
      className={cn(
        "mb-1.5 font-medium",
        "data-[variant=label]:text-sm data-[variant=legend]:text-base",
        className,
      )}
      {...props}
    />
  );
}

/* ─── FieldGroup ────────────────────────────────────────────── */

function FieldGroup({
  className,
  ...props
}: ComponentProps<"div">): ReactElement {
  return (
    <div
      data-slot="field-group"
      className={cn(
        // `@container/field-group` enables the `responsive` Field orientation
        // (collapses to column below the @md breakpoint).
        "group/field-group @container/field-group flex w-full flex-col gap-5",
        "data-[slot=checkbox-group]:gap-3 *:data-[slot=field-group]:gap-4",
        className,
      )}
      {...props}
    />
  );
}

/* ─── Field ─────────────────────────────────────────────────── */

const fieldVariants = cva(
  // Inherits dim and error color from `<Field data-disabled>` /
  // `<Field data-invalid>` ancestor selectors so descendants (Label,
  // Description, Error) react without prop wiring — matches upstream.
  "group/field flex w-full gap-2 data-[invalid=true]:text-danger-700",
  {
    variants: {
      orientation: {
        vertical: "flex-col *:w-full [&>.sr-only]:w-auto",
        horizontal: cn(
          "flex-row items-center",
          // When a FieldContent stacks Label+Description vertically inside a
          // horizontal field, top-align so the control lines up with the label.
          "has-[>[data-slot=field-content]]:items-start",
          "*:data-[slot=field-label]:flex-auto",
          // Visually align checkbox/radio with the first line of multi-line
          // label text by nudging the control down 1px.
          "has-[>[data-slot=field-content]]:[&>[role=checkbox],[role=radio]]:mt-px",
        ),
        responsive: cn(
          "flex-col *:w-full",
          "@md/field-group:flex-row @md/field-group:items-center @md/field-group:*:w-auto",
          "@md/field-group:has-[>[data-slot=field-content]]:items-start",
          "@md/field-group:*:data-[slot=field-label]:flex-auto",
          "[&>.sr-only]:w-auto",
          "@md/field-group:has-[>[data-slot=field-content]]:[&>[role=checkbox],[role=radio]]:mt-px",
        ),
      },
    },
    defaultVariants: {
      orientation: "vertical",
    },
  },
);

type FieldProps = ComponentProps<"div"> & VariantProps<typeof fieldVariants>;

function Field({
  className,
  orientation = "vertical",
  ...props
}: FieldProps): ReactElement {
  return (
    <div
      role="group"
      data-slot="field"
      data-orientation={orientation}
      className={cn(fieldVariants({ orientation }), className)}
      {...props}
    />
  );
}

/* ─── FieldLabel ────────────────────────────────────────────── */

function FieldLabel({
  className,
  ...props
}: ComponentProps<typeof Label>): ReactElement {
  return (
    <Label
      data-slot="field-label"
      className={cn(
        "group/field-label peer/field-label flex w-fit gap-2 leading-snug",
        // Inherits dim when an ancestor <Field data-disabled> is set.
        "group-data-[disabled=true]/field:opacity-50",
        // Nested-Field "card mode" intentionally omitted — see header comment.
        className,
      )}
      {...props}
    />
  );
}

/* ─── FieldDescription ──────────────────────────────────────── */

function FieldDescription({
  className,
  ...props
}: ComponentProps<"p">): ReactElement {
  return (
    <p
      data-slot="field-description"
      className={cn(
        "text-foreground-tertiary text-left text-sm leading-normal font-normal",
        // Horizontal-field descriptions look better with balanced wrapping.
        "group-has-data-horizontal/field:text-balance",
        // Tighten when this description follows a `<legend variant=legend>`.
        "[[data-variant=legend]+&]:-mt-1.5",
        "last:mt-0 nth-last-2:-mt-1",
        // Link underline only — color override omitted (no link token, see header).
        "[&>a]:underline [&>a]:underline-offset-4",
        className,
      )}
      {...props}
    />
  );
}

/* ─── FieldError ────────────────────────────────────────────── */

type FieldErrorItem = { message?: string } | undefined;

type FieldErrorProps = ComponentProps<"div"> & {
  errors?: readonly FieldErrorItem[];
};

function FieldError({
  className,
  children,
  errors,
  ...props
}: FieldErrorProps): ReactElement | null {
  const content = useMemo<ReactNode>(() => {
    if (children !== undefined && children !== null && children !== false) {
      return children;
    }

    if (!errors?.length) {
      return null;
    }

    // De-duplicate by message so identical validators don't repeat.
    const uniqueErrors = [
      ...new Map(errors.map((error) => [error?.message, error])).values(),
    ];

    if (uniqueErrors.length === 1) {
      return uniqueErrors[0]?.message ?? null;
    }

    return (
      <ul className="ml-4 flex list-disc flex-col gap-1">
        {uniqueErrors.map((error, index) =>
          error?.message !== undefined && error.message !== "" ? (
            // eslint-disable-next-line react/no-array-index-key -- dedup'd list, index stable within render
            <li key={index}>{error.message}</li>
          ) : null,
        )}
      </ul>
    );
  }, [children, errors]);

  if (content === null) {
    return null;
  }

  return (
    <div
      role="alert"
      data-slot="field-error"
      className={cn("text-danger-700 text-sm font-normal", className)}
      {...props}
    >
      {content}
    </div>
  );
}

export {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSet,
  fieldVariants,
  type FieldErrorProps,
  type FieldLegendProps,
  type FieldProps,
};
