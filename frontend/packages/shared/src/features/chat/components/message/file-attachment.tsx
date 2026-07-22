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

import { FileTile } from "../../../../components/file-tile";
import type { MessageAttachment } from "../../atoms/chat-atom";
import { useSidepaneActions } from "../../hooks/use-sidepane";

export type FileAttachmentProps = {
  attachment: MessageAttachment;
};

// A sent non-image attachment: the shared `<FileTile>`, no remove control.
// With a `sasUrl` the tile opens the file in the sidepane (mirrors a deliverable
// card); without one (optional on the wire) it stays a static, read-only tile —
// there's no URL to preview.
export function FileAttachment({
  attachment,
}: FileAttachmentProps): JSX.Element {
  const { open } = useSidepaneActions();
  const { name, sasUrl } = attachment;
  const onActivate = sasUrl
    ? (): void => open({ kind: "file", filename: name, fileUrl: sasUrl })
    : undefined;

  return <FileTile filename={name} onActivate={onActivate} />;
}
