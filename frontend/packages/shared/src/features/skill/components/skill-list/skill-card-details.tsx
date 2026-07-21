import { Tabs, TabsContent, TabsList, TabsTrigger } from "@sico/ui";
import type { ReactElement } from "react";

import { SkillSkeleton } from "./skill-skeleton";
import type { SkillAction, SkillFile } from "../../schemas/skill";
import { FileExplorer } from "../file-explorer/file-explorer";
import { ParsedTools } from "../tools/parsed-tools";

const TRIGGER_CLASS = "grow-0";

type SkillCardDetailsProps = {
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

// Expanded region of the skill card: full description, "Modified by", and the
// Files / Tools tabs (legacy StyledExpandSection expanded body).
export function SkillCardDetails({
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
}: SkillCardDetailsProps): ReactElement {
  const filesLabel = files.length > 0 ? `Files(${files.length})` : "Files";
  const toolsLabel =
    actions.length > 0 ? `Parsed Tools(${actions.length})` : "Parsed Tools";
  return (
    <div className="pt-2">
      <div className="flex flex-col gap-3 pb-5">
        {description && (
          <p className="text-foreground-emphasis leading-body">{description}</p>
        )}
        {creatorUsername && (
          <p className="text-foreground-tertiary text-sm">
            Modified by {creatorUsername}
          </p>
        )}
      </div>
      {detailLoading ? (
        <SkillSkeleton />
      ) : (
        <Tabs defaultValue="files" className="gap-5">
          <TabsList
            variant="line"
            className="border-divider w-full justify-start border-b"
          >
            <TabsTrigger value="files" className={TRIGGER_CLASS}>
              {filesLabel}
            </TabsTrigger>
            <TabsTrigger value="tools" className={TRIGGER_CLASS}>
              {toolsLabel}
            </TabsTrigger>
          </TabsList>
          <TabsContent value="files" className="h-96">
            <FileExplorer
              files={files}
              editable
              isLoading={filesLoading}
              progress={filesProgress}
              error={filesError}
              onContentChange={onContentChange}
            />
          </TabsContent>
          <TabsContent value="tools">
            <ParsedTools
              actions={actions}
              originalActions={originalActions}
              onActionChange={onActionChange}
            />
          </TabsContent>
        </Tabs>
      )}
    </div>
  );
}
