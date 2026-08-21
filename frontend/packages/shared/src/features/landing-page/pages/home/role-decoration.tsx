import { cn } from "@sico/ui/lib/utils.ts";
import { type ReactElement } from "react";

import bottomLine from "../../../../assets/landing-page/bottom-line.png";
import dotContent from "../../../../assets/landing-page/dot-content.png";
import dotEmpty from "../../../../assets/landing-page/dot-empty.png";
import topLine from "../../../../assets/landing-page/top-line.png";

const dots = [
  {
    image: dotEmpty,
    animation: "animate-landing-page-role-dot-primary",
    className: "top-76 left-0 size-52",
    revealIndex: 0,
  },
  {
    image: dotEmpty,
    animation: "animate-landing-page-role-dot-upper",
    className: "top-8 left-10 size-28",
    revealIndex: 1,
  },
  {
    image: dotEmpty,
    animation: "animate-landing-page-role-dot-lower",
    className: "right-0 bottom-19.5 size-16 lg:size-24 2xl:size-32",
    revealIndex: 2,
  },
  {
    image: dotContent,
    animation: "animate-landing-page-role-dot-content",
    className: "top-4 right-0 size-88",
    revealIndex: 3,
  },
] as const;
const lines = [
  { image: topLine, className: "top-24 left-44 w-20" },
  { image: bottomLine, className: "top-70 left-56 w-21" },
] as const;

/** The decorative dots and connecting lines revealed alongside the roles. */
export function RoleDecoration({
  activeIndex,
  roleCount,
}: {
  activeIndex: number;
  roleCount: number;
}): ReactElement {
  return (
    <div
      aria-hidden="true"
      className="hidden min-h-0 w-full items-center justify-end lg:flex lg:h-full"
    >
      <div className="relative size-full max-h-190 max-w-162.5">
        {lines.map(({ image, className }) => (
          <div
            key={image}
            data-visible={activeIndex === roleCount - 1}
            className={cn("landing-page-role-dot absolute", className)}
          >
            <img src={image} alt="" className="h-auto w-full object-contain" />
          </div>
        ))}
        {dots.map(({ image, animation, className, revealIndex }) => (
          <div
            key={animation}
            data-visible={revealIndex <= activeIndex}
            className={cn("landing-page-role-dot absolute", className)}
          >
            <img
              src={image}
              alt=""
              className={cn("size-full object-contain", animation)}
            />
          </div>
        ))}
      </div>
    </div>
  );
}
