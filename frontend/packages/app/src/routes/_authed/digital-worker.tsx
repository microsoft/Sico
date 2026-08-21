import { createFileRoute, Outlet } from "@tanstack/react-router";
import { type JSX } from "react";

// Thin layout route: declares operator-only access once for every
// `/digital-worker/*` child. Children inherit it via `staticData.modes`
// (ModeGuard's deepest-declared-wins rule), so the index and `$agentId` leaves
// no longer repeat the gate. Renders a bare <Outlet/> — no extra chrome.
export const Route = createFileRoute("/_authed/digital-worker")({
  staticData: { modes: ["operator"] },
  component: DigitalWorkerLayout,
});

function DigitalWorkerLayout(): JSX.Element {
  return <Outlet />;
}
