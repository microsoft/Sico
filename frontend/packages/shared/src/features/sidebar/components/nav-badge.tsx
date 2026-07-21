import { type JSX, type ReactNode } from "react";

// Small count pill for a nav row's `trailing` slot (e.g. Notification's unread
// count). Distinct from `@sico/ui`'s status `Badge` (h-5/h-6 status labels):
// a danger pill that stays circular for a single digit and grows horizontally
// into a pill for multi-digit counts — no border.
export function NavBadge({ children }: { children: ReactNode }): JSX.Element {
  return (
    <span
      // eslint-disable-next-line tailwindcss/no-custom-classname -- `bg-danger-500` (brand) and `text-foreground-on-inverted` (semantic) are valid Tailwind v4 @theme vars, unresolvable here because @sico/shared has no globals.css on the plugin's cssFiles path.
      // `h-4 min-w-4` (min-width == height) keeps a 1-digit badge circular
      // and lets multi-digit counts grow horizontally into a pill without
      // vertical distortion. `px-1` supplies horizontal breathing room when
      // the digit(s) exceed min-width.
      className="bg-danger-500 text-foreground-on-inverted text-2xs inline-flex h-4 min-w-4 items-center justify-center rounded-full px-1 leading-none font-medium tracking-wide"
    >
      {children}
    </span>
  );
}
