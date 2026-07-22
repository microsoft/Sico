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

import { useState } from "react";

import {
  type SkillAction,
  type SkillFile,
  type SkillVersion,
} from "../schemas/skill";

function changedFilesOf(
  files: SkillFile[],
  originalFiles: SkillFile[],
): SkillFile[] {
  return files.filter((file) => {
    const original = originalFiles.find((item) => item.path === file.path);
    return !original || original.content !== file.content;
  });
}

function changedActionsOf(
  actions: SkillAction[],
  originalActions: SkillAction[],
): SkillAction[] {
  return actions.filter((action, index) => {
    const original = originalActions[index];
    return (
      !original ||
      original.name !== action.name ||
      original.description !== action.description ||
      original.advancedSettings !== action.advancedSettings
    );
  });
}

export type SkillCardEdits = {
  files: SkillFile[];
  actions: SkillAction[];
  actionsBaseline: SkillAction[];
  changedFiles: SkillFile[];
  changedActions: SkillAction[];
  hasChanges: boolean;
  onContentChange: (path: string, content: string) => void;
  onActionChange: (index: number, action: SkillAction) => void;
  commitActionsBaseline: () => void;
};

// Edit buffers for the skill card. The baselines reset via the render-time
// previous-state pattern on a version switch (actions arrive with detail) or
// when the async file download resolves — avoiding a set-state-in-effect.
export function useSkillCardEdits(
  originalFiles: SkillFile[],
  activeVersion: SkillVersion | undefined,
): SkillCardEdits {
  const [versionKey, setVersionKey] = useState(activeVersion?.version);
  const [filesBaseline, setFilesBaseline] = useState(originalFiles);
  const [files, setFiles] = useState<SkillFile[]>(originalFiles);
  const [actionsBaseline, setActionsBaseline] = useState<SkillAction[]>(
    activeVersion?.actions ?? [],
  );
  const [actions, setActions] = useState<SkillAction[]>(
    activeVersion?.actions ?? [],
  );
  if (activeVersion && activeVersion.version !== versionKey) {
    setVersionKey(activeVersion.version);
    setActions(activeVersion.actions);
    setActionsBaseline(activeVersion.actions);
  }
  // Reseed the file buffer when a new originalFiles reference arrives. This is
  // referential — safe because useZipFiles returns a stable empty array while
  // loading (so a pending download doesn't churn this every render) and one
  // stable resolved array afterwards, so it fires once when files land.
  if (originalFiles !== filesBaseline) {
    setFilesBaseline(originalFiles);
    setFiles(originalFiles);
  }

  const onContentChange = (path: string, content: string): void => {
    setFiles((prev) =>
      prev.some((file) => file.path === path)
        ? prev.map((file) => (file.path === path ? { ...file, content } : file))
        : [...prev, { path, content }],
    );
  };
  const onActionChange = (index: number, action: SkillAction): void => {
    setActions((prev) => prev.map((item, i) => (i === index ? action : item)));
  };

  const changedFiles = changedFilesOf(files, filesBaseline);
  const changedActions = changedActionsOf(actions, actionsBaseline);
  return {
    files,
    actions,
    actionsBaseline,
    changedFiles,
    changedActions,
    hasChanges: changedFiles.length > 0 || changedActions.length > 0,
    onContentChange,
    onActionChange,
    commitActionsBaseline: () => setActionsBaseline(actions),
  };
}
