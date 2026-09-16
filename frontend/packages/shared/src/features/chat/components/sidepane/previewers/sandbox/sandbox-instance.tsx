import { useLingui } from "@lingui/react/macro";
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

type SandboxCopy = {
  takeOver: string;
  stopTakeOver: string;
  takingOver: string;
  unavailable: string;
  manageApps: string;
};

function renderHeaderActions({
  isEmulator,
  onManageApps,
  copy,
  takeOver,
  takeOverLabel,
  toggleTakeOver,
}: {
  isEmulator: boolean;
  onManageApps?: () => void;
  copy: SandboxCopy;
  takeOver: boolean;
  takeOverLabel: string;
  toggleTakeOver: () => void;
}): JSX.Element {
  return (
    <div className="flex items-center gap-1">
      {isEmulator && onManageApps ? (
        <Button
          type="button"
          variant="subtle"
          size="icon-xs"
          aria-label={copy.manageApps}
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
  );
}

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
 * Linux Workstation/WinCUA an input-blocking overlay lifts and a "taking over" badge + accent
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
  const { t } = useLingui();
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const isEmulator = selected.type === SandboxType.emulator;
  const safeVncUrl = gateVncUrl(selected.vncUrl);
  const targetOrigin = originOf(safeVncUrl);
  const { takeOver, toggleTakeOver, exitTakeOver } = useTakeOver(
    iframeRef,
    isEmulator,
    targetOrigin,
  );

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

  const copy: SandboxCopy = {
    takeOver: t({ id: "chat.sandboxInstance.takeOver", message: "Take over" }),
    stopTakeOver: t({
      id: "chat.sandboxInstance.stopTakeOver",
      message: "Stop take over",
    }),
    takingOver: t({
      id: "chat.sandboxInstance.takingOver",
      message: "You are taking over",
    }),
    unavailable: t({
      id: "chat.sandboxInstance.unavailable",
      message: "This device's live view is unavailable.",
    }),
    manageApps: t({
      id: "chat.sandboxInstance.manageApps",
      message: "Manage apps",
    }),
  };

  const takeOverLabel = takeOver ? copy.stopTakeOver : copy.takeOver;

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
        actionsSlot={renderHeaderActions({
          isEmulator,
          onManageApps,
          copy,
          takeOver,
          takeOverLabel,
          toggleTakeOver,
        })}
      />
      <DeviceScreen
        selected={selected}
        isEmulator={isEmulator}
        takeOver={takeOver}
        safeVncUrl={safeVncUrl}
        loaded={loaded}
        onLoad={() => setLoaded(true)}
        iframeRef={iframeRef}
        takingOverLabel={copy.takingOver}
        unavailableLabel={copy.unavailable}
      />
    </div>
  );
}
