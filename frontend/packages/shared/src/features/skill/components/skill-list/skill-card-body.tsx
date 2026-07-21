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
