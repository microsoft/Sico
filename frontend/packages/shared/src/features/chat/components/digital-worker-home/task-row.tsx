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
      <span className="border-stroke-subtle-card-rest bg-surface-sunken text-foreground-secondary group-hover:border-stroke-subtle-card-hover group-hover:text-foreground-primary flex size-7 shrink-0 items-center justify-center rounded-md border transition">
        <RecommendationTaskIconGlyph icon={task.icon} />
      </span>
      <span className="truncate">{task.message}</span>
    </button>
  );
}
