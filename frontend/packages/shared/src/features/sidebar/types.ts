import { type ReactNode } from "react";

// Data shape for a sidebar nav row. sico's own `NavItem`/`RailNavItem`
// hard-code `to` to the routes sico/app registers; a downstream app (dwp)
// has its OWN routes (e.g. `/my-team`) that sico can't name at the type
// level. So instead of the app hand-rolling sico's pill/rail chrome, it
// passes plain DATA shaped like this and sico renders it through the same
// `<NavItem>`/`<RailNavItem>` — the app owns only the route string + icon,
// sico owns the look. Each sidebar variant maps over the downstream items
// after its built-in rows; `useActiveNav().isActive` drives the highlight.
export type NavItemData = {
  // Destination path. sico does not validate it — the consuming app's router
  // resolves it. The runtime guard against dangerous URIs (`javascript:`,
  // `data:`) is TanStack Link's protocol allowlist (http/https/mailto/tel),
  // which must not be widened or overridden. Keep `to` a developer-controlled
  // route literal, never a value sourced from network/user input. Also the
  // React `key` in the extras list, so it must be unique among `extraNavItems`
  // and must not collide with the built-in `/digital-worker` or `/project`.
  readonly to: string;
  readonly label: string;
  readonly icon: ReactNode;
};
