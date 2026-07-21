import { Button } from "@sico/ui";
import { cn } from "@sico/ui/lib/utils.ts";
import { ChevronDown, FileCode } from "lucide-react";
import type { ReactElement } from "react";

import { SkillActionsMenu } from "./skill-actions-menu";
import { VersionDropdown } from "./version-dropdown";
import type { SkillVersion } from "../../schemas/skill";

type SkillCardHeaderProps = {
  name: string;
  parsing: boolean;
  expanded: boolean;
  onToggle: () => void;
  showControls: boolean;
  saveDisabled: boolean;
  onSave: () => void;
  versions: SkillVersion[];
  selectedVersion: string;
  onSelectVersion: (version: string) => void;
  onReplace: () => void;
  onDownloadZip: () => void;
  onDelete: () => void;
};

export function SkillCardHeader({
  name,
  parsing,
  expanded,
  onToggle,
  showControls,
  saveDisabled,
  onSave,
  versions,
  selectedVersion,
  onSelectVersion,
  onReplace,
  onDownloadZip,
  onDelete,
}: SkillCardHeaderProps): ReactElement {
  return (
    <div className="flex h-8 items-center justify-between gap-2">
      <button
        type="button"
        aria-expanded={expanded}
        onClick={onToggle}
        className="flex flex-1 items-center gap-2 text-left"
      >
        <span className="bg-surface-icon-tile flex size-7 items-center justify-center rounded-md">
          <FileCode className="text-foreground-secondary size-4" />
        </span>
        <span className="text-foreground-emphasis leading-display text-lg font-medium">
          {parsing ? "Parsing ..." : name}
        </span>
        {!parsing && (
          <ChevronDown
            className={cn(
              "text-foreground-tertiary duration-medium-1 size-4 transition-transform",
              expanded && "rotate-180",
            )}
          />
        )}
      </button>
      {showControls && (
        <div className="flex items-center gap-1">
          {expanded && (
            <Button
              variant="primary"
              size="xs"
              disabled={saveDisabled}
              onClick={onSave}
            >
              {saveDisabled ? "Saved" : "Save"}
            </Button>
          )}
          {versions.length > 0 && (
            <VersionDropdown
              versions={versions}
              selectedVersion={selectedVersion}
              onSelect={onSelectVersion}
            />
          )}
          <SkillActionsMenu
            onReplace={onReplace}
            onDownloadZip={onDownloadZip}
            onDelete={onDelete}
          />
        </div>
      )}
    </div>
  );
}
