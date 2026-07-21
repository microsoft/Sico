import type { ComponentProps, ReactElement } from "react";

import { cn } from "../../lib/utils";

/**
 * Native `<label>` with shadcn base-nova styling.
 *
 * Mirrors `peer-disabled:*` and `group-data-[disabled=true]:*` from upstream
 * so a parent `<Field data-disabled>` or sibling `<input disabled>` dims the
 * label automatically — no Context required.
 */
function Label({ className, ...props }: ComponentProps<"label">): ReactElement {
  return (
    // eslint-disable-next-line jsx-a11y/label-has-associated-control -- generic primitive; consumers wire htmlFor to a control
    <label
      data-slot="label"
      className={cn(
        "flex items-center gap-2 text-sm leading-none font-medium select-none",
        "group-data-[disabled=true]:pointer-events-none group-data-[disabled=true]:opacity-50",
        "peer-disabled:cursor-not-allowed peer-disabled:opacity-50",
        className,
      )}
      {...props}
    />
  );
}

export { Label };
