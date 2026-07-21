import {
  type ReactElement,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";

import { ExplorerView } from "./explorer-view";
import { saveBlob } from "../../../../utils/save-blob";
import type { SkillFile } from "../../schemas/skill";
import { mimeTypeForPath } from "../../utils";

type FileExplorerProps = {
  files: SkillFile[];
  editable: boolean;
  onContentChange?: (path: string, content: string) => void;
  isLoading?: boolean;
  progress?: number;
  error?: string;
};

function objectUrlFor(file: SkillFile): string {
  return URL.createObjectURL(
    new Blob([new Uint8Array(file.bytes ?? [])], {
      type: mimeTypeForPath(file.path),
    }),
  );
}

// Object URL for the selected file's bytes, revoked when the selection changes
// or the explorer unmounts. Created in render via useMemo (not an effect) so the
// preview never flickers through an empty string.
function useFilePreviewUrl(file: SkillFile | undefined): string {
  const previewUrl = useMemo(
    () => (file?.bytes ? objectUrlFor(file) : ""),
    [file],
  );

  useEffect(() => {
    if (!previewUrl) {
      return undefined;
    }
    return () => URL.revokeObjectURL(previewUrl);
  }, [previewUrl]);

  return previewUrl;
}

export function FileExplorer({
  files,
  editable,
  onContentChange,
  isLoading = false,
  progress = 0,
  error = "",
}: FileExplorerProps): ReactElement | null {
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [fullscreen, setFullscreen] = useState(false);
  const [selectedPath, setSelectedPath] = useState<string | null>(
    files[0]?.path ?? null,
  );

  const selectedFile =
    files.find((file) => file.path === selectedPath) ?? files[0];

  // Render-time reset: if the current selection disappears (files reloaded),
  // fall back to the first file without a set-state-in-effect.
  if (selectedPath !== null && selectedFile?.path !== selectedPath) {
    setSelectedPath(selectedFile?.path ?? null);
  }

  const previewUrl = useFilePreviewUrl(selectedFile);

  const onDownload = useCallback(() => {
    if (!selectedFile?.bytes) {
      return;
    }
    const blob = new Blob([new Uint8Array(selectedFile.bytes)], {
      type: mimeTypeForPath(selectedFile.path),
    });
    saveBlob(blob, selectedFile.path.split("/").pop() ?? "file");
  }, [selectedFile]);

  if (isLoading) {
    return (
      <div className="text-foreground-emphasis flex items-center justify-center py-16">
        <div className="flex w-60 flex-col items-center gap-3">
          <span className="text-base">Loading files ...</span>
          <div className="bg-progress-track-fill h-1 w-full overflow-hidden rounded-full">
            <div
              className="bg-progress-indicator-fill shadow-progress-glow duration-medium-2 ease-persistent h-full rounded-l-full transition-[width]"
              style={{ width: `${Math.round(progress * 100)}%` }}
            />
          </div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="text-foreground-tertiary flex items-center justify-center py-16">
        {error}
      </div>
    );
  }

  if (!selectedFile) {
    return (
      <div className="flex h-96 flex-col items-center justify-center gap-2 py-16 text-center">
        <div className="flex flex-col gap-1">
          <div className="text-foreground-emphasis text-base font-semibold">
            No files yet
          </div>
          <div className="text-foreground-tertiary text-base">
            Files will appear here once the skill is set up.
          </div>
        </div>
      </div>
    );
  }

  return (
    <ExplorerView
      files={files}
      selectedFile={selectedFile}
      editable={editable}
      previewUrl={previewUrl}
      sidebarOpen={sidebarOpen}
      fullscreen={fullscreen}
      setSidebarOpen={setSidebarOpen}
      setFullscreen={setFullscreen}
      onSelect={setSelectedPath}
      onContentChange={onContentChange}
      onDownload={onDownload}
    />
  );
}
