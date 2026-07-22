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

import { ImageTile } from "../../../../components/image-tile";
import type { MessageAttachment } from "../../atoms/chat-atom";
import { useSidepaneActions } from "../../hooks/use-sidepane";

export type ImageAttachmentProps = {
  attachment: MessageAttachment;
};

// A sent image attachment: the shared `<ImageTile>` thumbnail. Source is the
// remote `sasUrl`, optional on the wire — a missing one falls back to empty src
// (broken thumbnail) and leaves the tile non-interactive (no URL to preview).
// With a `sasUrl` the tile opens the image in the sidepane as `file` content,
// which the FilePreviewer routes to the full-size ImageViewer by subtype.
export function ImageAttachment({
  attachment,
}: ImageAttachmentProps): JSX.Element {
  const { open } = useSidepaneActions();
  const { name, sasUrl } = attachment;
  const onActivate = sasUrl
    ? (): void => open({ kind: "file", filename: name, fileUrl: sasUrl })
    : undefined;

  return <ImageTile src={sasUrl ?? ""} alt={name} onActivate={onActivate} />;
}
