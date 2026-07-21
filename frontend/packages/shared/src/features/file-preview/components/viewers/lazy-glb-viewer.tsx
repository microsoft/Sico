import { Spinner } from "@sico/ui";
import { type JSX, lazy, Suspense } from "react";

// Babylon is several MB — `lazy` keeps it (and its glTF loaders) out of the main
// bundle, pulled in only the first time a .glb is actually opened.
const GlbViewer = lazy(() => import("./glb-viewer"));

export type LazyGlbViewerProps = {
  fileUrl: string;
};

/**
 * Code-split entry point for {@link GlbViewer}. The Suspense fallback covers the
 * chunk download; once the module lands the viewer renders its own spinner over
 * the dark stage while the model loads. FilePreviewer imports this, never the
 * eager viewer.
 */
export function LazyGlbViewer({ fileUrl }: LazyGlbViewerProps): JSX.Element {
  return (
    <Suspense
      fallback={
        <div className="flex flex-1 items-center justify-center">
          <Spinner size="lg" />
        </div>
      }
    >
      <GlbViewer fileUrl={fileUrl} />
    </Suspense>
  );
}
