import { registerBuiltInLoaders } from "@babylonjs/loaders/dynamic";
import { CreateViewerForCanvas, type Viewer } from "@babylonjs/viewer";
import { type JSX, useEffect, useRef, useState } from "react";

import { logger } from "../../../../utils/logger";
import { LoadingOverlay } from "../loading-overlay";
import { UnpreviewableState } from "../unpreviewable-state";

// glTF / GLB loaders must be registered once before any viewer is created. This
// whole module is lazy-loaded (see lazy-glb-viewer), so the call only runs the
// first time a .glb is actually opened — never at app startup.
registerBuiltInLoaders();

export type GlbViewerProps = {
  fileUrl: string;
};

/**
 * GLB / glTF 3D model body — a Babylon viewer bound to a `<canvas>`, with a
 * spinner over it until the model loads and a shared error state if it can't.
 * Ported from legacy FileDrawer's BabylonViewer; the WebGL context is disposed
 * on unmount / url-change so it never leaks. Mounted only via `LazyGlbViewer` so
 * Babylon stays out of the main bundle.
 */
export default function GlbViewer({ fileUrl }: GlbViewerProps): JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const viewerRef = useRef<Viewer | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  // Replace-in-place (MP13): the shell swaps `fileUrl` on this same instance, so
  // reset loading/error in RENDER the moment the url changes — mirroring
  // VideoViewer/PdfViewer. Render-phase (not the effect below) is
  // correctness-by-construction: it avoids a one-frame stale paint of the prior
  // canvas before the spinner returns. (jsdom flushes effects within act(), so
  // the test only observes "spinner re-shows on swap", not this frame ordering.)
  // The effect stays the pure loader (it owns the Babylon viewer + its disposal).
  const [prevUrl, setPrevUrl] = useState(fileUrl);
  if (fileUrl !== prevUrl) {
    setPrevUrl(fileUrl);
    setLoading(true);
    setError(false);
  }

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) {
      return undefined;
    }
    const abort = new AbortController();
    // Read through a closure, not `abort.signal.aborted` directly: the first
    // check below narrows that property to `false`, and TS carries the narrowing
    // across the `await` to the second check — flagging it "always truthy" — even
    // though cleanup can flip the signal mid-await. A call expression isn't
    // narrowed across statements, so each `isAborted()` reflects the live value.
    const isAborted = (): boolean => abort.signal.aborted;

    void (async () => {
      const viewer = await CreateViewerForCanvas(canvas, {});
      // Lost the race to unmount/url-change — drop the just-built context.
      if (isAborted()) {
        viewer.dispose();
        return;
      }
      viewerRef.current = viewer;
      await viewer.loadModel(fileUrl, undefined, abort.signal);
      if (!isAborted()) {
        setLoading(false);
      }
    })().catch((cause: unknown) => {
      if (isAborted()) {
        return;
      }
      logger.error("glb load failed", { error: cause });
      setError(true);
      setLoading(false);
    });

    return () => {
      abort.abort();
      viewerRef.current?.dispose();
      viewerRef.current = null;
    };
  }, [fileUrl]);

  return (
    <div className="relative flex flex-1 items-center justify-center p-4">
      <canvas
        ref={canvasRef}
        data-testid="file-glb-canvas"
        className="block size-full outline-none"
      />
      {loading && <LoadingOverlay />}
      {error && (
        <div className="bg-surface-basic absolute inset-0 flex">
          <UnpreviewableState />
        </div>
      )}
    </div>
  );
}
