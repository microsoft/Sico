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
        <span className="leading-display text-foreground-emphasis text-lg font-medium">
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
