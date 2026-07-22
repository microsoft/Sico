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
import { FileQuestion } from "lucide-react";
import type { ReactElement } from "react";

import { CodeViewer } from "./code-viewer";
import { PdfPreview } from "./pdf-preview";
import type { SkillFile } from "../../schemas/skill";
import { detectFileKind } from "../../utils";

export function FilePreview({
  file,
  editable,
  previewUrl,
  onContentChange,
  onDownload,
}: {
  file: SkillFile;
  editable: boolean;
  previewUrl: string;
  onContentChange?: (path: string, content: string) => void;
  onDownload: () => void;
}): ReactElement | null {
  const kind = file.kind ?? detectFileKind(file.path);

  if (kind === "pdf") {
    return previewUrl ? <PdfPreview fileUrl={previewUrl} /> : null;
  }

  if (kind === "image") {
    return (
      <div className="bg-surface-sunken flex h-full items-center justify-center overflow-auto p-6">
        {previewUrl ? (
          <img
            src={previewUrl}
            alt={file.path}
            className="max-w-full object-contain"
          />
        ) : null}
      </div>
    );
  }

  if (kind === "binary") {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-8">
        <div className="flex flex-col items-center gap-8">
          <FileQuestion className="text-foreground-faint size-16" />
          <p className="text-foreground-secondary w-64 text-center text-sm">
            Preview not supported for this file type. Download to view its
            contents.
          </p>
        </div>
        <Button variant="secondary" onClick={onDownload}>
          Download
        </Button>
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto">
      <CodeViewer
        file={file}
        editable={editable}
        onChange={(content) => onContentChange?.(file.path, content)}
      />
    </div>
  );
}
