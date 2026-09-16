import { useLingui } from "@lingui/react/macro";
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
  type: string;
  free: number;
  total: number;
  label: string;
  Icon: React.ComponentType<{ className?: string }>;
};

// Wire device `type` → its icon. Desktop sandboxes share the desktop glyph.
// share the desktop glyph; the Android emulator gets the mobile glyph. Order
// fixes the row order. The row LABEL is NOT here — it is computed in the
// component body via the locale-subscribed hook `t` (a bare `t()` in a
// module-scope helper is neither extractable nor locale-subscribed).
const DEVICE_TYPE_META: Record<string, { Icon: DeviceSummaryItem["Icon"] }> = {
  wincua: { Icon: IconDeviceDesktop },
  linux_workstation: { Icon: IconDeviceDesktop },
  physical: { Icon: IconDeviceDesktop },
  emulator: { Icon: IconDeviceMobile },
};

// Aggregate the flat sandbox list into one row per known type, dropping empty
// types. `free` counts live-available devices; `total` the whole bucket. Takes
// just the `type`+`status` it needs, so both `ProjectSandboxDigest` (drawer,
// inline) and the sandbox page's `Device` satisfy it. `labels` maps each known
// `type` to its already-localized row label (built in the component body), so
// the copy stays extractable and locale-subscribed.
function summarizeDevices(
  devices: readonly { type: string; status: string }[],
  labels: Record<string, string>,
): DeviceSummaryItem[] {
  return Object.entries(DEVICE_TYPE_META).flatMap(([type, meta]) => {
    const rows = devices.filter((d) => d.type === type);
    if (rows.length === 0) {
      return [];
    }
    const free = rows.filter((d) => d.status === "available").length;
    return [
      {
        type,
        Icon: meta.Icon,
        label: labels[type] ?? type,
        free,
        total: rows.length,
      },
    ];
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
  const { t } = useLingui();
  // Device-type labels, computed in the body so the hook `t` both makes them
  // statically extractable and re-renders them on a runtime locale switch.
  const deviceLabels: Record<string, string> = {
    wincua: t({
      id: "projects.drawerSandbox.deviceType.windows",
      message: "Windows",
    }),
    linux_workstation: t({
      id: "projects.drawerSandbox.deviceType.linuxWorkstation",
      message: "Linux Workstation",
    }),
    physical: t({
      id: "projects.drawerSandbox.deviceType.physical",
      message: "Physical",
    }),
    emulator: t({
      id: "projects.drawerSandbox.deviceType.android",
      message: "Android",
    }),
  };
  const deviceSummary = summarizeDevices(sandboxes, deviceLabels);
  return (
    <div className="flex flex-col gap-3">
      <p className={SECTION_TITLE_CLASS}>
        {t({ id: "projects.drawerSandbox.titleDevices", message: "Devices" })}
      </p>
      {deviceSummary.length > 0 ? (
        <div className="flex flex-col gap-3">
          {deviceSummary.map((device) => (
            <div key={device.type} className="flex items-center gap-3">
              <span className="bg-surface-icon-tile flex size-7 shrink-0 items-center justify-center rounded-md">
                <device.Icon className="text-foreground-secondary size-4" />
              </span>
              <div className="flex min-w-0 flex-col gap-0.5">
                <p className="text-foreground-primary truncate text-sm leading-tight font-medium">
                  {device.label}
                </p>
                <p className="text-foreground-tertiary truncate text-xs leading-snug font-normal">
                  {device.free} / {device.total}{" "}
                  {t({
                    id: "projects.drawerSandbox.available",
                    message: "available",
                  })}
                </p>
              </div>
            </div>
          ))}
          <Button
            variant="link"
            className={DRAWER_LINK_CTA_CLASS}
            aria-label={t({
              id: "projects.drawerSandbox.viewAllDevicesAria",
              message: "View all devices",
            })}
            nativeButton={false}
            render={
              <Link
                to="/project/$projectId/sandbox"
                params={{ projectId: String(projectId) }}
              />
            }
          >
            {t({ id: "common.action.viewAll", message: "View all" })}
            <ChevronRight />
          </Button>
        </div>
      ) : (
        <p className="text-foreground-tertiary text-sm leading-snug">
          {t({
            id: "projects.drawerSandbox.empty",
            message: "No devices yet.",
          })}
        </p>
      )}
    </div>
  );
}
