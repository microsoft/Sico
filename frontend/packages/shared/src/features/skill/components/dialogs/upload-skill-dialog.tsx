import {
  Button,
  Dialog,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  toast,
} from "@sico/ui";
import { Loader2 } from "lucide-react";
import { type ReactElement, useRef, useState } from "react";

import { SkillFileList } from "./skill-file-list";
import {
  MAX_SKILL_FILE_SIZE_MB,
  MAX_SKILL_FILES,
  MAX_UPDATE_FILES,
  SKILL_ACCEPT_EXTENSIONS,
} from "../../constants";
import { extOf } from "../../utils";

const MAX_BYTES = MAX_SKILL_FILE_SIZE_MB * 1024 * 1024;

function supportTextFor(mode: "create" | "replace"): string {
  return mode === "create"
    ? `Support: zip, md, skill, up to ${MAX_SKILL_FILE_SIZE_MB}MB, ${MAX_SKILL_FILES} files.`
    : `Support: zip, md, skill, up to ${MAX_SKILL_FILE_SIZE_MB}MB.`;
}

// Validate a freshly-picked batch against the remaining slots, allowed
// extensions, size limit, and existing selection. Toasts mirror legacy wording;
// returns the files that survive every filter (most-recent-first ordering is
// applied by the caller).
function pickValidFiles(picked: File[], existing: File[], max: number): File[] {
  const maxMsg = `You can upload up to ${max} file${max > 1 ? "s" : ""}.`;
  const remain = max - existing.length;
  if (remain <= 0) {
    toast.info(maxMsg);
    return [];
  }

  const sliced = picked.slice(0, remain);
  const extOk = sliced.filter((file) =>
    SKILL_ACCEPT_EXTENSIONS.some((ext) => ext === extOf(file.name)),
  );
  if (extOk.length < sliced.length) {
    toast.error("Please select only .zip, .md, or .skill files.");
  }

  const sized = extOk.filter((file) => file.size <= MAX_BYTES);
  if (sized.length < extOk.length) {
    toast.error(
      `File size exceeds the ${MAX_SKILL_FILE_SIZE_MB}MB limit. Please choose a smaller file.`,
    );
  }

  const fresh = sized.filter(
    (file) =>
      !existing.some((e) => e.name === file.name && e.size === file.size),
  );
  if (fresh.length < sized.length) {
    toast.info("Duplicate files were skipped.");
  }
  if (picked.length > remain) {
    toast.info(maxMsg);
  }
  return fresh;
}

// Upload dialog ported from legacy UploadSkillsDialog: pick up to `max` files,
// validate them client-side, list them with per-row remove, and hand the batch
// to `onConfirm`. The caller owns the network upload; `pending` drives the
// Uploading… state and locks the controls. `mode` switches between create (up
// to 5 files) and replace (1).
export function UploadSkillDialog({
  open,
  mode,
  pending = false,
  onOpenChange,
  onConfirm,
}: {
  open: boolean;
  mode: "create" | "replace";
  pending?: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: (files: File[]) => void;
}): ReactElement {
  const max = mode === "create" ? MAX_SKILL_FILES : MAX_UPDATE_FILES;
  const [files, setFiles] = useState<File[]>([]);
  const [prevOpen, setPrevOpen] = useState(open);
  const inputRef = useRef<HTMLInputElement>(null);

  if (open !== prevOpen) {
    setPrevOpen(open);
    if (open) {
      setFiles([]);
    }
  }

  const accept = SKILL_ACCEPT_EXTENSIONS.map((ext) => `.${ext}`).join(",");
  const supportText = supportTextFor(mode);

  const onPick = (event: React.ChangeEvent<HTMLInputElement>): void => {
    const picked = Array.from(event.target.files ?? []);
    if (inputRef.current) {
      inputRef.current.value = "";
    }
    if (picked.length === 0) {
      return;
    }
    const fresh = pickValidFiles(picked, files, max);
    if (fresh.length > 0) {
      setFiles((prev) => [...fresh, ...prev]);
    }
  };

  const removeFile = (target: File): void => {
    setFiles((prev) => prev.filter((file) => file !== target));
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-fit">
        <DialogHeader>
          <DialogTitle>
            {mode === "create" ? "Add skills" : "Replace skill"}
          </DialogTitle>
        </DialogHeader>

        <div className="flex flex-col gap-3">
          <button
            type="button"
            disabled={pending}
            onClick={() => inputRef.current?.click()}
            className="border-divider text-foreground-secondary hover:text-foreground-primary flex h-24 w-full items-center justify-center rounded-lg border border-dashed text-sm transition-colors disabled:pointer-events-none disabled:opacity-60"
          >
            Click to choose files
          </button>
          <input
            ref={inputRef}
            type="file"
            hidden
            multiple={max > 1}
            aria-label="Skill files"
            accept={accept}
            onChange={onPick}
          />
          <p className="text-foreground-faint text-sm">{supportText}</p>

          {files.length > 0 && (
            <SkillFileList
              files={files}
              disabled={pending}
              onRemove={removeFile}
            />
          )}
        </div>

        <DialogFooter>
          <DialogClose
            render={<Button variant="secondary" disabled={pending} />}
          >
            Cancel
          </DialogClose>
          <Button
            disabled={pending || files.length === 0}
            onClick={() => onConfirm(files)}
          >
            {pending ? (
              <>
                <Loader2 className="animate-spin" />
                Uploading…
              </>
            ) : (
              "Upload"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
