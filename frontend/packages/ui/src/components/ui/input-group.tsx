import { cva, type VariantProps } from "class-variance-authority";
import type { ComponentProps, ReactElement } from "react";

import { Button } from "./button";
import { Input } from "./input";
import { Textarea } from "./textarea";
import { cn } from "../../lib/utils";

/* ============================================================================
 * InputGroup — shadcn base-nova restyle (no upstream drift), with documented SICO deletions.
 *
 * Composition contract (no Context, shadcn convention):
 *   - <InputGroup> is the shell: border, bg, focus-visible border + shadow,
 *     data-invalid bg + border. It does not own input state.
 *   - Children declare role via `data-slot`:
 *       * `[data-slot=input-group-control]` drives focus-visible styling on the shell.
 *       * `[data-slot=…][aria-invalid=true]` drives the invalid bg + border on the shell.
 *   - <InputGroupAddon align="…"> positions affixes via `data-align`. The
 *     shell uses :has() selectors to adjust its own layout and the control's
 *     padding accordingly.
 *
 * Deletions from upstream and the reason for each:
 *   - `[&>kbd]:rounded-[calc(var(--radius)-5px)]` and the matching radius math
 *     in InputGroupButton: SICO has no `--radius` token and no keyboard
 *     shortcut UI yet. Use `rounded-md` directly.
 *   - `in-data-[slot=combobox-content]:*`: Combobox not yet in SICO.
 *   - All `dark:` variants: SICO has no dark theme.
 * ============================================================================ */

/* ─── InputGroup (shell) ────────────────────────────────────── */

function InputGroup({
  className,
  ...props
}: ComponentProps<"div">): ReactElement {
  return (
    <div
      data-slot="input-group"
      role="group"
      className={cn(
        "group/input-group border-input-stroke-rest relative flex h-8 w-full min-w-0 items-center rounded-lg border transition-colors outline-none",
        // Any disabled descendant dims the whole shell.
        "has-disabled:bg-surface-canvas has-disabled:text-foreground-faint has-disabled:border-transparent",
        // Focus follows the control element — border darkens + shadow, no ring.
        // Use :focus-visible so the indicator only shows for keyboard focus.
        "has-[[data-slot=input-group-control]:focus-visible]:border-input-stroke-pressed",
        "has-[[data-slot=input-group-control]:focus-visible]:shadow-s",
        // Hover border.
        "hover:border-input-stroke-hover",
        // Invalid — fill + border, no ring.
        "has-[[data-slot][aria-invalid=true]]:bg-input-fill-error",
        "has-[[data-slot][aria-invalid=true]]:border-input-stroke-error",
        // Textarea or block-aligned addon switches the shell to vertical.
        "has-[>[data-align=block-end]]:h-auto has-[>[data-align=block-end]]:flex-col",
        "has-[>[data-align=block-start]]:h-auto has-[>[data-align=block-start]]:flex-col",
        "has-[>textarea]:h-auto",
        // Pad the input to make room for block addons / inline addons.
        "has-[>[data-align=block-end]]:[&>input]:pt-3",
        "has-[>[data-align=block-start]]:[&>input]:pb-3",
        "has-[>[data-align=inline-end]]:[&>input]:pr-1.5",
        "has-[>[data-align=inline-start]]:[&>input]:pl-1.5",
        className,
      )}
      {...props}
    />
  );
}

/* ─── InputGroupAddon ───────────────────────────────────────── */

const inputGroupAddonVariants = cva(
  cn(
    "flex h-auto cursor-text items-center justify-center gap-2 py-1.5 text-sm font-medium select-none",
    "text-foreground-tertiary",
    // Field-level disabled propagates to the addon.
    "group-data-[disabled=true]/input-group:opacity-50",
    // Default icon size — addon SVGs without an explicit size get 16px.
    "[&>svg:not([class*='size-'])]:size-4",
  ),
  {
    variants: {
      align: {
        // Slight negative margin pulls inline buttons/kbd flush with the edge.
        "inline-start":
          "order-first pl-2 has-[>button]:ml-[-0.3rem] has-[>kbd]:ml-[-0.15rem]",
        "inline-end":
          "order-last pr-2 has-[>button]:mr-[-0.3rem] has-[>kbd]:mr-[-0.15rem]",
        // Block variants stack above/below the control for textarea layouts.
        "block-start":
          "order-first w-full justify-start px-2.5 pt-2 group-has-[>input]/input-group:pt-2 [.border-b]:pb-2",
        "block-end":
          "order-last w-full justify-start px-2.5 pb-2 group-has-[>input]/input-group:pb-2 [.border-t]:pt-2",
      },
    },
    defaultVariants: {
      align: "inline-start",
    },
  },
);

type InputGroupAddonProps = ComponentProps<"div"> &
  VariantProps<typeof inputGroupAddonVariants>;

function InputGroupAddon({
  className,
  align = "inline-start",
  ...props
}: InputGroupAddonProps): ReactElement {
  return (
    <div
      role="group"
      data-slot="input-group-addon"
      data-align={align}
      className={cn(inputGroupAddonVariants({ align }), className)}
      {...props}
    />
  );
}

/* ─── InputGroupButton ──────────────────────────────────────── */

const inputGroupButtonVariants = cva(
  "flex items-center gap-2 text-sm shadow-none",
  {
    variants: {
      size: {
        // SICO has no --radius token; use `rounded-md` directly (6px in Tailwind v4)
        // — close to shadcn's `calc(var(--radius)-3px)` which resolves to ~5px upstream.
        xs: "h-6 gap-1 rounded-md px-1.5 [&>svg:not([class*='size-'])]:size-3.5",
        sm: "",
        "icon-xs": "size-6 rounded-md p-0 has-[>svg]:p-0",
        "icon-sm": "size-8 p-0 has-[>svg]:p-0",
      },
    },
    defaultVariants: {
      size: "xs",
    },
  },
);

type InputGroupButtonProps = Omit<
  ComponentProps<typeof Button>,
  "size" | "type"
> &
  VariantProps<typeof inputGroupButtonVariants> & {
    type?: "button" | "submit" | "reset";
  };

function InputGroupButton({
  className,
  type = "button",
  // shadcn defaults to `ghost`; SICO's closest equivalent is `subtle`
  // (transparent rest, gray hover, no border).
  variant = "subtle",
  size = "xs",
  ...props
}: InputGroupButtonProps): ReactElement {
  return (
    <Button
      type={type}
      data-size={size}
      variant={variant}
      className={cn(inputGroupButtonVariants({ size }), className)}
      {...props}
    />
  );
}

/* ─── InputGroupText ────────────────────────────────────────── */

function InputGroupText({
  className,
  ...props
}: ComponentProps<"span">): ReactElement {
  return (
    <span
      className={cn(
        "text-foreground-tertiary flex items-center gap-2 text-sm",
        "[&_svg]:pointer-events-none [&_svg:not([class*='size-'])]:size-4",
        className,
      )}
      {...props}
    />
  );
}

/* ─── InputGroupInput / InputGroupTextarea ──────────────────── */

function InputGroupInput({
  className,
  ...props
}: ComponentProps<"input">): ReactElement {
  return (
    <Input
      data-slot="input-group-control"
      className={cn(
        // Strip the Input's own border/ring/bg — the InputGroup shell owns them now.
        "flex-1 rounded-none border-0 bg-transparent shadow-none ring-0",
        "focus-visible:border-0 focus-visible:shadow-none focus-visible:ring-0",
        "disabled:bg-transparent",
        "aria-invalid:border-0 aria-invalid:bg-transparent aria-invalid:shadow-none aria-invalid:ring-0",
        className,
      )}
      {...props}
    />
  );
}

function InputGroupTextarea({
  className,
  ...props
}: ComponentProps<"textarea">): ReactElement {
  return (
    <Textarea
      data-slot="input-group-control"
      className={cn(
        "flex-1 resize-none rounded-none border-0 bg-transparent py-2 shadow-none ring-0",
        "focus-visible:border-0 focus-visible:shadow-none focus-visible:ring-0",
        "disabled:bg-transparent",
        "aria-invalid:border-0 aria-invalid:bg-transparent aria-invalid:shadow-none aria-invalid:ring-0",
        className,
      )}
      {...props}
    />
  );
}

export {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
  InputGroupTextarea,
  InputGroupText,
  inputGroupAddonVariants,
  inputGroupButtonVariants,
  type InputGroupAddonProps,
  type InputGroupButtonProps,
};
