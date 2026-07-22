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

import { Button, Tooltip, TooltipContent, TooltipTrigger } from "@sico/ui";
import { cn } from "@sico/ui/lib/utils.ts";
import { LayoutGrid, MousePointer2 } from "lucide-react";
import { type JSX, useCallback, useRef, useState } from "react";

import { DeviceScreen } from "../../../../../sandbox/components/device-screen";
import { SandboxDropdown } from "../../../../../sandbox/components/sandbox-dropdown";
import { iconForSandboxType } from "../../../../../sandbox/components/sandbox-icon";
import { SandboxStatus } from "../../../../../sandbox/components/sandbox-status";
import { useTakeOver } from "../../../../../sandbox/hooks/use-take-over";
import {
  type Sandbox,
  SandboxType,
} from "../../../../../sandbox/schemas/sandbox";
import { safeVncUrl as gateVncUrl } from "../../../../../sandbox/utils/safe-vnc-url";
import { SidepaneHeader } from "../../sidepane-header";

// The postMessage targetOrigin for the take-over handshake: the frame's own
// origin, derived from its (already gated) url — the app origin for a same-
// origin relative path, the backend host for an absolute one. A null/unparseable
// url degrades to "*" so the emulator still receives the (non-secret) boolean.
function originOf(url: string | null): string {
  if (url === null) {
    return "*";
  }
  try {
    return new URL(url).origin;
  } catch {
    return "*";
  }
}

const COPY = {
  takeOver: "Take over",
  stopTakeOver: "Stop take over",
  takingOver: "You are taking over",
  unavailable: "This device's live view is unavailable.",
  manageApps: "Manage apps",
} as const;

export type SandboxInstanceProps = {
  sandboxes: Sandbox[];
  selected: Sandbox;
  onSelect: (sandbox: Sandbox) => void;
  onViewAll: () => void;
  // Opens the manage-apps panel. Only meaningful for emulator devices (Android
  // app management), so the trigger is shown only for them.
  onManageApps?: () => void;
};

/**
 * Single-device view: a live, interactive VNC iframe under the shell header
 * (device-type icon + device dropdown + status badge in the title slot, a
 * labelled Take-over button on the right). Take-over grants control of the
 * device — for an emulator it is signalled to the iframe via `postMessage`; for
 * aio/wincua an input-blocking overlay lifts and a "taking over" badge + accent
 * border appear. Activity resets a 5-min idle timer; switching device exits
 * take-over.
 */
export function SandboxInstance({
  sandboxes,
  selected,
  onSelect,
  onViewAll,
  onManageApps,
}: SandboxInstanceProps): JSX.Element {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const isEmulator = selected.type === SandboxType.emulator;
  // Gate the backend-provided VNC url before it reaches `src`. It's a same-
  // origin relative path (proxied to the backend), so `safeVncUrl` allows same-
  // origin + absolute https; `null` → a blocked message instead of a live frame.
  const safeVncUrl = gateVncUrl(selected.vncUrl);
  // Scope the take-over postMessage to the frame's own origin instead of "*".
  // Derived from the already-gated https url; if it somehow can't be parsed we
  // fall back to "*" so the emulator handshake still works (the payload is a
  // non-secret boolean).
  const targetOrigin = originOf(safeVncUrl);
  const { takeOver, toggleTakeOver, exitTakeOver } = useTakeOver(
    iframeRef,
    isEmulator,
    targetOrigin,
  );

  // Overlay a spinner on the live frame until it loads. Switching device swaps
  // `vncUrl` on this same instance (no remount), so reset the flag in render the
  // moment the url changes — the new frame shows its spinner again rather than
  // flashing the prior device's last paint. Key on the GATED url (what actually
  // reaches `src`), so a cosmetic-only change to the raw value doesn't drop the
  // spinner with no fresh `onLoad` to clear it.
  const [loaded, setLoaded] = useState(false);
  const [prevUrl, setPrevUrl] = useState(safeVncUrl);
  if (safeVncUrl !== prevUrl) {
    setPrevUrl(safeVncUrl);
    setLoaded(false);
  }

  // Switching device drops take-over (the new device starts view-only).
  const handleSelect = useCallback(
    (sandbox: Sandbox) => {
      exitTakeOver();
      onSelect(sandbox);
    },
    [exitTakeOver, onSelect],
  );

  const takeOverLabel = takeOver ? COPY.stopTakeOver : COPY.takeOver;

  return (
    <div className="bg-surface-basic flex h-full flex-col">
      <SidepaneHeader
        icon={iconForSandboxType(selected.type)}
        titleSlot={
          <div className="flex min-w-0 items-center gap-2">
            <SandboxDropdown
              sandboxes={sandboxes}
              current={selected}
              onSelect={handleSelect}
              onViewAll={onViewAll}
            />
            <SandboxStatus status={selected.status} />
          </div>
        }
        actionsSlot={
          <div className="flex items-center gap-1">
            {isEmulator && onManageApps ? (
              <Button
                type="button"
                variant="subtle"
                size="icon-xs"
                aria-label={COPY.manageApps}
                onClick={onManageApps}
              >
                <LayoutGrid />
              </Button>
            ) : null}
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    type="button"
                    variant="subtle"
                    size="icon-xs"
                    // Active take-over is highlighted in the same primary the badge and
                    // device border use — a soft primary-100 fill with a primary-600
                    // glyph, so all three read as one "in control" state (legacy parity).
                    className={cn(
                      takeOver &&
                        "bg-primary-100 text-primary-600 hover:bg-primary-100 hover:text-primary-600",
                    )}
                    aria-label={takeOverLabel}
                    aria-pressed={takeOver}
                    onClick={toggleTakeOver}
                  >
                    <MousePointer2 />
                  </Button>
                }
              />
              <TooltipContent>{takeOverLabel}</TooltipContent>
            </Tooltip>
          </div>
        }
      />
      <DeviceScreen
        selected={selected}
        isEmulator={isEmulator}
        takeOver={takeOver}
        safeVncUrl={safeVncUrl}
        loaded={loaded}
        onLoad={() => setLoaded(true)}
        iframeRef={iframeRef}
        takingOverLabel={COPY.takingOver}
        unavailableLabel={COPY.unavailable}
      />
    </div>
  );
}
