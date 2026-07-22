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
