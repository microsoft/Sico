import { useQueryErrorResetBoundary } from "@tanstack/react-query";
import { type JSX, type ReactNode, Suspense } from "react";
import { ErrorBoundary } from "react-error-boundary";

import { Header } from "./header";
import { HeaderSkeleton } from "./header-skeleton";
import { ErrorView } from "../../../components/error-view";

export type AgentDetailLayoutProps = {
  // The raw `$agentId` route param. The Header's suspense query runs on the
  // numeric form (`Number(agentId)`); the boundary re-arms on the raw string.
  // Keeping a single source param avoids the two drifting out of sync — and the
  // string key matters because two non-numeric params both coerce to NaN
  // (Object.is(NaN, NaN) === true), so keying on the number can't tell a
  // bad → worse switch apart.
  agentId: string;
  // Right-aligned Header controls supplied by the route — e.g. the chat Device
  // button. Passed as a node so this feature never imports chat.
  actions?: ReactNode;
  // The routed content below the Header (the route hands its `<Outlet/>` here).
  children: ReactNode;
};

/**
 * Layout shell for a single Digital Worker (`/digital-worker/$agentId`). The
 * Header suspends on agent detail behind its own skeleton — it does NOT gate
 * `children`, which mount in parallel. An agent-detail failure takes over the
 * WHOLE panel: the boundary wraps the children too, and the fallback centers in
 * the flex column. `useQueryErrorResetBoundary` is piped into `onReset` so
 * "Try again" both remounts the subtree and clears the failed query (otherwise
 * the suspense hook re-throws on remount and the user is stuck).
 *
 * The route owns the router primitives (`createFileRoute`, `useParams`,
 * `<Outlet/>`); this shell stays router-tree-agnostic so it lives in shared.
 */
export function AgentDetailLayout({
  agentId,
  actions,
  children,
}: AgentDetailLayoutProps): JSX.Element {
  const { reset } = useQueryErrorResetBoundary();
  return (
    <div className="bg-surface-canvas flex h-full min-h-0 flex-1 flex-col">
      <ErrorBoundary
        FallbackComponent={ErrorView}
        onReset={reset}
        resetKeys={[agentId]}
      >
        <Suspense fallback={<HeaderSkeleton />}>
          <Header agentId={Number(agentId)} actions={actions} />
        </Suspense>
        {children}
      </ErrorBoundary>
    </div>
  );
}
