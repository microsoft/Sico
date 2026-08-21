import { cn } from "@sico/ui/lib/utils.ts";
import { type ReactElement } from "react";

type RoleListItemProps = {
  title: string;
  description: string;
  active: boolean;
};

/** A single role in the list, with its active/inactive title crossfade. */
export function RoleListItem({
  title,
  description,
  active,
}: RoleListItemProps): ReactElement {
  return (
    <li data-active={active} aria-current={active ? "step" : undefined}>
      <h3 className="leading-display relative font-semibold">
        <span className="invisible">{title}</span>
        <span
          aria-hidden="true"
          className={cn(
            "text-landing-page-role-inactive duration-medium-2 absolute inset-0 transition-opacity ease-in-out motion-reduce:transition-none",
            active ? "opacity-0" : "opacity-100",
          )}
        >
          {title}
        </span>
        <span
          aria-hidden="true"
          className={cn(
            "bg-gradient-landing-page-role-active duration-medium-2 absolute inset-0 bg-clip-text text-transparent transition-opacity ease-in-out motion-reduce:transition-none",
            active ? "opacity-100" : "opacity-0",
          )}
        >
          {title}
        </span>
      </h3>
      <div className="landing-page-role-description" aria-hidden={!active}>
        <div className="overflow-hidden">
          <p className="lg:text-landing-page-role-description-compact 2xl:text-landing-page-role-description text-foreground-on-inverted text-sm font-medium sm:text-base">
            {description}
          </p>
        </div>
      </div>
    </li>
  );
}
