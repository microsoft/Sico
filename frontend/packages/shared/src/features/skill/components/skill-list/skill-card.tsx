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
