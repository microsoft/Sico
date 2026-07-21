import {
  Button,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  FieldLabel,
  Input,
  toast,
} from "@sico/ui";
import { Loader2 } from "lucide-react";
import { Suspense, useRef, useState } from "react";
import type * as React from "react";
import { ErrorBoundary } from "react-error-boundary";

import { AddKnowledgeTagArea } from "./add-knowledge-tag-area";
import { AddKnowledgeTagAreaSkeleton } from "./add-knowledge-tag-area-skeleton";
import { FileTile } from "../../../components/file-tile";
import { logger } from "../../../utils/logger";
import { safeIconUri } from "../../../utils/safe-icon-uri";
import {
  type AddKnowledgeResult,
  useAddKnowledgeMutation,
} from "../hooks/use-add-knowledge-mutation";
import { collectValidFiles, fileKey } from "../utils/collect-valid-files";

// Render helpers — plain module-scope functions (NOT nested components, so
// `react/no-unstable-nested-components` never fires and only ONE component
// lives in this file) that keep the dialog body under the 100-line cap. Called
// as `{renderDropZone(...)}`, never `<RenderDropZone/>` — the exact pattern
// `edit-project-dialog.tsx` uses.

// The knowledge-tag picker. It suspends on `useKnowledgeTagsQuery`, so a LOCAL
// ErrorBoundary drops only the tag area on failure (a secondary field) instead
// of escalating to the page boundary and blanking the whole workspace.
function renderTagArea(
  projectId: number,
  value: number[],
  onChange: (next: number[]) => void,
): React.JSX.Element {
  return (
    <ErrorBoundary
      fallback={null}
      onError={(error) => logger.error("tag area failed", { error })}
    >
      <Suspense fallback={<AddKnowledgeTagAreaSkeleton />}>
        <AddKnowledgeTagArea
          projectId={projectId}
          value={value}
          onChange={onChange}
        />
      </Suspense>
    </ErrorBoundary>
  );
}

function renderDropZone(
  fileInputRef: React.RefObject<HTMLInputElement | null>,
  onPick: () => void,
  onFileInputChange: (event: React.ChangeEvent<HTMLInputElement>) => void,
  onDropFiles: (files: File[]) => void,
): React.JSX.Element {
  return (
    <div className="flex flex-col gap-3">
      <FieldLabel className="text-base">Upload context</FieldLabel>
      <div
        className="border-input-stroke-rest bg-surface-basic flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed px-6 py-9"
        onDragOver={(event) => event.preventDefault()}
        onDrop={(event) => {
          event.preventDefault();
          onDropFiles(Array.from(event.dataTransfer.files));
        }}
      >
        <p className="text-foreground-secondary leading-body text-center text-sm">
          Supports pdf, docx, xlsx · up to 10MB · max 5 files
        </p>
        <p className="text-foreground-secondary leading-body text-center text-sm">
          Files must be publicly accessible.
        </p>
        <Button type="button" variant="secondary" onClick={onPick}>
          Add files
        </Button>
        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept=".pdf,.docx,.xlsx"
          className="hidden"
          data-testid="add-knowledge-file-input"
          onChange={onFileInputChange}
        />
      </div>
    </div>
  );
}

function renderLinkRow(
  linkDraft: string,
  onLinkDraftChange: (value: string) => void,
  onAddLink: () => void,
): React.JSX.Element {
  return (
    <div className="flex items-center gap-2">
      <Input
        aria-label="Import from link"
        placeholder="Paste a link to import"
        value={linkDraft}
        onChange={(event) => onLinkDraftChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            onAddLink();
          }
        }}
      />
      <Button type="button" variant="secondary" onClick={onAddLink}>
        Add
      </Button>
    </div>
  );
}

function renderAttachmentRow(
  key: string,
  filename: string,
  onRemove: () => void,
): React.JSX.Element {
  // The glyph is derived from `filename` inside <FileTile> via
  // `iconForFilename` — files resolve by extension, a link (an http(s) URL)
  // resolves to the globe.
  return (
    <FileTile
      key={key}
      filename={filename}
      removeLabel={`Remove ${filename}`}
      onRemove={onRemove}
    />
  );
}

// Mixed-result toast (M-3): a partial failure still surfaces, and any success
// closes the dialog. Closing on success only is intentional — a full failure
// keeps the dialog so the user can retry. The success copy says "extracting"
// (not "added") because registration only queues extraction — the extraction
// result toast fires later, from the table's poll (useExtractionResultToast).
function reportResult(result: AddKnowledgeResult, onClose: () => void): void {
  if (result.failed.length > 0) {
    toast.error("Some items couldn't be added. Try again.");
  }
  if (result.succeeded.length > 0) {
    toast.success("Knowledge uploaded — extracting…");
    onClose();
  }
}

// Footer (§5): Cancel + Upload. `Upload` is enabled once there's at least one
// file OR one link (migration C3); links and files both flow into submit.
function renderFooter(
  itemCount: number,
  isPending: boolean,
  onCancel: () => void,
  onUpload: () => void,
): React.JSX.Element {
  return (
    <DialogFooter>
      <Button type="button" variant="secondary" onClick={onCancel}>
        Cancel
      </Button>
      <Button
        type="button"
        variant="primary"
        aria-busy={isPending}
        aria-label={isPending ? "Uploading" : undefined}
        disabled={itemCount === 0 || isPending}
        onClick={onUpload}
      >
        {isPending ? <Loader2 className="animate-spin" /> : "Upload"}
      </Button>
    </DialogFooter>
  );
}

function renderAttachments(
  files: File[],
  links: string[],
  onRemoveFile: (index: number) => void,
  onRemoveLink: (index: number) => void,
): React.JSX.Element | null {
  if (files.length === 0 && links.length === 0) {
    return null;
  }
  return (
    <div className="flex flex-wrap gap-2">
      {files.map((file, index) =>
        renderAttachmentRow(fileKey(file), file.name, () =>
          onRemoveFile(index),
        ),
      )}
      {links.map((url, index) =>
        renderAttachmentRow(url, url, () => onRemoveLink(index)),
      )}
    </div>
  );
}

export type AddKnowledgeDialogProps = {
  projectId: number;
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

/**
 * Controlled dialog for adding knowledge (files + links + tags) to a project.
 *
 * Upload submits files, links, and the selected knowledge-tag ids together
 * via `useAddKnowledgeMutation` (files register as FILE, links as LINK, both
 * carrying `tagIds`). Upload is enabled once there's at least one file or link
 * (migration C3).
 *
 * Closing the dialog resets every draft field — `files`, `links`, `linkDraft`,
 * and `selectedTagIds` — so a reopened dialog always starts clean (the parent
 * only toggles `open`; the component stays mounted). The suspending
 * `<AddKnowledgeTagArea>` sits behind a LOCAL `<ErrorBoundary>` so a tag-source
 * failure drops only the tag area, not the whole workspace.
 */
export function AddKnowledgeDialog({
  projectId,
  open,
  onOpenChange,
}: AddKnowledgeDialogProps): React.JSX.Element {
  const [files, setFiles] = useState<File[]>([]);
  const [links, setLinks] = useState<string[]>([]);
  const [linkDraft, setLinkDraft] = useState("");
  const [selectedTagIds, setSelectedTagIds] = useState<number[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const mutation = useAddKnowledgeMutation(projectId);

  const addFiles = (incoming: File[]): void => {
    const { accepted, errors } = collectValidFiles(incoming, files);
    for (const message of errors) {
      toast.error(message);
    }
    if (accepted.length > 0) {
      setFiles((prev) => [...prev, ...accepted]);
    }
  };

  const handleFileInputChange = (
    event: React.ChangeEvent<HTMLInputElement>,
  ): void => {
    const input = event.target;
    addFiles(Array.from(input.files ?? []));
    input.value = "";
  };

  const addLink = (): void => {
    const url = linkDraft.trim();
    if (!url || links.includes(url)) {
      return;
    }
    // Scheme-gate the user-entered link: a stored javascript:/data: URL would
    // later render as a live <a href> on the asset-detail page (XSS). safeIconUri
    // accepts only http(s)/same-origin paths.
    if (!safeIconUri(url)) {
      toast.error("Enter a valid http(s) link.");
      return;
    }
    setLinks((prev) => [...prev, url]);
    setLinkDraft("");
  };

  // Resets every draft field, tags included, so a reopened dialog starts clean.
  const handleClose = (): void => {
    setFiles([]);
    setLinks([]);
    setLinkDraft("");
    setSelectedTagIds([]);
    onOpenChange(false);
  };

  const handleUpload = (): void => {
    if (files.length === 0 && links.length === 0) {
      return;
    }
    mutation.mutate(
      { files, links, tagIds: selectedTagIds },
      { onSuccess: (result) => reportResult(result, handleClose) },
    );
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => (next ? onOpenChange(true) : handleClose())}
    >
      <DialogContent variant="content" className="w-150">
        <DialogHeader>
          <DialogTitle>Add Knowledge</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-6">
          {renderTagArea(projectId, selectedTagIds, setSelectedTagIds)}
          {renderDropZone(
            fileInputRef,
            () => fileInputRef.current?.click(),
            handleFileInputChange,
            addFiles,
          )}
          {renderLinkRow(linkDraft, setLinkDraft, addLink)}
          {renderAttachments(
            files,
            links,
            (index) => setFiles((prev) => prev.filter((_, i) => i !== index)),
            (index) => setLinks((prev) => prev.filter((_, i) => i !== index)),
          )}
        </div>
        {renderFooter(
          files.length + links.length,
          mutation.isPending,
          handleClose,
          handleUpload,
        )}
      </DialogContent>
    </Dialog>
  );
}
