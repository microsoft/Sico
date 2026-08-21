import { createFileRoute } from "@tanstack/react-router";
import type { JSX } from "react";

// Placeholder route — e2e a11y sweep navigates here to exercise
// `useFocusFirstHeading` on authenticated route change.
export const Route = createFileRoute("/_authed/profile")({
  component: ProfilePage,
});

function ProfilePage(): JSX.Element {
  // Pages own `tabIndex={-1}` declaratively (see digital-worker.tsx).
  return (
    <h1 tabIndex={-1} className="font-medium">
      Profile
    </h1>
  );
}
