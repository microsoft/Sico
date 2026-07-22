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

import { type JSX, useState } from "react";

import { UnpreviewableState } from "../unpreviewable-state";

export type ImageViewerProps = {
  fileUrl: string;
  // Filename → the image's accessible name (this is the previewed content, not
  // decoration, so it gets a real alt rather than `alt=""`).
  alt: string;
};

/**
 * Image file body — the previewed image centered in the pane and scaled to fit
 * (`object-contain`, no crop). Zero-dependency; the browser decodes it natively.
 *
 * A broken source (expired SAS / 404) fires the `<img>` `error` event; without a
 * fallback the browser shows its default broken-image glyph. `onError` routes to
 * the shared download-fallback instead, matching the other viewers. Reset in
 * render on url change (MP13 replace-in-place) so a prior error doesn't pin a new
 * valid image on the fallback.
 */
export function ImageViewer({ fileUrl, alt }: ImageViewerProps): JSX.Element {
  const [errored, setErrored] = useState(false);
  const [prevUrl, setPrevUrl] = useState(fileUrl);
  if (fileUrl !== prevUrl) {
    setPrevUrl(fileUrl);
    setErrored(false);
  }

  if (errored) {
    return <UnpreviewableState />;
  }

  return (
    <div className="flex flex-1 items-center justify-center p-4">
      <img
        src={fileUrl}
        alt={alt}
        onError={() => setErrored(true)}
        className="max-h-full max-w-full object-contain"
      />
    </div>
  );
}
