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
import type { ReactElement } from "react";

import { CollapsedDescription } from "./collapsed-description";
import { SkillCardDetails } from "./skill-card-details";
import type { SkillAction, SkillFile } from "../../schemas/skill";

type SkillCardBodyProps = {
  expanded: boolean;
  onExpand: () => void;
  description: string;
  creatorUsername: string;
  detailLoading: boolean;
  filesLoading: boolean;
  filesProgress: number;
  filesError: string;
  files: SkillFile[];
  actions: SkillAction[];
  originalActions: SkillAction[];
  onContentChange: (path: string, content: string) => void;
  onActionChange: (index: number, action: SkillAction) => void;
};

// Collapsible body (legacy StyledExpandSection): an expanded region with the
// full description, "Modified by", and the Files/Tools tabs, plus a collapsed
// region showing a masked description preview that expands on click.
export function SkillCardBody({
  expanded,
  onExpand,
  description,
  creatorUsername,
  detailLoading,
  filesLoading,
  filesProgress,
  filesError,
  files,
  actions,
  originalActions,
  onContentChange,
  onActionChange,
}: SkillCardBodyProps): ReactElement {
  return (
    <div className="overflow-hidden pb-6">
      <div
        className={cn(
          "duration-medium-1 ease-persistent grid transition-[grid-template-rows]",
          expanded ? "grid-rows-[1fr]" : "grid-rows-[0fr] opacity-0",
        )}
      >
        <div className="min-h-0 overflow-hidden">
          <SkillCardDetails
            description={description}
            creatorUsername={creatorUsername}
            detailLoading={detailLoading}
            filesLoading={filesLoading}
            filesProgress={filesProgress}
            filesError={filesError}
            files={files}
            actions={actions}
            originalActions={originalActions}
            onContentChange={onContentChange}
            onActionChange={onActionChange}
          />
        </div>
      </div>
      <div
        className={cn(
          "duration-medium-1 ease-persistent grid transition-[grid-template-rows]",
          expanded ? "grid-rows-[0fr]" : "grid-rows-[1fr]",
        )}
      >
        <div className="min-h-0 overflow-hidden">
          {description && (
            <CollapsedDescription
              description={description}
              onExpand={onExpand}
            />
          )}
        </div>
      </div>
    </div>
  );
}
