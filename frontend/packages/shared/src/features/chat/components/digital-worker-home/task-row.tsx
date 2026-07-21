import { cn } from "@sico/ui/lib/utils.ts";
import { type JSX } from "react";

import { RecommendationTaskIconGlyph } from "./recommendation-task-icon";
import { type RecommendationTask } from "../../schemas/recommendation-task";
import { delayStyle, FADE_CLASS } from "../../utils/reveal";

type Props = {
  task: RecommendationTask;
  index: number;
  onSelect: (message: string) => void;
};

// One suggested task: icon chip + truncated message. A button — it's an action,
// keyboard- and screen-reader-reachable (legacy used a bare div). Click prefills
// the composer (handled by the parent). Blur-fades in after the section label
// (legacy: 240ms base, then an extra 80ms once the first row has landed).
export function TaskRow({ task, index, onSelect }: Props): JSX.Element {
  return (
    <button
      type="button"
      onClick={() => onSelect(task.message)}
      style={delayStyle(240 + (index === 0 ? 0 : 80))}
      className={cn(
        FADE_CLASS,
        "group text-foreground-primary hover:bg-surface-basic hover:shadow-s flex items-center gap-3 rounded-lg py-2 pr-3 pl-1 text-left text-sm transition hover:pl-2",
      )}
    >
      <span className="border-stroke-subtle-card-rest text-foreground-secondary bg-surface-sunken group-hover:text-foreground-primary group-hover:border-stroke-subtle-card-hover flex size-7 shrink-0 items-center justify-center rounded-md border transition">
        <RecommendationTaskIconGlyph icon={task.icon} />
      </span>
      <span className="truncate">{task.message}</span>
    </button>
  );
}
