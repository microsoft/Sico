import { cn } from "@sico/ui/lib/utils.ts";
import { type JSX, type RefObject } from "react";

import { LoadingOverlay } from "../../file-preview/components/loading-overlay";
import { type Sandbox } from "../schemas/sandbox";

export type DeviceScreenProps = {
  selected: Sandbox;
  isEmulator: boolean;
  takeOver: boolean;
  // The VNC url already gated by `safeVncUrl` (null = blocked, show a message).
  safeVncUrl: string | null;
  loaded: boolean;
  onLoad: () => void;
  iframeRef: RefObject<HTMLIFrameElement | null>;
  takingOverLabel: string;
  unavailableLabel: string;
};

/**
 * The live device screen under the instance header: a take-over accent border,
 * the aio/wincua "taking over" badge + input-blocking overlay, a loading spinner
 * until the frame paints, and the VNC iframe itself — or a blocked message when
 * the url isn't https. Extracted so `SandboxInstance` stays within its budget.
 *
 * The frame is intentionally NOT `sandbox`-attributed (take-over needs input +
 * postMessage). The url is gated by `safeVncUrl` in the caller before it reaches
 * `src` — a same-origin path (our own proxied backend) or absolute https, so an
 * untrusted scheme/cross-origin host never mounts here.
 */
export function DeviceScreen({
  selected,
  isEmulator,
  takeOver,
  safeVncUrl,
  loaded,
  onLoad,
  iframeRef,
  takingOverLabel,
  unavailableLabel,
}: DeviceScreenProps): JSX.Element {
  return (
    <div className="min-h-0 flex-1 px-3 pb-4">
      <div
        className={cn(
          "relative h-full overflow-hidden rounded-2xl transition-colors",
          !isEmulator && "border-2",
          !isEmulator &&
            (takeOver
              ? "border-primary-600"
              : "border-stroke-subtle-card-rest"),
        )}
      >
        {/* aio/wincua: a "taking over" badge + an input-blocking overlay that
            lifts only in take-over. Emulators handle this in-frame, so they get
            neither. */}
        {!isEmulator && takeOver ? (
          <div className="bg-primary-600 text-foreground-on-inverted absolute top-0 left-1/2 z-20 flex h-6 -translate-x-1/2 items-center rounded-b-lg px-2 text-xs font-medium">
            {takingOverLabel}
          </div>
        ) : null}
        {!isEmulator && !takeOver ? (
          <div
            data-testid="sandbox-input-block"
            className="absolute inset-0 z-10 cursor-not-allowed"
          />
        ) : null}
        {/* Spinner over the frame until the live view paints (legacy showed a
            blank frame; this avoids the half-loaded flash). z-30 clears the
            badge + input overlay so nothing peeks through. */}
        {!loaded && safeVncUrl ? (
          <div className="absolute inset-0 z-30">
            <LoadingOverlay />
          </div>
        ) : null}
        {safeVncUrl ? (
          <iframe
            ref={iframeRef}
            title={`${selected.displayName} live view`}
            src={safeVncUrl}
            referrerPolicy="no-referrer"
            onLoad={onLoad}
            className="size-full border-none"
          />
        ) : (
          <div className="text-foreground-tertiary flex size-full items-center justify-center text-sm">
            {unavailableLabel}
          </div>
        )}
      </div>
    </div>
  );
}
