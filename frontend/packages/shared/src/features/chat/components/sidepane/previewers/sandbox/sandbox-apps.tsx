/**
 * Copyright (c) 2026 Sico Authors
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in
 * all copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 */

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
