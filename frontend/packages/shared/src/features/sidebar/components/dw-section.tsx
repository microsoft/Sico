import { Link } from "@tanstack/react-router";
import { ChevronRight } from "lucide-react";
import { type JSX } from "react";

import { DwList } from "./dw-list";

// Standard-menu "Digital Workers" group: a static caplabel (all-caps section
// header — labels only, no navigation) with an "all" link on the right that
// jumps to the full list, above the preview rows. Splitting the two affordances
// keeps the header from overloading one row (see the former NavItem).
export function DwSection(): JSX.Element {
  return (
    <div className="flex flex-col gap-1">
      <div className="flex h-9 items-center justify-between gap-2 pr-1 pl-2">
        <span className="text-foreground-tertiary truncate text-xs font-medium tracking-wider uppercase">
          Digital workers
        </span>
        <Link
          to="/digital-worker"
          aria-label="View all digital workers"
          className="text-foreground-tertiary hover:text-foreground-primary flex shrink-0 items-center gap-0.5 rounded-sm text-sm font-medium"
        >
          View all
          <ChevronRight aria-hidden="true" className="size-3.5" />
        </Link>
      </div>
      <DwList />
    </div>
  );
}
