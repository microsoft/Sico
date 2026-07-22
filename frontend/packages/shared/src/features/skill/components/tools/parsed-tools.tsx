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

import type { ReactElement } from "react";

import { ToolItem } from "./tool-item";
import type { SkillAction } from "../../schemas/skill";

type ParsedToolsProps = {
  actions: SkillAction[];
  originalActions?: SkillAction[];
  onActionChange: (index: number, action: SkillAction) => void;
};

export function ParsedTools({
  actions,
  originalActions,
  onActionChange,
}: ParsedToolsProps): ReactElement {
  if (actions.length === 0) {
    return (
      <div className="flex h-96 flex-col items-center justify-center gap-2 py-16 text-center">
        <div className="flex flex-col gap-1">
          <div className="text-foreground-emphasis text-base font-semibold">
            No tools yet
          </div>
          <div className="text-foreground-tertiary text-base">
            Tools will be auto-generated when necessary.
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-w-0 flex-col overflow-hidden">
      <p className="leading-body text-foreground-emphasis pb-5">
        Tools automatically extracted from uploaded Skills for efficient and
        reliable execution.
      </p>
      <div className="flex flex-col gap-3">
        {actions.map((action, index) => (
          <ToolItem
            // eslint-disable-next-line react/no-array-index-key -- parsed tools are a static, never-reordered list and two tools can share a name+description, so the index is the only stable unique key
            key={index}
            action={action}
            displayName={originalActions?.[index]?.name}
            defaultExpanded={index === 0}
            onChange={(next) => onActionChange(index, next)}
          />
        ))}
      </div>
    </div>
  );
}
