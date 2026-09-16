import { useQueryErrorResetBoundary } from "@tanstack/react-query";
import { useLocation } from "@tanstack/react-router";
import { type ReactNode, Suspense } from "react";
import { ErrorBoundary } from "react-error-boundary";

import { AgentSetupSkeleton } from "./agent-setup-skeleton";
import { StudioAccessBoundary } from "./studio-access-boundary";
import { StudioSkeleton } from "./studio-skeleton";
import { ErrorView } from "../../../components/error-view/error-view";
import { useBoundOrganizationQuery } from "../../../hooks/use-bound-organization";

function isSetupPath(pathname: string): boolean {
  return (
    /^\/studio\/setup\/?$/.test(pathname) ||
    /^\/studio\/[^/]+\/setup\/?$/.test(pathname)
  );
}

export function StudioLayout({
  children,
}: {
  children: ReactNode;
}): React.JSX.Element {
  const { reset } = useQueryErrorResetBoundary();
  const { data: organization } = useBoundOrganizationQuery();
  const { pathname } = useLocation();
  const fallback = isSetupPath(pathname) ? (
    <AgentSetupSkeleton />
  ) : (
    <StudioSkeleton />
  );
  return (
    <ErrorBoundary
      FallbackComponent={ErrorView}
      onReset={reset}
      resetKeys={[pathname, organization?.id]}
    >
      <Suspense fallback={fallback}>
        <StudioAccessBoundary>{children}</StudioAccessBoundary>
      </Suspense>
    </ErrorBoundary>
  );
}
