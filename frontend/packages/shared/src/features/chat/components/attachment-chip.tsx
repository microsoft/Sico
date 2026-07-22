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

import { type JSX, useEffect, useState } from "react";

import { FileTile } from "../../../components/file-tile";
import { ImageTile } from "../../../components/image-tile";
import { isImageFilename } from "../../../utils/file-type";
import { type Attachment } from "../atoms/chat-atom";

type Props = {
  attachment: Attachment;
  onRemove: (localId: string) => void;
};

export function AttachmentChip({ attachment, onRemove }: Props): JSX.Element {
  const { localId, file, status } = attachment;
  const isImage = isImageFilename(file.name);

  // Object-URL lifecycle. createObjectURL is synchronous, so a handle is minted
  // during render (lazy init) for a first-paint <img> (no placeholder, no size
  // jump). The effect then OWNS it: it mints a fresh URL on every mount and
  // revokes that same one on unmount, so StrictMode's mount→unmount→remount
  // ends on a LIVE handle. The prior code minted once in init but revoked on
  // every unmount, so a remount kept a dead blob → permanent broken thumbnail
  // (§4). setState in the effect is the documented "sync to external resource"
  // pattern; the cascade is one extra paint to a freshly minted, live blob.
  const [previewUrl, setPreviewUrl] = useState<string | null>(() =>
    isImage ? URL.createObjectURL(file) : null,
  );
  useEffect(() => {
    if (!isImage) {
      return undefined;
    }
    const url = URL.createObjectURL(file);
    // eslint-disable-next-line react-hooks/set-state-in-effect -- re-mint after StrictMode revokes the init URL; src must point at a live blob
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [file, isImage]);

  // Both tiles share these: the chip's `uploading` status maps onto the tile's
  // `loading` affordance (§4), removal is keyed by localId, and the label is the
  // same for either kind.
  const tileStatus = status === "uploading" ? "loading" : "ready";
  const removeLabel = "Remove attachment";
  const handleRemove = (): void => onRemove(localId);

  // Picks the tile by kind on the stable `isImage` flag — `previewUrl` is the
  // narrowed src for an image (always a live handle), every non-image renders
  // the shared <FileTile> (glyph + filename).
  if (isImage && previewUrl !== null) {
    return (
      <ImageTile
        src={previewUrl}
        alt={file.name}
        status={tileStatus}
        removeLabel={removeLabel}
        onRemove={handleRemove}
      />
    );
  }

  return (
    <FileTile
      filename={file.name}
      status={tileStatus}
      removeLabel={removeLabel}
      onRemove={handleRemove}
    />
  );
}
