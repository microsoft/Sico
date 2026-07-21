import { cn } from "@sico/ui/lib/utils.ts";
import { type JSX } from "react";

import { TaskRow } from "./task-row";
import { useSuspenseRecommendationTasks } from "../../hooks/use-recommendation-tasks";
import { delayStyle, REVEAL_CLASS } from "../../utils/reveal";

type Props = {
  agentInstanceId: number;
  onSelect: (message: string) => void;
};

// The DW home's suggested-task list. Suspends on the onboarding fetch (the
// parent wraps it in a Suspense+ErrorBoundary, so loading shows a skeleton and a
// failure degrades to nothing). Renders nothing when the resolved list is empty
// — no divider over an empty section.
export function SuggestedTasks({
  agentInstanceId,
  onSelect,
}: Props): JSX.Element | null {
  const tasks = useSuspenseRecommendationTasks(agentInstanceId);
  if (tasks.length === 0) {
    return null;
  }
  return (
    <div className="mt-6 flex flex-col gap-2 pb-2">
      <div
        className={cn(REVEAL_CLASS, "flex items-center gap-2")}
        style={delayStyle(240)}
      >
        <span className="text-foreground-faint text-xs tracking-wider uppercase">
          Suggested tasks
        </span>
        <span className="border-divider flex-1 border-t" />
      </div>
      {tasks.map((task, index) => (
        // Suggestions are fetched once and never reordered, and messages can
        // repeat, so the position is the only stable identity.
        <TaskRow
          // eslint-disable-next-line react/no-array-index-key -- static, never-reordered list; messages may duplicate
          key={index}
          task={task}
          index={index}
          onSelect={onSelect}
        />
      ))}
    </div>
  );
}
