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

import { type ReactElement } from "react";

import { ParsingProgress } from "./parsing-progress";
import { SkillCardBody } from "./skill-card-body";
import {
  type SkillAction,
  type SkillFile,
  type SkillStatus,
  SkillStatusSchema,
} from "../../schemas/skill";

export function SkillCardContent({
  status,
  parsing,
  failReason,
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
}: {
  status: SkillStatus;
  parsing: boolean;
  failReason?: string;
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
}): ReactElement {
  if (parsing) {
    return <ParsingProgress text="Parsing skill content" />;
  }
  if (status === SkillStatusSchema.enum.FAILED) {
    return (
      <p className="text-foreground-error pt-2 pb-6 text-sm">{failReason}</p>
    );
  }
  return (
    <SkillCardBody
      expanded={expanded}
      onExpand={onExpand}
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
  );
}
