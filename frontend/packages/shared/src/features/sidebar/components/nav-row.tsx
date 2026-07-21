import { cn } from "@sico/ui/lib/utils.ts";
import {
  cloneElement,
  type JSX,
  type ReactElement,
  type ReactNode,
} from "react";

import { NAV_ROW_STATE } from "../constants";

// Element types accepted by the row shells' `render` prop. Declaring
// `data-active` here lets `cloneElement` inject it without an `as` cast, so
// excess-property checking still catches typos on `className`. `children` is
// kept on the type because `cloneElement` can only inject children when the
// element's prop type admits them — the row owns its content, so any children
// a caller sets on the render element are intentionally replaced (see the JSX
// below). This mirrors base-ui's render convention.
export type NavRowRenderElement = ReactElement<{
  readonly className?: string;
  readonly children?: ReactNode;
  readonly "data-active"?: true;
}>;

// Shared chrome for an expanded-sidebar nav row. Owns ONLY the look — the
// caller supplies the outer element via `render` (a `<Link>` for routes, a
// `<button>`/popover trigger for interactive rows like Notification), so the
// same pill style serves both sico's routes and downstream interactive rows
// without the consumer copying the className. The row's className + composed
// content (icon / label / trailing) are injected into `render` via
// `cloneElement`. This is a deliberately minimal subset of base-ui's
// `render`-prop convention: it merges `className` and sets `data-active` /
// `children`, but does not merge event handlers or refs.
type NavRowProps = {
  readonly icon: ReactNode;
  readonly label: ReactNode;
  // Right-aligned slot — e.g. a count badge or chevron. Omitted → label fills.
  readonly trailing?: ReactNode;
  readonly active?: boolean;
  // Outer element to render the row as. Its existing props are preserved; the
  // shared className is merged onto it and the composed content becomes its
  // children (any children on the passed element are replaced).
  readonly render: NavRowRenderElement;
};

const NAV_ROW_CLASS = `${NAV_ROW_STATE} flex h-9 items-center gap-2 rounded-lg px-2 text-sm font-medium`;

export function NavRow({
  icon,
  label,
  trailing,
  active,
  render,
}: NavRowProps): JSX.Element {
  return cloneElement(render, {
    className: cn(NAV_ROW_CLASS, render.props.className),
    "data-active": active ? true : undefined,
    children: (
      <>
        <span className="shrink-0">{icon}</span>
        <span className="min-w-0 flex-1 truncate text-left">{label}</span>
        {trailing}
      </>
    ),
  });
}
