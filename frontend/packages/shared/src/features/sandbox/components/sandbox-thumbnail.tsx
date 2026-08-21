import { cn } from "@sico/ui/lib/utils.ts";
import { type JSX, useState } from "react";

import { type Sandbox } from "../schemas/sandbox";
import { safeVncUrl as gateVncUrl } from "../utils/safe-vnc-url";

export type SandboxThumbnailProps = {
  sandbox: Sandbox;
};

/**
 * The non-interactive VNC thumbnail inside a device card's screen area. The
 * frame fades in only once it has painted (legacy `SandboxCard` hid it until
 * `onLoad`), so the card shows its surface placeholder instead of a half-loaded
 * VNC flash. View-only: `pointer-events-none` + `tabIndex -1` — the instance
 * view is where the device becomes interactive. The url is gated by `safeVncUrl`
 * (same-origin path or absolute https, same as the instance frame); a blocked
 * url renders an empty placeholder.
 */
export function SandboxThumbnail({
  sandbox,
}: SandboxThumbnailProps): JSX.Element {
  const [loaded, setLoaded] = useState(false);
  const safeVncUrl = gateVncUrl(sandbox.vncUrl);
  // Cards key on `sandboxId`, so a poll that swaps this device's `vncUrl` reuses
  // the instance — reset the fade-in in render the moment the url changes, or
  // the new frame would skip its placeholder and pop in (mirrors SandboxInstance).
  const [prevUrl, setPrevUrl] = useState(safeVncUrl);
  if (safeVncUrl !== prevUrl) {
    setPrevUrl(safeVncUrl);
    setLoaded(false);
  }
  return (
    <div className="aspect-video overflow-hidden rounded-md">
      {safeVncUrl ? (
        <iframe
          title={`${sandbox.displayName} preview`}
          src={safeVncUrl}
          tabIndex={-1}
          // No `sandbox` attribute: the VNC url is same-origin (our own proxied
          // noVNC page), and `sandbox` without `allow-same-origin` forces it into
          // an opaque origin — its websockify WebSocket would be cross-origin and
          // never connect (a blank frame). The instance frame is un-sandboxed for
          // the same reason; view-only here is enforced by pointer-events-none.
          referrerPolicy="no-referrer"
          onLoad={() => setLoaded(true)}
          className={cn(
            "pointer-events-none size-full border-none transition-opacity",
            loaded ? "opacity-100" : "opacity-0",
          )}
        />
      ) : null}
    </div>
  );
}
