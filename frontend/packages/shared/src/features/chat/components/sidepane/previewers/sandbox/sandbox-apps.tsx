import { useQueryErrorResetBoundary } from "@tanstack/react-query";
import { type JSX, Suspense } from "react";
import { ErrorBoundary } from "react-error-boundary";

import { SandboxAppsContent } from "./sandbox-apps-content";
import { SandboxAppsSkeleton } from "./sandbox-apps-skeleton";
import { ErrorView } from "../../../../../../components/error-view";
import { type Sandbox } from "../../../../../sandbox/schemas/sandbox";

export type SandboxAppsProps = {
  agentInstanceId: number;
  // The live device list (from the previewer's instances query) — drives the
  // device tabs + the install/uninstall scope.
  devices: Sandbox[];
  onBack: () => void;
};

/**
 * Manage-apps panel shell — suspense + error wiring around the suspending
 * `<SandboxAppsContent>` (mirrors the projects feature's shell/content split).
 * The app list is fetched with `useSuspenseQuery`, so the full-panel skeleton
 * is the Suspense fallback and query throws land on the self-centering
 * `ErrorView`.
 *
 * Piping `reset` into `onReset` is required, else "Try again" remounts but the
 * query stays errored and re-throws. `resetKeys` on the instance id drops the
 * error when the panel is reused for a different agent instance.
 */
export function SandboxApps({
  agentInstanceId,
  devices,
  onBack,
}: SandboxAppsProps): JSX.Element {
  const { reset } = useQueryErrorResetBoundary();
  return (
    <ErrorBoundary
      FallbackComponent={ErrorView}
      onReset={reset}
      resetKeys={[agentInstanceId]}
    >
      <Suspense fallback={<SandboxAppsSkeleton />}>
        <SandboxAppsContent
          agentInstanceId={agentInstanceId}
          devices={devices}
          onBack={onBack}
        />
      </Suspense>
    </ErrorBoundary>
  );
}
