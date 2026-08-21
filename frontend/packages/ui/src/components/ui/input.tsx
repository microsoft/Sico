import { Input as InputPrimitive } from "@base-ui/react/input";
import type { ComponentProps, ReactElement } from "react";

import { cn } from "../../lib/utils";

/**
 * Bare native input — shadcn base-nova restyle (no upstream drift).
 *
 * This is the leaf primitive. For affixes, password toggle, clear button,
 * label, description, or error text, compose with `<InputGroup>` and
 * `<Field>` rather than extending this file.
 *
 * Deletions from upstream:
 *   - `dark:` variants (SICO has no dark theme yet).
 *   - `md:text-sm` responsive override (SICO inputs are 14px everywhere;
 *     mobile size bump comes from typography tokens, not viewport).
 */
function Input({
  className,
  type,
  ...props
}: ComponentProps<"input">): ReactElement {
  return (
    <InputPrimitive
      type={type}
      data-slot="input"
      className={cn(
        "border-input-stroke-rest h-8 w-full min-w-0 rounded-lg border bg-transparent px-3 py-1 text-sm transition-colors outline-none",
        "file:text-foreground-primary file:inline-flex file:h-6 file:border-0 file:bg-transparent file:text-sm file:font-medium",
        "placeholder:text-foreground-faint",
        "hover:border-input-stroke-hover",
        "focus-visible:border-input-stroke-pressed focus-visible:shadow-s",
        "invalid:border-input-stroke-rest invalid:bg-transparent invalid:shadow-none invalid:ring-0 invalid:outline-none",
        "invalid:[box-shadow:none] invalid:[-webkit-box-shadow:none]",
        "disabled:bg-surface-canvas disabled:text-foreground-faint disabled:pointer-events-none disabled:cursor-not-allowed disabled:border-transparent",
        "aria-invalid:bg-input-fill-error aria-invalid:border-input-stroke-error",
        className,
      )}
      {...props}
    />
  );
}

export { Input };
