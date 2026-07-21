import { Button } from "@sico/ui";
import { X } from "lucide-react";
import { type ReactElement } from "react";

import { iconForFilename } from "../../../../utils/file-icon";

// Selected-file rows for the upload dialog: icon + truncated name + remove.
export function SkillFileList({
  files,
  disabled,
  onRemove,
}: {
  files: File[];
  disabled: boolean;
  onRemove: (file: File) => void;
}): ReactElement {
  return (
    <ul className="flex max-h-60 flex-col gap-2 overflow-y-auto">
      {files.map((file) => {
        const Icon = iconForFilename(file.name);
        return (
          <li
            key={`${file.name}-${file.size}`}
            className="border-divider flex h-11 items-center gap-2 rounded-lg border px-3"
          >
            <Icon className="text-foreground-secondary size-5 shrink-0" />
            <span className="min-w-0 flex-1 truncate text-sm">{file.name}</span>
            <Button
              variant="subtle"
              size="icon-xs"
              disabled={disabled}
              aria-label={`Remove ${file.name}`}
              onClick={() => onRemove(file)}
            >
              <X />
            </Button>
          </li>
        );
      })}
    </ul>
  );
}
