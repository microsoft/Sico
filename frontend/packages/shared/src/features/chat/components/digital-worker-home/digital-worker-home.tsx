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

import { type JSX, Suspense } from "react";

import { DigitalWorkerHomeContent } from "./digital-worker-home-content";
import { DigitalWorkerHomeSkeleton } from "./digital-worker-home-skeleton";

type Props = {
  agentInstanceId: number;
  // Fired with the freshly-minted conversation id AFTER the composed message is
  // parked in pendingMessageAtom. The consumer navigates to
  // /collaboration/$conversationId, where the parked message is drained and
  // sent. Kept as a callback so @sico/shared owns no route literals.
  onSubmitted: (conversationId: number) => void;
};

// The Digital Worker home page (the `/digital-worker/$id` index): a hero (avatar
// + crossfading line), the SAME chat <Composer>, and onboarding suggested tasks.
// Owns the agent-query Suspense boundary so the route file stays a thin mount;
// the fallback is a content-shaped skeleton (not a Spinner) so the layout
// previews while the agent loads.
export function DigitalWorkerHome({
  agentInstanceId,
  onSubmitted,
}: Props): JSX.Element {
  return (
    <Suspense fallback={<DigitalWorkerHomeSkeleton />}>
      <DigitalWorkerHomeContent
        agentInstanceId={agentInstanceId}
        onSubmitted={onSubmitted}
      />
    </Suspense>
  );
}
