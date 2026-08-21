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
