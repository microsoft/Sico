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

import { Input, Label, Textarea } from "@sico/ui";
import { cn } from "@sico/ui/lib/utils.ts";
import { ChevronDown, ChevronRight } from "lucide-react";
import { type ReactElement, useMemo, useState } from "react";

import type { SkillAction, SkillFile } from "../../schemas/skill";
import { CodeViewer } from "../file-explorer/code-viewer";

type ToolItemProps = {
  action: SkillAction;
  displayName?: string;
  defaultExpanded?: boolean;
  onChange: (action: SkillAction) => void;
};

// Editable parsed-tool expander (legacy SkillToolItem): collapsible header plus
// Name / Description / Advanced settings fields that patch the action upward.
export function ToolItem({
  action,
  displayName,
  defaultExpanded = false,
  onChange,
}: ToolItemProps): ReactElement {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const patch = (next: Partial<SkillAction>): void =>
    onChange({ ...action, ...next });

  const advancedFile = useMemo<SkillFile>(
    () => ({
      path: "advanced-settings.json",
      content: action.advancedSettings,
    }),
    [action.advancedSettings],
  );

  return (
    <div className="border-stroke-subtle-card-rest bg-surface-canvas rounded-lg border px-4">
      <button
        type="button"
        aria-expanded={expanded}
        onClick={() => setExpanded((prev) => !prev)}
        className="text-foreground-emphasis flex h-12 w-full items-center gap-1 text-left text-base font-medium"
      >
        <span>{displayName ?? action.name}</span>
        {expanded ? (
          <ChevronDown className="size-4" />
        ) : (
          <ChevronRight className="size-4" />
        )}
      </button>
      <div className={cn("flex-col gap-3 pb-4", expanded ? "flex" : "hidden")}>
        <div className="flex flex-col gap-2">
          <Label className="text-foreground-tertiary">Name</Label>
          <Input
            placeholder="Enter tool name"
            className="bg-surface-basic"
            value={action.name}
            onChange={(event) => patch({ name: event.target.value })}
          />
        </div>
        <div className="flex flex-col gap-2">
          <Label className="text-foreground-tertiary">Description</Label>
          <Textarea
            placeholder="Describe what this tool does"
            className="bg-surface-basic min-h-28"
            value={action.description}
            onChange={(event) => patch({ description: event.target.value })}
          />
        </div>
        <div className="flex flex-col gap-2">
          <Label className="text-foreground-tertiary">Advanced settings</Label>
          <div className="border-input-stroke-rest bg-surface-basic h-72 overflow-hidden rounded-lg border py-2">
            <CodeViewer
              file={advancedFile}
              editable
              onChange={(content) => patch({ advancedSettings: content })}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
