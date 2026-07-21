import { type JSX, useState } from "react";

import { LoadingOverlay } from "../loading-overlay";
import { UnpreviewableState } from "../unpreviewable-state";

export type VideoViewerProps = {
  fileUrl: string;
};

/**
 * Video file body — a native `<video controls>` scaled to fit, with a spinner
 * overlaid until the browser can play it (`onCanPlay`). Zero-dependency.
 *
 * Replace-in-place (MP13): the shell swaps `fileUrl` on this same instance
 * rather than remounting, so the loading/error flags reset in render the moment
 * the url changes — otherwise a stale `canPlay`/`errored` from the previous
 * video would carry into the new one (mirrors SandboxedIframe).
 *
 * A load failure (expired SAS / 404 / unsupported codec) fires the element's
 * `error` event and `onCanPlay` never comes — so without an error path the
 * spinner would spin forever. `onError` routes to the shared download-fallback.
 */
export function VideoViewer({ fileUrl }: VideoViewerProps): JSX.Element {
  const [canPlay, setCanPlay] = useState(false);
  const [errored, setErrored] = useState(false);
  const [prevUrl, setPrevUrl] = useState(fileUrl);
  if (fileUrl !== prevUrl) {
    setPrevUrl(fileUrl);
    setCanPlay(false);
    setErrored(false);
  }

  if (errored) {
    return <UnpreviewableState />;
  }

  return (
    <div className="relative flex flex-1 items-center justify-center p-4">
      {!canPlay && <LoadingOverlay />}
      {/* eslint-disable-next-line jsx-a11y/media-has-caption -- agent-produced files carry no caption track; none exists to reference */}
      <video
        controls
        src={fileUrl}
        onCanPlay={() => setCanPlay(true)}
        onError={() => setErrored(true)}
        data-testid="file-video"
        className="size-full object-contain"
      />
    </div>
  );
}
