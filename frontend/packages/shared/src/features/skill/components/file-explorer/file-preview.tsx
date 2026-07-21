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
