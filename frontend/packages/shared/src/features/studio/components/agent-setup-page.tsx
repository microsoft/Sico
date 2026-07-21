import { useQueryErrorResetBoundary } from "@tanstack/react-query";
import { type JSX, Suspense } from "react";
import { ErrorBoundary } from "react-error-boundary";

import { AgentSetupBody } from "./agent-setup-body";
import { ErrorView } from "../../../components/error-view";
import { SetupSkeleton } from "../../skill";

// Edit-mode setup for an existing studio Digital Worker. `agentId` is the
// UUID-keyed studio draft (single_agent), NOT the numeric instance id. Mounted
// by the /studio/$agentId/setup route, which owns the agent/skills/roles
// prefetch so the body's suspense queries hit cache.
export function AgentSetupPage({ agentId }: { agentId: string }): JSX.Element {
  const { reset } = useQueryErrorResetBoundary();
  return (
    <div className="bg-surface-canvas flex h-full w-full flex-col">
      <ErrorBoundary
        FallbackComponent={ErrorView}
        onReset={reset}
        resetKeys={[agentId]}
      >
        <Suspense fallback={<SetupSkeleton />}>
          <AgentSetupBody agentId={agentId} />
        </Suspense>
      </ErrorBoundary>
    </div>
  );
}
