import type * as React from "react";

import { DevicesTable } from "./devices-table";
import { MessageState } from "../../../components/message-state";
import { EMPTY_ILLUSTRATIONS } from "../../../constants/empty-illustration";
import { type Device } from "../schemas/device";

// `cards` is the empty-list illustration (tables / device lists); `noPreview`
// is the "can't preview this file" window — wrong for a zero-length roster.
const ILLUSTRATION = EMPTY_ILLUSTRATIONS.cards;

export type SandboxBodyProps = {
  devices: Device[];
  /** True when a status tab / search is narrowing the list — drives the "no
   * matches" copy vs the "project has no devices" copy. */
  isFiltered: boolean;
  canAssign: boolean;
  onAssign: (device: Device) => void;
};

// Empty / list branches for the sandbox page body. Loading is owned by the
// page's Suspense (skeleton) and errors by its ErrorBoundary (ErrorView), so
// this only distinguishes empty (project-empty vs filtered-empty) from the table.
export function SandboxBody({
  devices,
  isFiltered,
  canAssign,
  onAssign,
}: SandboxBodyProps): React.JSX.Element {
  if (devices.length === 0) {
    // A filtered list that came up empty means the project HAS devices, just
    // none matching the current tab/search — say so instead of "no devices".
    const heading = isFiltered ? "No matching devices" : "No devices yet";
    const body = isFiltered
      ? "No devices match the current filter. Try another tab or search."
      : "This project has no devices.";
    return (
      <MessageState
        fill
        illustrationUrl={ILLUSTRATION.url}
        illustrationWidth={ILLUSTRATION.width}
        illustrationHeight={ILLUSTRATION.height}
        heading={heading}
        body={body}
      />
    );
  }
  return (
    <DevicesTable devices={devices} canAssign={canAssign} onAssign={onAssign} />
  );
}
