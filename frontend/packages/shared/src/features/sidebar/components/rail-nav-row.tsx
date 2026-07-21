import { cn } from "@sico/ui/lib/utils.ts";
import { cloneElement, type JSX, type ReactNode } from "react";

import { type NavRowRenderElement } from "./nav-row";

// Collapsed-rail counterpart of `NavRow`: icon-only, centered, no label text
// (the label becomes the outer element's `aria-label`, supplied by the caller
// on `render`).
type RailNavRowProps = {
  readonly icon: ReactNode;
  readonly active?: boolean;
  readonly render: NavRowRenderElement;
};

const RAIL_NAV_ROW_CLASS =
  "text-foreground-secondary hover:bg-surface-muted data-[active]:bg-surface-muted flex size-9 items-center justify-center rounded-lg";

export function RailNavRow({
  icon,
  active,
  render,
}: RailNavRowProps): JSX.Element {
  return cloneElement(render, {
    className: cn(RAIL_NAV_ROW_CLASS, render.props.className),
    "data-active": active ? true : undefined,
    children: icon,
  });
}
