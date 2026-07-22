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

import { type ReactElement, useState } from "react";

import { SkillCardContent } from "./skill-card-content";
import { SkillCardHeader } from "./skill-card-header";
import { type SkillCardSaveInput } from "../../hooks/use-skill-card-actions";
import { useSkillCardEdits } from "../../hooks/use-skill-card-edits";
import {
  type SkillFile,
  type SkillItem,
  type SkillStatus,
  SkillStatusSchema,
  type SkillVersion,
} from "../../schemas/skill";
import { findActiveVersion } from "../../utils";

export type SkillCardProps = {
  skill: SkillItem;
  versions: SkillVersion[];
  status: SkillStatus;
  parsing?: boolean;
  detailLoading: boolean;
  expanded: boolean;
  onToggle: () => void;
  originalFiles: SkillFile[];
  filesLoading: boolean;
  filesProgress?: number;
  filesError?: string;
  selectedVersion: string;
  onSelectVersion: (version: string) => void;
  onReplace: () => void;
  onDownloadZip: () => void;
  onDelete: () => void;
  onSave: (changes: SkillCardSaveInput) => Promise<void>;
};

export function SkillCard({
  skill,
  versions,
  status,
  parsing,
  detailLoading,
  expanded,
  onToggle,
  originalFiles,
  filesLoading,
  filesProgress = 0,
  filesError = "",
  selectedVersion,
  onSelectVersion,
  onReplace,
  onDownloadZip,
  onDelete,
  onSave,
}: SkillCardProps): ReactElement {
  const activeVersion = findActiveVersion(versions, selectedVersion);

  const [saving, setSaving] = useState(false);
  const edits = useSkillCardEdits(originalFiles, activeVersion);

  const isParsing = parsing ?? status === SkillStatusSchema.enum.UPLOADING;
  const description = activeVersion?.description ?? skill.description;
  const saveDisabled = saving || versions.length === 0 || !edits.hasChanges;

  async function handleSave(): Promise<void> {
    setSaving(true);
    try {
      await onSave({
        files: edits.changedFiles.length > 0 ? edits.changedFiles : undefined,
        actions:
          edits.changedActions.length > 0 ? edits.changedActions : undefined,
      });
      edits.commitActionsBaseline();
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="border-stroke-subtle-card-rest bg-surface-basic rounded-xl border px-6 pt-6">
      <SkillCardHeader
        name={activeVersion?.name ?? skill.name}
        parsing={isParsing}
        expanded={expanded}
        onToggle={onToggle}
        showControls={!isParsing && !detailLoading}
        saveDisabled={saveDisabled}
        onSave={() => {
          void handleSave();
        }}
        versions={versions}
        selectedVersion={selectedVersion}
        onSelectVersion={onSelectVersion}
        onReplace={onReplace}
        onDownloadZip={onDownloadZip}
        onDelete={onDelete}
      />
      <SkillCardContent
        status={status}
        parsing={isParsing}
        failReason={skill.failReason}
        expanded={expanded}
        onExpand={onToggle}
        description={description}
        creatorUsername={activeVersion?.creatorUsername ?? ""}
        detailLoading={detailLoading}
        filesLoading={filesLoading}
        filesProgress={filesProgress}
        filesError={filesError}
        files={edits.files}
        actions={edits.actions}
        originalActions={edits.actionsBaseline}
        onContentChange={edits.onContentChange}
        onActionChange={edits.onActionChange}
      />
    </div>
  );
}
