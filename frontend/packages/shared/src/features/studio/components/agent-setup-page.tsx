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
