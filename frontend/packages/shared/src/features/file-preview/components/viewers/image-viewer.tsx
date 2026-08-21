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
