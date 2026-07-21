import { useAtomValue } from "jotai";
import { useMemo } from "react";

import { planByIdAtom } from "../atoms/chat-atom";
import { type Plan } from "../schemas/plan";

// Reads one plan tree from the store by id. `planByIdAtom(planId)` mints a FRESH
// `selectAtom` per call, so reading it raw would re-subscribe every render and
// defeat the by-node memo. The `useMemo` pins one atom instance for the
// component's life, keeping the subscription (and its output memo) stable.
export function usePlanById(planId: string): Plan | undefined {
  const atom = useMemo(() => planByIdAtom(planId), [planId]);
  return useAtomValue(atom);
}
