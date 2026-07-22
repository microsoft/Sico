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
import {
  File as FileIcon,
  Maximize2,
  Minimize2,
  PanelLeftClose,
  PanelLeftOpen,
} from "lucide-react";
import { type Dispatch, type ReactElement, type SetStateAction } from "react";
import { createPortal } from "react-dom";

import { FilePreview } from "./file-preview";
import { FileTree } from "./file-tree";
import type { SkillFile } from "../../schemas/skill";

type ExplorerViewProps = {
  files: SkillFile[];
  selectedFile: SkillFile;
  editable: boolean;
  previewUrl: string;
  sidebarOpen: boolean;
  fullscreen: boolean;
  setSidebarOpen: Dispatch<SetStateAction<boolean>>;
  setFullscreen: Dispatch<SetStateAction<boolean>>;
  onSelect: (path: string) => void;
  onContentChange?: (path: string, content: string) => void;
  onDownload: () => void;
};

// Presentational shell for the file explorer (header toolbar + sidebar tree +
// preview pane). Split out of FileExplorer so the container keeps only state and
// the loading / error / empty guards.
export function ExplorerView({
  files,
  selectedFile,
  editable,
  previewUrl,
  sidebarOpen,
  fullscreen,
  setSidebarOpen,
  setFullscreen,
  onSelect,
  onContentChange,
  onDownload,
}: ExplorerViewProps): ReactElement {
  const content = (
    <div
      className={cn(
        "border-stroke-subtle-card-rest bg-surface-basic min-w-0 border",
        fullscreen
          ? "fixed inset-0 z-50 flex flex-col rounded-none"
          : "w-full overflow-hidden rounded-lg",
      )}
    >
      <header className="border-stroke-subtle-card-rest bg-surface-canvas flex h-8 items-center gap-2 border-b px-3">
        <Button
          variant="subtle"
          size="icon-xs"
          aria-label="Toggle sidebar"
          onClick={() => setSidebarOpen((prev) => !prev)}
        >
          {sidebarOpen ? (
            <PanelLeftClose className="text-foreground-secondary" />
          ) : (
            <PanelLeftOpen className="text-foreground-secondary" />
          )}
        </Button>
        <FileIcon className="text-foreground-tertiary size-4 shrink-0" />
        <span className="text-foreground-emphasis truncate text-xs">
          {selectedFile.path}
        </span>
        <Button
          variant="subtle"
          size="icon-xs"
          aria-label="Toggle fullscreen"
          className="ml-auto"
          onClick={() => setFullscreen((prev) => !prev)}
        >
          {fullscreen ? <Minimize2 /> : <Maximize2 />}
        </Button>
      </header>

      <div
        className={cn(
          "flex min-w-0",
          fullscreen ? "min-h-0 flex-1" : "h-125 items-stretch",
        )}
      >
        {sidebarOpen && (
          <aside className="border-divider bg-surface-basic relative w-50 shrink-0 border-r">
            <div className="absolute inset-0 overflow-auto py-2">
              <FileTree
                files={files}
                selectedPath={selectedFile.path}
                onSelect={onSelect}
              />
            </div>
          </aside>
        )}
        <div className="min-w-0 flex-1">
          <FilePreview
            file={selectedFile}
            editable={editable}
            previewUrl={previewUrl}
            onContentChange={onContentChange}
            onDownload={onDownload}
          />
        </div>
      </div>
    </div>
  );

  return fullscreen ? createPortal(content, document.body) : content;
}
