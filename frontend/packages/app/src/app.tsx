import { OuterErrorFallback } from "@sico/shared";
import type { ReactElement } from "react";
import { ErrorBoundary } from "react-error-boundary";

import { RootProviders } from "@/components/root-providers";

// Outer ErrorBoundary catches catastrophic failures during provider init.
// FallbackComponent is the pre-bound export — an inline arrow would
// remount on every parent re-render.
export default function App(): ReactElement {
  return (
    <ErrorBoundary FallbackComponent={OuterErrorFallback}>
      <RootProviders />
    </ErrorBoundary>
  );
}
