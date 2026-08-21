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
