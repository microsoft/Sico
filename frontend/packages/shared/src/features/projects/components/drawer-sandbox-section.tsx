import { Button } from "@sico/ui";
import { IconDeviceDesktop, IconDeviceMobile } from "@tabler/icons-react";
import { Link } from "@tanstack/react-router";
import { ChevronRight } from "lucide-react";
import type * as React from "react";

import { DRAWER_LINK_CTA_CLASS, SECTION_TITLE_CLASS } from "../constants";
import { type ProjectSandboxDigest } from "../schemas/project";

// One Sandbox row: a device-type bucket (label + live-availability counts + its
// icon). Computed from the real sandbox list — no fabricated "2/5".
type DeviceSummaryItem = {
  label: string;
  free: number;
  total: number;
  Icon: React.ComponentType<{ className?: string }>;
};

// Wire device `type` → the row label + icon. Windows-class desktops
// (aio/physical/wincua) share the desktop glyph; the Android emulator gets the
// mobile glyph. Order fixes the row order.
const DEVICE_TYPE_META: Record<
  string,
  { label: string; Icon: DeviceSummaryItem["Icon"] }
> = {
  wincua: { label: "Windows", Icon: IconDeviceDesktop },
  aio: { label: "AIO", Icon: IconDeviceDesktop },
  physical: { label: "Physical", Icon: IconDeviceDesktop },
  emulator: { label: "Android", Icon: IconDeviceMobile },
};

// Aggregate the flat sandbox list into one row per known type, dropping empty
// types. `free` counts live-available devices; `total` the whole bucket. Takes
// just the `type`+`status` it needs, so both `ProjectSandboxDigest` (drawer,
// inline) and the sandbox page's `Device` satisfy it.
function summarizeDevices(
  devices: readonly { type: string; status: string }[],
): DeviceSummaryItem[] {
  return Object.entries(DEVICE_TYPE_META).flatMap(([type, meta]) => {
    const rows = devices.filter((d) => d.type === type);
    if (rows.length === 0) {
      return [];
    }
    const free = rows.filter((d) => d.status === "available").length;
    return [{ label: meta.label, Icon: meta.Icon, free, total: rows.length }];
  });
}

export type DrawerSandboxSectionProps = {
  sandboxes: ProjectSandboxDigest[];
  projectId: number;
};

/**
 * Sandbox section for the project drawer. Reads the project's sandboxes inline
 * from `project.sandboxes` (no separate query), so it resolves with the
 * page-level skeleton. Shows one row per device-type bucket + a "View all" link
 * to the sandbox page, or a plain "No sandbox devices yet" line when empty.
 */
export function DrawerSandboxSection({
  sandboxes,
  projectId,
}: DrawerSandboxSectionProps): React.JSX.Element {
  const deviceSummary = summarizeDevices(sandboxes);
  return (
    <div className="flex flex-col gap-3">
      <p className={SECTION_TITLE_CLASS}>Devices</p>
      {deviceSummary.length > 0 ? (
        <div className="flex flex-col gap-3">
          {deviceSummary.map((device) => (
            <div key={device.label} className="flex items-center gap-3">
              <span className="bg-surface-icon-tile flex size-7 shrink-0 items-center justify-center rounded-md">
                <device.Icon className="text-foreground-secondary size-4" />
              </span>
              <div className="flex min-w-0 flex-col gap-0.5">
                <p className="text-foreground-primary truncate text-sm leading-tight font-medium">
                  {device.label}
                </p>
                <p className="text-foreground-tertiary truncate text-xs leading-snug font-normal">
                  {device.free} / {device.total} available
                </p>
              </div>
            </div>
          ))}
          <Button
            variant="link"
            className={DRAWER_LINK_CTA_CLASS}
            aria-label="View all devices"
            nativeButton={false}
            render={
              <Link
                to="/project/$projectId/sandbox"
                params={{ projectId: String(projectId) }}
              />
            }
          >
            View all
            <ChevronRight />
          </Button>
        </div>
      ) : (
        <p className="text-foreground-tertiary text-sm leading-snug">
          No devices yet.
        </p>
      )}
    </div>
  );
}
