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

import { type JSX } from "react";

import { FileAttachment } from "./file-attachment";
import { ImageAttachment } from "./image-attachment";
import { isImageFilename } from "../../../../utils/file-type";
import type { MessageAttachment } from "../../atoms/chat-atom";

export type AttachmentListProps = {
  attachments: MessageAttachment[];
};

// Read-only attachment strip on a sent bubble — the editable composer
// AttachmentBar is a separate component.
export function AttachmentList({
  attachments,
}: AttachmentListProps): JSX.Element {
  return (
    <div className="flex flex-wrap items-center gap-2">
      {attachments.map((attachment) =>
        isImageFilename(attachment.name) ? (
          <ImageAttachment
            key={attachment.id ?? attachment.uri}
            attachment={attachment}
          />
        ) : (
          <FileAttachment
            key={attachment.id ?? attachment.uri}
            attachment={attachment}
          />
        ),
      )}
    </div>
  );
}
